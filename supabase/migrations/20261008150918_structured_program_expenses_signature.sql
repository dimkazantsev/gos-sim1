-- One transactional form, itemised ruble expenses, and a recorded PM signature.
alter table public.state_programs
 add column form_version integer not null default 1 check(form_version in (1,2)),
 add column signed_by uuid references auth.users(id),
 add column signed_at timestamptz,
 add column publication_post_id uuid references public.political_posts(id) on delete set null;

create table public.state_program_expenses(
 id uuid primary key default gen_random_uuid(),
 program_id uuid not null references public.state_programs(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 component_id uuid not null references public.state_program_components(id) on delete cascade,
 indicator_name text not null check(length(trim(indicator_name)) between 3 and 500),
 justification text not null check(length(trim(justification)) between 5 and 4000),
 budget_year integer not null check(budget_year between 2000 and 2100),
 amount numeric(20,2) not null check(amount>=0 and amount::text not in ('NaN','Infinity','-Infinity')),
 position integer not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create index state_program_expenses_program_idx on public.state_program_expenses(program_id,position);
create index state_program_expenses_game_idx on public.state_program_expenses(game_id);
create index state_program_expenses_component_idx on public.state_program_expenses(component_id);

create table public.state_program_budget_commitments(
 program_id uuid not null references public.state_programs(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 budget_year integer not null check(budget_year between 2000 and 2100),
 amount numeric(20,2) not null check(amount>=0 and amount::text not in ('NaN','Infinity','-Infinity')),
 status text not null default 'planned' check(status in ('planned','approved','rejected')),
 signed_by uuid not null references auth.users(id),signed_at timestamptz not null,
 primary key(program_id,budget_year)
);
create index state_program_budget_commitments_game_idx on public.state_program_budget_commitments(game_id,budget_year);
alter table public.state_program_expenses enable row level security;
alter table public.state_program_budget_commitments enable row level security;
revoke all on public.state_program_expenses,public.state_program_budget_commitments from public,anon,authenticated;
grant select on public.state_program_expenses,public.state_program_budget_commitments to authenticated;
create policy state_program_expenses_read on public.state_program_expenses for select to authenticated using(private.is_game_member(game_id));
create policy state_program_budget_commitments_read on public.state_program_budget_commitments for select to authenticated using(private.is_game_member(game_id));
alter publication supabase_realtime add table public.state_program_expenses,public.state_program_budget_commitments;

create function private.lock_active_program_actor(p_game_id uuid) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare m game_members%rowtype;
begin
 if auth.uid() is null or p_game_id is null then raise exception 'Нет доступа к программе';end if;
 if private.is_platform_admin() then return;end if;
 select * into m from game_members where game_id=p_game_id and user_id=auth.uid() for update;
 if m.user_id is null or m.kind not in ('student','teacher') or m.roster_archived_at is not null then raise exception 'Требуется действующий участник этой игры';end if;
 if m.kind='student' and not private.role_is_available(p_game_id,m.user_id) then raise exception 'Участник временно недоступен';end if;
end;$$;
revoke all on function private.lock_active_program_actor(uuid) from public,anon,authenticated;

create or replace function private.can_edit_state_program(p_program uuid,p_user uuid) returns boolean
language sql stable security definer set search_path=public,private,pg_temp as $$
 select p_user=auth.uid() and (private.is_platform_admin() or exists(select 1 from game_members gm where gm.game_id=p.game_id and gm.user_id=p_user and gm.kind in ('teacher','student') and gm.roster_archived_at is null)) and not private.is_game_observer(p.game_id)
 and (private.is_game_teacher(p.game_id) or private.role_is_available(p.game_id,p_user))
 and p.status in ('draft','revision','minister_review') and p.signed_at is null
 and (private.is_game_teacher(p.game_id) or p.created_by=p_user or p.responsible_minister_id=p_user)
 from state_programs p where p.id=p_program;
$$;
revoke all on function private.can_edit_state_program(uuid,uuid) from public,anon,authenticated;

create function private.lock_signed_program_content() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p state_programs%rowtype;pid uuid;
begin
 pid:=case when tg_op='DELETE' then old.program_id else new.program_id end;
 if exists(select 1 from games where id=case when tg_op='DELETE' then old.game_id else new.game_id end) then perform private.lock_active_program_actor(case when tg_op='DELETE' then old.game_id else new.game_id end);end if;
 select * into p from state_programs where id=pid for update;
 if p.id is not null and (p.status not in ('draft','revision','minister_review') or p.signed_at is not null) then raise exception 'Согласованный или подписанный текст программы защищён от изменений';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
create trigger state_program_goals_content_lock before insert or update or delete on state_program_goals for each row execute function private.lock_signed_program_content();
create trigger state_program_components_content_lock before insert or update or delete on state_program_components for each row execute function private.lock_signed_program_content();
create trigger state_program_years_content_lock before insert or update or delete on state_program_budget_years for each row execute function private.lock_signed_program_content();
create trigger state_program_expenses_content_lock before insert or update or delete on state_program_expenses for each row execute function private.lock_signed_program_content();
revoke all on function private.lock_signed_program_content() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_state_program(p_game_id uuid, p_program_id uuid, p_title text, p_responsible_ministry text, p_responsible_minister_id uuid, p_curator_id uuid, p_national_goal text, p_start_date date, p_end_date date, p_total_budget numeric, p_expected_results text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_role text;
begin
 perform private.lock_active_program_actor(p_game_id);
 if v_uid is null or not private.is_game_member(p_game_id) or private.is_game_observer(p_game_id) or (not private.is_game_teacher(p_game_id) and not private.role_is_available(p_game_id,v_uid)) then raise exception 'Game access required'; end if;
 if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_responsible_ministry,'')))<3 then raise exception 'Program title and responsible ministry are required'; end if;
 if p_total_budget<0 or p_total_budget::text in ('NaN','Infinity','-Infinity') then raise exception 'Budget cannot be negative'; end if;
 if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then raise exception 'Program end date must follow start date'; end if;
 if p_responsible_minister_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_responsible_minister_id)
 then raise exception 'Responsible minister is not a game member'; end if;
 if p_curator_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_curator_id)
 then raise exception 'Curator is not a game member'; end if;

 if p_program_id is null then
  v_role:=private.game_role(p_game_id,v_uid);
  if not private.is_game_teacher(p_game_id)
     and v_role not like '%министр%'
     and v_role not like '%правительств%'
  then raise exception 'Government member role required to create a state program'; end if;
  insert into public.state_programs(
   game_id,title,responsible_ministry,responsible_minister_id,curator_id,national_goal,start_date,end_date,total_budget,expected_results,created_by
  ) values(
   p_game_id,trim(p_title),trim(p_responsible_ministry),coalesce(p_responsible_minister_id,v_uid),p_curator_id,
   nullif(trim(coalesce(p_national_goal,'')),''),p_start_date,p_end_date,coalesce(p_total_budget,0),
   nullif(trim(coalesce(p_expected_results,'')),''),v_uid
  ) returning id into v_id;
 else
  perform 1 from public.state_programs where id=p_program_id and game_id=p_game_id for update;
  if not found then raise exception 'Программа не принадлежит этой игре';end if;
  if not private.can_edit_state_program(p_program_id,v_uid) then raise exception 'Program editing access required'; end if;
  update public.state_programs set title=trim(p_title),responsible_ministry=trim(p_responsible_ministry),
   responsible_minister_id=p_responsible_minister_id,curator_id=p_curator_id,national_goal=nullif(trim(coalesce(p_national_goal,'')),''),
   start_date=p_start_date,end_date=p_end_date,total_budget=coalesce(p_total_budget,0),
   expected_results=nullif(trim(coalesce(p_expected_results,'')),''),updated_at=now()
  where id=p_program_id and game_id=p_game_id returning id into v_id;
 end if;
 return v_id;
