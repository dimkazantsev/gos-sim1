-- Scoped budget RPCs. No global role changes and no reset of game economics.
create or replace function public.list_regional_cases(p_game_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к региональным задачам этой игры.';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'comic_scene',c.comic_scene,'status',case when o.case_id is not null then 'resolved' when exists(select 1 from event_decisions where case_id=c.id) then 'voting' else 'ready' end,'assigned',exists(select 1 from event_assignments where case_id=c.id and recipient_id=auth.uid())) order by c.case_key),'[]'::jsonb)
 from event_cases c left join event_case_outcomes o on o.case_id=c.id
 where c.game_id=p_game_id and c.status='ready' and c.comic_scene ? 'region_code');
end$$;
create or replace function public.start_regional_case(p_case_id uuid) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c event_cases%rowtype;
begin
 select * into c from event_cases where id=p_case_id for update;
 if c.id is null or not (c.comic_scene ? 'region_code') or c.status<>'ready' then raise exception 'Региональная задача недоступна.';end if;
 if not exists(select 1 from game_members where game_id=c.game_id and user_id=auth.uid() and kind='student') then raise exception 'Задачу начинает студент текущей игры.';end if;
 if exists(select 1 from event_assignments where case_id=c.id and recipient_id=auth.uid()) then return c.id;end if;
 if exists(select 1 from event_case_outcomes where case_id=c.id) then raise exception 'Этот кейс уже завершён. Итог доступен участникам его решения.';end if;
 if exists(select 1 from event_decisions where case_id=c.id) then raise exception 'Голосование уже началось. Новых участников приглашают до первого голоса.';end if;
 insert into event_assignments(case_id,game_id,recipient_id,created_by) values(c.id,c.game_id,auth.uid(),auth.uid()) on conflict do nothing;
 return c.id;
end$$;
revoke all on function public.list_regional_cases(uuid),public.start_regional_case(uuid) from public,anon;
grant execute on function public.list_regional_cases(uuid),public.start_regional_case(uuid) to authenticated;

-- Rate changes are bound to a document by the server, not inferred from an arbitrary title.
create or replace function public.propose_fiscal_rate(p_game_id uuid,p_region text,p_tax text,p_rate numeric) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare t fiscal_tax_catalog%rowtype;d uuid;pid uuid;v_stage integer;roles text;subject text;dtype text;workflow text;label text;body text;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре.';end if;
 select lower(role_title) into roles from public.game_members where game_id=p_game_id and user_id=auth.uid() and kind<>'observer' and private.role_is_available(p_game_id,auth.uid());
 if not private.is_game_teacher(p_game_id) and coalesce(roles,'') !~ 'министр|правительств|губернатор|глава|администрац' then raise exception 'Предложение ставки подготавливает действующий представитель исполнительной власти.';end if;
 select * into t from fiscal_tax_catalog where tax_key=p_tax;
 if not found or t.default_rate is null then raise exception 'Для этого платежа применяется специальная формула.';end if;
 if p_rate is null or p_rate<t.min_rate or p_rate>t.max_rate then raise exception 'Ставка вне диапазона выбранной базы.';end if;
 if t.level='federal' then p_region:='00';elsif not exists(select 1 from fiscal_region_reference where code=p_region) then raise exception 'Выберите регион.';end if;
 select coalesce(max(stage_no),1) into v_stage from game_stages where game_id=p_game_id and status='open';
 if t.level='federal' then subject:='government';dtype:='fz_bill';workflow:='bill';label:='Правительство Российской Федерации';
 elsif t.level='municipal' then subject:='municipality';dtype:='municipal_act';workflow:='municipal_act';label:='Орган местного самоуправления';
 else subject:='ministry';dtype:='other';workflow:='generic';label:='Исполнительная власть субъекта Российской Федерации';end if;
 body:=E'Проект налоговой меры.\n1. Предлагается ставка «'||t.label||'» для указанной учебной базы: '||p_rate||' '||t.unit||E'.\n2. Регион сценария: '||p_region||E'.\n3. Необходимо обосновать компетенцию представительного органа, изменение его акта, нормативы зачисления и финансовые последствия.\n4. Дата вступления в силу определяется с учётом статьи 5 НК РФ.\nИсполнительная власть предлагает меру; документ не заменяет принятие закона или решения уполномоченным органом.';
 if private.can_create_formal_subject(p_game_id,auth.uid(),subject) then
  d:=public.create_formal_document(p_game_id,v_stage,'Об изменении ставки: '||t.label,dtype,subject,label,body,null,null,null,workflow,jsonb_build_object('educational_draft',true,'fiscal_rate_change',jsonb_build_object('region_code',p_region,'tax_key',p_tax,'rate',p_rate)));
 end if;
 insert into fiscal_rate_proposals(game_id,region_code,tax_key,new_rate,author_id,document_id) values(p_game_id,p_region,p_tax,p_rate,auth.uid(),d) returning id into pid;
 return pid;
end$$;


revoke all on function public.propose_fiscal_rate(uuid,text,text,numeric) from public,anon;
grant execute on function public.propose_fiscal_rate(uuid,text,text,numeric) to authenticated;
create or replace function public.get_fiscal_budget(p_game_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_result jsonb;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджету этой игры.';end if;
 perform private.ensure_fiscal_game(p_game_id);
 select jsonb_build_object('regions',(select jsonb_agg(to_jsonb(r)||jsonb_build_object('name',d.name,'profile',d.profile,'disputed',d.disputed,'observations',d.observations,'source_url',d.source_url,'source_year',d.source_year) order by d.name) from game_fiscal_regions r join fiscal_region_reference d on d.code=r.region_code where game_id=p_game_id),'rates',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from game_fiscal_rates t where game_id=p_game_id),'proposals',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]'::jsonb) from fiscal_rate_proposals t where game_id=p_game_id),'ledger',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]'::jsonb) from (select * from fiscal_change_ledger where game_id=p_game_id order by created_at desc limit 100) t),'can_propose',private.is_game_teacher(p_game_id) or exists(select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.kind='student' and private.role_is_available(p_game_id,auth.uid()) and lower(m.role_title) ~ 'министр|правительств|губернатор|глава|администрац')) into v_result;
 return v_result;
end $$;
