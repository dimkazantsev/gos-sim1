-- Sequence: ministry -> PM preliminary approval -> agenda/presentation -> vote -> PM signature/publication.
-- Existing public posts and historic signatures are retained. Avoid widening RLS privileges.
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
  -- Preliminary PM approval transfers the unsigned programme to the Government agenda.
  -- The PM signs and publishes only after a passed vote.
 else raise exception 'Unsupported program action'; end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.open_program_vote_from_agenda(p_item_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare i public.government_program_agenda%rowtype;s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;
begin
 select * into i from public.government_program_agenda where id=p_item_id for update;
 if i.id is null then raise exception 'Agenda item not found'; end if;
 select * into s from public.government_sessions where id=i.session_id;
 if not private.can_manage_government_session(i.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'open' or i.status<>'presenting' then raise exception 'Complete presentation before opening the decision'; end if;
 perform set_config('app.gos_program_agenda_item',i.id::text,true);
 v_vote:=public.open_state_program_government_vote(i.program_id);
 perform set_config('app.gos_program_agenda_item','',true);
 update public.government_program_agenda set status='decision',vote_id=v_vote where id=i.id;
 return v_vote;
end;$function$;

CREATE OR REPLACE FUNCTION public.open_state_program_government_vote(p_program_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_uid uuid:=auth.uid();v_vote uuid;
begin
 perform private.lock_active_program_actor((select game_id from public.state_programs where id=p_program_id));
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found';end if;
 if not private.is_game_teacher(p.game_id) and not exists(
  select 1 from private.formal_user_roles(p.game_id,v_uid) r
  where r ~* '^председатель[[:space:]]+правительства([[:space:]]|$)'
 ) then raise exception 'Prime Minister access required';end if;
 if p.status<>'ready' then raise exception 'Сначала завершите согласование программы и включите её в повестку';end if;
 if p.signed_at is not null then raise exception 'Голосование проводится до подписи и публикации программы';end if;
 if not exists(select 1 from public.government_program_agenda a
   join public.government_sessions s on s.id=a.session_id and s.game_id=a.game_id
   where a.id=nullif(current_setting('app.gos_program_agenda_item',true),'')::uuid
     and a.program_id=p.id and a.game_id=p.game_id
     and a.status='presenting' and s.status='open' and s.stage_no=11)
 then raise exception 'Сначала представьте программу на открытом заседании Правительства';end if;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(p.game_id,11,'Государственная программа · '||p.title,
  'Решение Правительства по государственной программе. Кворум — не менее половины состава; решение при голосовании — большинством присутствующих.',
  'member','open',v_uid,'government','state_program','fraction',0.5,'present_majority',0.5,true,true,'none','none')
 returning id into v_vote;
 update public.state_programs set status='government_vote',government_vote_id=v_vote,updated_at=now() where id=p.id;
 return v_vote;
end;$function$;

CREATE OR REPLACE FUNCTION private.state_program_vote_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_doc uuid;v_steps jsonb;
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='state_program' then
  select * into p from public.state_programs where government_vote_id=new.id for update;
  if p.id is null then return new; end if;

  update public.state_programs
  set status=case when new.result_code='passed' then 'adopted' else 'rejected' end,updated_at=now()
  where id=p.id;

  if new.result_code='passed'
     and not exists(
       select 1 from public.formal_documents
       where game_id=p.game_id and stage_no=11 and doc_type='government_resolution'
         and metadata->>'state_program_id'=p.id::text
     )
  then
    v_doc:=public.create_formal_document(
      p.game_id,11,'Об утверждении государственной программы «'||p.title||'»',
      'government_resolution','government','Правительство Российской Федерации',
      'Правительство Российской Федерации постановляет: утвердить государственную программу «'||p.title||
      '». Ответственный исполнитель: '||p.responsible_ministry||
      '. Срок реализации: '||coalesce(p.start_date::text,'не указан')||' — '||coalesce(p.end_date::text,'не указан')||
      '. Общий объём бюджетных ассигнований: '||p.total_budget::text||'.',
      null,null,null,'government_act',
      jsonb_build_object('state_program_id',p.id,'government_vote_id',new.id,'auto_generated',true)
    );
    -- A favourable vote creates only the draft resolution.
    -- The published programme and resolution are released together by the PM signature RPC.
  end if;
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.publish_signed_state_program(p_program_id uuid, p_signer uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p state_programs%rowtype;post_id uuid;signer_name text;body_text text;signed_time timestamptz:=now();
begin
 select * into p from state_programs where id=p_program_id for update;
 if p.signed_at is not null then return;end if;
 if p.status<>'adopted' or p_signer is distinct from auth.uid() then raise exception 'Подпись программы недоступна';end if;
 select full_name into signer_name from game_members where game_id=p.game_id and user_id=p_signer;
 body_text:=concat_ws(E'\n',p.title,'Ответственное министерство: '||p.responsible_ministry,'Национальная цель: '||p.national_goal,'Период: '||p.start_date||' — '||p.end_date,'Участники: '||p.participants,'Ожидаемые результаты: '||p.expected_results,
 'Цели и показатели:',(select string_agg(goal_text||' · '||indicator_name||': '||coalesce(baseline_value::text,'—')||' → '||coalesce(target_value::text,'—')||' '||coalesce(unit,'')||' ('||coalesce(target_year::text,'—')||')',E'\n' order by created_at,id) from state_program_goals where program_id=p.id),
 'Направления и мероприятия:',(select string_agg(direction_no||'. '||direction_title||' · '||title||': '||goal_text||' · '||coalesce(start_date::text,'—')||' — '||coalesce(end_date::text,'—')||' · '||budget||' ₽',E'\n' order by direction_no,created_at,id) from state_program_components where program_id=p.id),
 'Расходы в рублях:',(select string_agg(e.budget_year||' · '||e.indicator_name||' · '||e.justification||' · '||e.amount||' ₽',E'\n' order by e.position,e.id) from state_program_expenses e where e.program_id=p.id),
 'Финансирование по годам:',(select string_agg(budget_year||': '||amount||' ₽',E'\n' order by budget_year) from state_program_budget_years where program_id=p.id),
 'Всего: '||p.total_budget||' ₽','Подписал Председатель Правительства: '||coalesce(signer_name,'Уполномоченный участник'),
 'Программа принята голосованием Правительства и подписана Председателем Правительства. Бюджетные ассигнования утверждаются бюджетной процедурой.');
 insert into political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,status,source_key,context)
 values(p.game_id,p_signer,'information','government','Правительство','Подписана государственная программа: '||p.title,body_text,array['Государственная программа','Бюджет'],'published','state_program_signed:'||p.id,jsonb_build_object('state_program_id',p.id,'stage_no',11))
 on conflict(game_id,source_key) where source_key is not null do nothing returning id into post_id;
 if post_id is null then select id into post_id from political_posts where game_id=p.game_id and source_key='state_program_signed:'||p.id;end if;
 insert into state_program_budget_commitments(program_id,game_id,budget_year,amount,status,signed_by,signed_at)
 select p.id,p.game_id,budget_year,amount,'approved',p_signer,signed_time from state_program_budget_years where program_id=p.id
 on conflict(program_id,budget_year) do nothing;
 update state_programs set signed_by=p_signer,signed_at=signed_time,publication_post_id=post_id,updated_at=now() where id=p.id;
end;$function$;

create or replace function public.sign_adopted_state_program(p_program_id uuid)
 returns void language plpgsql security definer
 set search_path to 'public','private','pg_temp'
as $sign$
declare p public.state_programs%rowtype;
 v_uid uuid:=(select auth.uid());
 v_doc public.formal_documents%rowtype;
begin
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Государственная программа не найдена'; end if;
 if v_uid is null or not private.is_game_member(p.game_id) or private.is_game_observer(p.game_id) then
  raise exception 'Требуются полномочия действующего участника';end if;
 if not private.is_game_teacher(p.game_id)
   and (not private.role_is_available(p.game_id,v_uid)
     or not exists(select 1 from private.formal_user_roles(p.game_id,v_uid) r
      where r ~* '^председатель[[:space:]]+правительства([[:space:]]|$)')) then
   raise exception 'Подписать программу может только Председатель Правительства';end if;
 if p.status<>'adopted' or p.government_vote_id is null
  or not exists(select 1 from public.game_votes v
    where v.id=p.government_vote_id and v.game_id=p.game_id and v.status='closed'
      and v.procedure_key='state_program' and v.result_code='passed'
      and v.result_quorum_met) then
  raise exception 'Подпись доступна только после положительного голосования Правительства с кворумом';end if;
 select * into v_doc from public.formal_documents d
 where d.game_id=p.game_id and d.stage_no=11
   and d.doc_type='government_resolution'
   and d.metadata->>'state_program_id'=p.id::text
   and d.metadata->>'government_vote_id'=p.government_vote_id::text
 order by d.created_at limit 1 for update;
 if v_doc.id is null then raise exception 'Не найдено постановление по итогам голосования';end if;
 if p.signed_at is null then
  perform private.publish_signed_state_program(p.id,v_uid);
 end if;
 if v_doc.status_code='published' then return;end if;
 if v_doc.status_code<>'draft' then raise exception 'Непредусмотренный статус постановления';end if;
 update public.formal_documents
 set current_step=3,status_code='published',status_label='Подписан и опубликован',
     current_owner_key='system',updated_at=now()
 where id=v_doc.id;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,
  from_status,to_status,from_owner,to_owner,note)
 values(v_doc.id,p.game_id,v_uid,'Подписано Председателем Правительства после голосования',
  'draft','published',coalesce(v_doc.current_owner_key,'author'),'system',
  'Положительное решение Правительства зафиксировано в голосовании; программа подписана и опубликована.');
end
$sign$;
REVOKE ALL ON FUNCTION public.sign_adopted_state_program(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_adopted_state_program(uuid) TO authenticated;