end;
$function$;


create function private.replace_state_program_rows(p_program_id uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p state_programs%rowtype;v_program_id uuid:=p_program_id;p_game_id uuid;uid uuid:=auth.uid();starts date;ends date;
 x jsonb;c_id uuid;component_ids uuid[]:='{}';component_total numeric;idx integer:=0;year_no integer;component_start date;component_end date;
begin
 perform private.lock_active_program_actor((select game_id from state_programs where id=p_program_id));
 select * into p from state_programs where id=p_program_id for update;
 if p.id is null or not private.can_edit_state_program(p.id,uid) then raise exception 'Нет доступа к строкам программы';end if;
 p_game_id:=p.game_id;starts:=p.start_date;ends:=p.end_date;
 delete from state_program_expenses where program_id=v_program_id and game_id=p_game_id;
 -- Use the existing item APIs so their authorization and locking stay central.
 for c_id in select id from state_program_goals where program_id=v_program_id and game_id=p_game_id loop
  perform public.delete_state_program_item('goal',c_id);
 end loop;
 for c_id in select id from state_program_components where program_id=v_program_id and game_id=p_game_id loop
  perform public.delete_state_program_item('component',c_id);
 end loop;
 for c_id in select id from state_program_budget_years where program_id=v_program_id and game_id=p_game_id loop
  perform public.delete_state_program_budget_year(c_id);
 end loop;
 update state_programs set participants=nullif(trim(p_payload->>'participants'),''),presidential_priority_id=nullif(p_payload->>'presidential_priority_id','')::uuid,form_version=2,updated_at=now() where state_programs.id=v_program_id;
 for x in select value from jsonb_array_elements(p_payload->'goals') loop
  if coalesce(nullif(x->>'baseline_value','')::numeric,0)::text in ('NaN','Infinity','-Infinity') or coalesce(nullif(x->>'target_value','')::numeric,0)::text in ('NaN','Infinity','-Infinity') then raise exception 'Значения показателей должны быть конечными числами';end if;
  year_no:=nullif(x->>'target_year','')::integer;
  if year_no is not null and (year_no not between 2000 and 2100 or (starts is not null and year_no<extract(year from starts)) or (ends is not null and year_no>extract(year from ends))) then raise exception 'Целевой год показателя должен входить в срок программы';end if;
  perform public.add_state_program_goal(v_program_id,x->>'goal_text',x->>'indicator_name',x->>'unit',nullif(x->>'baseline_value','')::numeric,nullif(x->>'target_value','')::numeric,year_no);
 end loop;
 for x in select value from jsonb_array_elements(p_payload->'components') loop
  idx:=idx+1;component_start:=nullif(x->>'start_date','')::date;component_end:=nullif(x->>'end_date','')::date;
  if (component_start is not null and starts is not null and component_start<starts) or (component_end is not null and ends is not null and component_end>ends) or (component_start is not null and component_end is not null and component_end<component_start) then raise exception 'Сроки мероприятия должны входить в срок программы';end if;
  select coalesce(sum((value->>'amount')::numeric),0) into component_total from jsonb_array_elements(p_payload->'expenses') where (value->>'component_no')::integer=idx;
  c_id:=public.add_state_program_component(v_program_id,(x->>'direction_no')::integer,x->>'direction_title',x->>'component_kind',x->>'title',x->>'goal_text',component_start,component_end,component_total);
  component_ids:=array_append(component_ids,c_id);
 end loop;
 idx:=0;
 for x in select value from jsonb_array_elements(p_payload->'expenses') loop
  idx:=idx+1;
  insert into state_program_expenses(program_id,game_id,component_id,indicator_name,justification,budget_year,amount,position,created_by)
  values(v_program_id,p_game_id,component_ids[(x->>'component_no')::integer],trim(x->>'indicator_name'),trim(x->>'justification'),(x->>'budget_year')::integer,(x->>'amount')::numeric,idx,uid);
 end loop;
 -- Include zero years, so annual readiness keeps the original rules.
 insert into state_program_budget_years(program_id,game_id,budget_year,amount,created_by)
 select v_program_id,p_game_id,y,coalesce((select sum(amount) from state_program_expenses e where e.program_id=v_program_id and e.budget_year=y),0),uid
 from generate_series(extract(year from starts)::integer,extract(year from ends)::integer) y;
end;$$;
revoke all on function private.replace_state_program_rows(uuid,jsonb) from public,anon,authenticated;

create function public.save_state_program_draft(p_game_id uuid,p_program_id uuid,p_payload jsonb,p_confirm boolean default false) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p state_programs%rowtype;uid uuid:=auth.uid();v_program_id uuid;c_id uuid;component_ids uuid[]:='{}';x jsonb;
 total numeric:=0;component_total numeric;amount numeric;idx integer:=0;year_no integer;component_no integer;
 starts date;ends date;minister uuid;curator uuid;priority uuid;component_start date;component_end date;
begin
 perform private.lock_active_program_actor(p_game_id);
 if uid is null or not private.is_game_member(p_game_id) or private.is_game_observer(p_game_id)
 or (not private.is_game_teacher(p_game_id) and not private.role_is_available(p_game_id,uid)) then raise exception 'Нет доступа к разработке программы';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>262144 then raise exception 'Некорректная форма программы';end if;
 if jsonb_typeof(p_payload->'goals') is distinct from 'array' or jsonb_typeof(p_payload->'components') is distinct from 'array' or jsonb_typeof(p_payload->'expenses') is distinct from 'array' then raise exception 'Цели, мероприятия и расходы передаются списками';end if;
 if jsonb_array_length(p_payload->'goals')>50 or jsonb_array_length(p_payload->'components')>25 or jsonb_array_length(p_payload->'expenses')>200 then raise exception 'Превышен лимит строк формы';end if;
 if p_program_id is not null then
  select * into p from state_programs where id=p_program_id and game_id=p_game_id for update;
  if p.id is null or not private.can_edit_state_program(p.id,uid) then raise exception 'Нет доступа к этой программе';end if;
  if p.status not in ('draft','revision','minister_review') or p.signed_at is not null then raise exception 'Согласованный или подписанный текст защищён от изменений';end if;
 end if;
 starts:=nullif(p_payload->>'start_date','')::date;ends:=nullif(p_payload->>'end_date','')::date;
 if (starts is not null and extract(year from starts) not between 2000 and 2100) or (ends is not null and extract(year from ends) not between 2000 and 2100) then raise exception 'Срок программы должен быть в пределах 2000–2100 годов';end if;
 minister:=nullif(p_payload->>'responsible_minister_id','')::uuid;curator:=nullif(p_payload->>'curator_id','')::uuid;priority:=nullif(p_payload->>'presidential_priority_id','')::uuid;
 if minister is not null and not exists(select 1 from game_members where game_id=p_game_id and user_id=minister and kind='student' and roster_archived_at is null) then raise exception 'Ответственный министр должен быть действующим участником игры';end if;
 if curator is not null and not exists(select 1 from game_members where game_id=p_game_id and user_id=curator and kind='student' and roster_archived_at is null) then raise exception 'Куратор должен быть действующим участником игры';end if;
 if priority is not null and not exists(select 1 from presidential_priorities pr join presidential_addresses a on a.id=pr.address_id where pr.id=priority and pr.game_id=p_game_id and a.status='published') then raise exception 'Выберите опубликованный приоритет этой игры';end if;
 for x in select value from jsonb_array_elements(p_payload->'expenses') loop
  amount:=(x->>'amount')::numeric;year_no:=(x->>'budget_year')::integer;component_no:=(x->>'component_no')::integer;
  if amount is null or amount<0 or amount>1000000000000000 or amount::text in ('NaN','Infinity','-Infinity') or amount<>round(amount,2) then raise exception 'Расход должен быть неотрицательной суммой в рублях, не более двух знаков после запятой';end if;
  if year_no is null or year_no not between 2000 and 2100 or (starts is not null and year_no<extract(year from starts)) or (ends is not null and year_no>extract(year from ends)) then raise exception 'Год расхода должен входить в период программы';end if;
  if component_no is null or component_no not between 1 and jsonb_array_length(p_payload->'components') then raise exception 'Каждый расход необходимо связать с мероприятием программы';end if;
  if length(trim(coalesce(x->>'indicator_name','')))<3 or length(trim(coalesce(x->>'justification','')))<5 then raise exception 'Заполните индикатор расхода и его обоснование';end if;
  total:=total+amount;
 end loop;
 v_program_id:=public.save_state_program(p_game_id,p_program_id,p_payload->>'title',p_payload->>'responsible_ministry',minister,curator,p_payload->>'national_goal',starts,ends,total,p_payload->>'expected_results');
 if v_program_id is null then raise exception 'Программа не сохранена';end if;
 perform private.replace_state_program_rows(v_program_id,p_payload);
 if p_confirm then perform public.advance_state_program(v_program_id,'submit_minister');end if;
 return v_program_id;
end;$$;

create function private.publish_signed_state_program(p_program_id uuid,p_signer uuid) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p state_programs%rowtype;post_id uuid;signer_name text;body_text text;signed_time timestamptz:=now();
begin
 select * into p from state_programs where id=p_program_id for update;
 if p.signed_at is not null then return;end if;
 if p.status<>'ready' or p_signer is distinct from auth.uid() then raise exception 'Подпись программы недоступна';end if;
 select full_name into signer_name from game_members where game_id=p.game_id and user_id=p_signer;
 body_text:=concat_ws(E'\n',p.title,'Ответственное министерство: '||p.responsible_ministry,'Национальная цель: '||p.national_goal,'Период: '||p.start_date||' — '||p.end_date,'Участники: '||p.participants,'Ожидаемые результаты: '||p.expected_results,
 'Цели и показатели:',(select string_agg(goal_text||' · '||indicator_name||': '||coalesce(baseline_value::text,'—')||' → '||coalesce(target_value::text,'—')||' '||coalesce(unit,'')||' ('||coalesce(target_year::text,'—')||')',E'\n' order by created_at,id) from state_program_goals where program_id=p.id),
 'Направления и мероприятия:',(select string_agg(direction_no||'. '||direction_title||' · '||title||': '||goal_text||' · '||coalesce(start_date::text,'—')||' — '||coalesce(end_date::text,'—')||' · '||budget||' ₽',E'\n' order by direction_no,created_at,id) from state_program_components where program_id=p.id),
 'Расходы в рублях:',(select string_agg(e.budget_year||' · '||e.indicator_name||' · '||e.justification||' · '||e.amount||' ₽',E'\n' order by e.position,e.id) from state_program_expenses e where e.program_id=p.id),
 'Финансирование по годам:',(select string_agg(budget_year||': '||amount||' ₽',E'\n' order by budget_year) from state_program_budget_years where program_id=p.id),
 'Всего: '||p.total_budget||' ₽','Подписал Председатель Правительства: '||coalesce(signer_name,'Уполномоченный участник'),
 'Программа направлена на заседание Правительства. Бюджетные ассигнования утверждаются бюджетной процедурой.');
 insert into political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,status,source_key,context)
 values(p.game_id,p_signer,'information','government','Правительство','Подписана государственная программа: '||p.title,body_text,array['Государственная программа','Бюджет'],'published','state_program_signed:'||p.id,jsonb_build_object('state_program_id',p.id,'stage_no',11))
 on conflict(game_id,source_key) where source_key is not null do nothing returning id into post_id;
 if post_id is null then select id into post_id from political_posts where game_id=p.game_id and source_key='state_program_signed:'||p.id;end if;
 insert into state_program_budget_commitments(program_id,game_id,budget_year,amount,status,signed_by,signed_at)
 select p.id,p.game_id,budget_year,amount,'planned',p_signer,signed_time from state_program_budget_years where program_id=p.id
 on conflict(program_id,budget_year) do nothing;
 update state_programs set signed_by=p_signer,signed_at=signed_time,publication_post_id=post_id,updated_at=now() where id=p.id;
end;$$;

create function private.lock_signed_program_passport() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if old.status not in ('draft','revision','minister_review') or old.signed_at is not null then
  if row(new.title,new.responsible_ministry,new.responsible_minister_id,new.curator_id,new.national_goal,new.start_date,new.end_date,new.total_budget,new.expected_results,new.participants,new.presidential_priority_id)
  is distinct from row(old.title,old.responsible_ministry,old.responsible_minister_id,old.curator_id,old.national_goal,old.start_date,old.end_date,old.total_budget,old.expected_results,old.participants,old.presidential_priority_id) then raise exception 'Согласованный или подписанный паспорт защищён от изменений';end if;
 end if;
 return new;
end;$$;
create trigger state_program_passport_lock before update on public.state_programs for each row execute function private.lock_signed_program_passport();

create function private.sync_signed_program_commitments() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if new.status is distinct from old.status and new.signed_at is not null then
  update state_program_budget_commitments set status=case when new.status='adopted' then 'approved' when new.status='rejected' then 'rejected' else 'planned' end where program_id=new.id;
 end if;
 return new;
end;$$;
create trigger state_program_commitments_sync after update of status on public.state_programs for each row execute function private.sync_signed_program_commitments();

create function public.get_signed_state_program_budget(p_game_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджету этой игры';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'ministry',p.responsible_ministry,'total_budget',p.total_budget::text,'program_status',p.status,'signed_by',p.signed_by,'signed_at',p.signed_at,'publication_post_id',p.publication_post_id,'years',
  (select jsonb_agg(jsonb_build_object('year',c.budget_year,'amount',c.amount::text,'status',c.status) order by c.budget_year) from state_program_budget_commitments c where c.program_id=p.id)) order by p.signed_at desc)
 from state_programs p where p.game_id=p_game_id and p.signed_at is not null),'[]'::jsonb);
end;$$;

revoke all on function private.publish_signed_state_program(uuid,uuid),private.lock_signed_program_passport(),private.sync_signed_program_commitments() from public,anon,authenticated;
revoke all on function public.save_state_program_draft(uuid,uuid,jsonb,boolean),public.get_signed_state_program_budget(uuid) from public,anon;
grant execute on function public.save_state_program_draft(uuid,uuid,jsonb,boolean),public.get_signed_state_program_budget(uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.state_program_readiness_json(p_program_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_goals integer;v_components integer;v_dirs integer;
 v_component_budget numeric;v_has_published_address boolean;v_issues jsonb:='[]'::jsonb;
 v_budget_years integer;v_expected_years integer;v_annual_total numeric;
begin
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null then return jsonb_build_object('ready',false,'issues',jsonb_build_array('Программа не найдена')); end if;
 select count(*) into v_goals from public.state_program_goals where program_id=p.id;
 select count(*),count(distinct direction_no),coalesce(sum(budget),0)
 into v_components,v_dirs,v_component_budget
 from public.state_program_components where program_id=p.id;
 select exists(select 1 from public.presidential_addresses where game_id=p.game_id and status='published')
 into v_has_published_address;
 select count(*),coalesce(sum(amount),0) into v_budget_years,v_annual_total
 from public.state_program_budget_years where program_id=p.id;
 v_expected_years:=case when p.start_date is not null and p.end_date is not null
   then extract(year from p.end_date)::integer-extract(year from p.start_date)::integer+1 else 0 end;

 if nullif(trim(coalesce(p.national_goal,'')),'') is null then v_issues:=v_issues||jsonb_build_array('Не выбрана национальная цель'); end if;
 if nullif(trim(coalesce(p.participants,'')),'') is null then v_issues:=v_issues||jsonb_build_array('Не указаны участники программы'); end if;
 if p.start_date is null or p.end_date is null then v_issues:=v_issues||jsonb_build_array('Не указан полный срок реализации'); end if;
 if p.total_budget<=0 then v_issues:=v_issues||jsonb_build_array('Не задан общий бюджет программы'); end if;
 if length(trim(coalesce(p.expected_results,'')))<5 then v_issues:=v_issues||jsonb_build_array('Не заполнены ожидаемые результаты'); end if;
 if v_goals<1 then v_issues:=v_issues||jsonb_build_array('Нет целей с измеримыми показателями'); end if;
 if v_dirs<>3 then v_issues:=v_issues||jsonb_build_array('По правилам этапов 10–11 программа должна содержать три направления'); end if;
 if v_components<3 then v_issues:=v_issues||jsonb_build_array('Недостаточно структурных элементов программы'); end if;
 if v_components>25 then v_issues:=v_issues||jsonb_build_array('Превышен лимит 25 структурных элементов'); end if;
 if v_component_budget>p.total_budget then v_issues:=v_issues||jsonb_build_array('Сумма бюджетов структурных элементов превышает общий бюджет программы'); end if;
 if exists(select 1 from public.state_program_components where program_id=p.id and (start_date is null or end_date is null))
 then v_issues:=v_issues||jsonb_build_array('Не у всех структурных элементов указаны сроки'); end if;
 if exists(
   select 1 from (
     select direction_no,component_kind,count(*) n from public.state_program_components
     where program_id=p.id and component_kind in ('project','target_program')
     group by direction_no,component_kind having count(*)>5
   ) q
 ) then v_issues:=v_issues||jsonb_build_array('В одном из направлений превышен лимит пяти проектов или пяти целевых программ'); end if;
 if v_expected_years>0 and v_budget_years<>v_expected_years
 then v_issues:=v_issues||jsonb_build_array('Финансирование указано не для каждого года реализации программы'); end if;
 if p.total_budget>0 and ((p.form_version=2 and v_annual_total is distinct from p.total_budget) or (p.form_version<>2 and abs(v_annual_total-p.total_budget)>0.01))
 then v_issues:=v_issues||jsonb_build_array('Сумма годовых бюджетных ассигнований не равна общему бюджету программы'); end if;
 if v_has_published_address and p.presidential_priority_id is null
 then v_issues:=v_issues||jsonb_build_array('Программа не связана с опубликованным приоритетом послания Президента'); end if;

 if p.total_budget::text in ('NaN','Infinity','-Infinity') or exists(select 1 from state_program_components where program_id=p.id and budget::text in ('NaN','Infinity','-Infinity')) then v_issues:=v_issues||jsonb_build_array('Бюджет должен состоять из конечных сумм');end if;
 if v_goals>50 or exists(select 1 from state_program_goals where program_id=p.id and (coalesce(baseline_value::text,'0') in ('NaN','Infinity','-Infinity') or coalesce(target_value::text,'0') in ('NaN','Infinity','-Infinity') or target_year not between 2000 and 2100 or target_year<extract(year from p.start_date) or target_year>extract(year from p.end_date))) then v_issues:=v_issues||jsonb_build_array('Проверьте число показателей, конечные значения и целевые годы в периоде программы');end if;
 if p.form_version=2 then
  if exists(select 1 from (select budget_year,sum(delta) difference from (
   select budget_year,amount as delta from state_program_expenses where program_id=p.id
   union all select budget_year,-amount from state_program_budget_years where program_id=p.id
  ) changes group by budget_year having sum(delta)<>0) inconsistent) then v_issues:=v_issues||jsonb_build_array('Годовое финансирование должно совпадать с построчными расходами каждого года');end if;
  if exists(select 1 from state_program_components c where c.program_id=p.id and c.budget is distinct from coalesce((select sum(e.amount) from state_program_expenses e where e.component_id=c.id and e.program_id=p.id),0)) then v_issues:=v_issues||jsonb_build_array('Бюджеты мероприятий должны совпадать со связанными строками расходов');end if;
 end if;

 if p.form_version=2 then
  if p.responsible_minister_id is null then v_issues:=v_issues||jsonb_build_array('Не назначен ответственный министр');end if;
  if not exists(select 1 from state_program_expenses where program_id=p.id) then v_issues:=v_issues||jsonb_build_array('Нет построчной таблицы расходов с обоснованиями');end if;
  if coalesce((select sum(amount) from state_program_expenses where program_id=p.id),0) is distinct from p.total_budget then v_issues:=v_issues||jsonb_build_array('Сумма расходов не соответствует паспорту программы');end if;
  if exists(select 1 from state_program_components c where c.program_id=p.id and (c.start_date<p.start_date or c.end_date>p.end_date or c.end_date<c.start_date)) then v_issues:=v_issues||jsonb_build_array('Сроки мероприятий выходят за период программы');end if;
  if exists(select 1 from state_program_goals where program_id=p.id and (target_value is null or target_year is null or nullif(trim(unit),'') is null)) then v_issues:=v_issues||jsonb_build_array('Каждому показателю нужны единица, целевое значение и год');end if;
 end if;
 return jsonb_build_object(
   'ready',jsonb_array_length(v_issues)=0,'issues',v_issues,'goals',v_goals,'directions',v_dirs,
   'components',v_components,'component_budget',v_component_budget,'total_budget',p.total_budget,
   'budget_years',v_budget_years,'expected_budget_years',v_expected_years,'annual_budget_total',v_annual_total
 );
end;$function$;


CREATE OR REPLACE FUNCTION public.advance_state_program(p_program_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_is_pm boolean;v_ready jsonb;
begin
 perform private.lock_active_program_actor((select game_id from public.state_programs where id=p_program_id));
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found'; end if;
 if v_uid is null or not private.is_game_member(p.game_id) or private.is_game_observer(p.game_id) then raise exception 'Game participant access required';end if;
 if not private.is_game_teacher(p.game_id) and not private.role_is_available(p.game_id,v_uid) then raise exception 'Участник недоступен для согласования';end if;
 select exists(select 1 from private.formal_user_roles(p.game_id,v_uid) r where r ~* '^председатель[[:space:]]+правительства([[:space:]]|$)') into v_is_pm;
 if p_action='pm_ready' and p.signed_at is not null then
  if not private.is_game_teacher(p.game_id) and not v_is_pm then raise exception 'Prime Minister access required';end if;
  return;
 end if;
 if p_action='submit_minister' then
  if p.status not in ('draft','revision') then raise exception 'Program is not awaiting submission';end if;
  if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required'; end if;
  v_ready:=private.state_program_readiness_json(p.id);
  if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Program is not ready: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  update public.state_programs set status='minister_review',updated_at=now() where id=p.id;
 elsif p_action in ('minister_approve','minister_revision') then
  if p.status<>'minister_review' then raise exception 'Program is not awaiting minister review';end if;
  if not private.is_game_teacher(p.game_id) and p.responsible_minister_id is distinct from v_uid then raise exception 'Responsible minister access required'; end if;
  if p_action='minister_approve' then
   v_ready:=private.state_program_readiness_json(p.id);
   if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Программа не готова: %',v_ready->'issues';end if;
  end if;
  update public.state_programs set status=case when p_action='minister_approve' then 'pm_review' else 'revision' end,updated_at=now() where id=p.id;
 elsif p_action in ('pm_ready','pm_revision') then
  if p.status<>'pm_review' then raise exception 'Program is not awaiting Prime Minister review';end if;
  if not private.is_game_teacher(p.game_id) and not v_is_pm then raise exception 'Prime Minister access required'; end if;
  if p_action='pm_ready' then
   v_ready:=private.state_program_readiness_json(p.id);
   if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Программа не готова к подписи: %',v_ready->'issues';end if;
  end if;
  update public.state_programs set status=case when p_action='pm_ready' then 'ready' else 'revision' end,updated_at=now() where id=p.id;
  if p_action='pm_ready' then perform private.publish_signed_state_program(p.id,v_uid);end if;
 else raise exception 'Unsupported program action'; end if;
end;$function$;


revoke all on function private.state_program_readiness_json(uuid) from public,anon,authenticated;
revoke all on function public.advance_state_program(uuid,text) from public,anon;
grant execute on function public.advance_state_program(uuid,text) to authenticated;

-- Preserve the existing government vote while sharing the signature's active
-- actor and exact Prime Minister checks, including formal office assignments.
create or replace function public.open_state_program_government_vote(p_program_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.state_programs%rowtype;v_uid uuid:=auth.uid();v_vote uuid;
begin
 perform private.lock_active_program_actor((select game_id from public.state_programs where id=p_program_id));
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found';end if;
 if not private.is_game_teacher(p.game_id) and not exists(
  select 1 from private.formal_user_roles(p.game_id,v_uid) r
  where r ~* '^председатель[[:space:]]+правительства([[:space:]]|$)'
 ) then raise exception 'Prime Minister access required';end if;
 if p.status<>'ready' then raise exception 'Program must pass minister and Prime Minister review first';end if;
 if p.form_version=2 and p.signed_at is null then raise exception 'Program must be signed before government voting';end if;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(p.game_id,11,'Государственная программа · '||p.title,
  'Решение Правительства по государственной программе. Кворум — не менее половины состава; решение при голосовании — большинством присутствующих.',
  'member','open',v_uid,'government','state_program','fraction',0.5,'present_majority',0.5,true,true,'none','none')
 returning id into v_vote;
 update public.state_programs set status='government_vote',government_vote_id=v_vote,updated_at=now() where id=p.id;
 return v_vote;
end;$$;
revoke all on function public.open_state_program_government_vote(uuid) from public,anon;
grant execute on function public.open_state_program_government_vote(uuid) to authenticated;

