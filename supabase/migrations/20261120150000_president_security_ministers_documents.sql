-- ГОС.ID: назначения осуществляет Президент, а не преподаватель.
-- 3 портфеля проходят консультации Совета Федерации (в том числе внешняя политика).
-- Президент редактирует собственные указы с историей редакций и повторной подписью.
-- Изменения не создают новые таблицы, запросы при просмотре или Realtime-подписки.
CREATE OR REPLACE FUNCTION public.appoint_government_nominee(p_nomination_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 n public.government_nominations%rowtype;
 v_uid uuid:=(select auth.uid());
 v_role text;
 v_unit_key text;
 v_doc uuid;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;
 if n.id is null then raise exception 'Nomination not found'; end if;
 if n.office_kind='central_bank_chair' then raise exception 'The Chair of the Bank of Russia is appointed by the State Duma vote itself'; end if;
 if v_uid is null or not private.is_game_member(n.game_id) then raise exception 'Game access required';end if;
 v_role:=coalesce(private.game_role(n.game_id,v_uid),'');
 if private.is_game_teacher(n.game_id) or not private.can_manage_presidential_policy(n.game_id,v_uid) then raise exception 'President role required'; end if;
 if n.route in ('president_to_duma','pm_to_duma') and n.status<>'approved' then raise exception 'Duma approval is required before appointment'; end if;
 if n.route='president_after_sf' and n.status<>'consulted' then raise exception 'Federation Council consultation must be recorded first'; end if;

 if n.stage_no=9 and not exists (
  select 1 from public.game_members m
  where m.game_id=n.game_id and m.user_id=n.candidate_user_id
   and m.kind='student' and m.roster_archived_at is null
   and lower(regexp_replace(trim(m.full_name),'[[:space:]]+',' ','g'))
       =lower(regexp_replace(trim(n.candidate_name),'[[:space:]]+',' ','g'))
 ) then raise exception 'Minister must be a registered active student of this game';end if;

 v_doc:=private.stage8_create_appointment_decree(n.id);

 update public.government_nominations set status='appointed',appointed_at=now(),updated_at=now(),appointment_document_id=coalesce(appointment_document_id,v_doc) where id=n.id;
 if n.candidate_user_id is not null then
  update public.game_members m
  set role_title=case when exists(
    select 1 from public.game_office_assignments a
    where a.game_id=n.game_id and a.user_id=n.candidate_user_id
      and a.status='active'
      and lower(trim(a.role_title))='президент российской федерации'
  ) then 'Президент Российской Федерации'
    when private.is_appointed_pm(n.game_id,n.candidate_user_id)
      then 'Председатель Правительства Российской Федерации'
    else n.office_title end
  where m.game_id=n.game_id and m.user_id=n.candidate_user_id;
  if n.office_key like 'ministry_%' then
   v_unit_key:=substring(n.office_key from 10);
   update public.institution_units set head_user_id=n.candidate_user_id
   where game_id=n.game_id and unit_kind='ministry' and unit_key=v_unit_key;
  end if;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(n.game_id,n.stage_no,'Формирование Правительства','notice','Назначение · '||n.office_title,n.candidate_name,v_uid);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.appoint_government_nominee_after_three_rejections(p_nomination_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 n public.government_nominations%rowtype;
 v_uid uuid:=(select auth.uid());
 v_role text;
 v_rejections integer;
 v_unit_key text;
 v_doc uuid;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;
 if n.id is null then raise exception 'Nomination not found'; end if;
 if n.status<>'rejected' then raise exception 'Only a rejected nomination can be appointed under the three-rejection rule'; end if;
 if n.office_kind not in ('prime_minister','deputy_pm','duma_minister') then raise exception 'The three-rejection appointment rule does not apply to this office'; end if;
 if v_uid is null or not private.is_game_member(n.game_id) then raise exception 'Game access required';end if;
 v_role:=coalesce(private.game_role(n.game_id,v_uid),'');
 if private.is_game_teacher(n.game_id) or not private.can_manage_presidential_policy(n.game_id,v_uid) then raise exception 'President role required'; end if;

 select count(*)::integer into v_rejections
 from public.government_nominations
 where game_id=n.game_id and office_key=n.office_key and status='rejected';
 if v_rejections<3 then raise exception 'Three Duma rejections are required'; end if;

 if n.stage_no=9 and not exists (
  select 1 from public.game_members m
  where m.game_id=n.game_id and m.user_id=n.candidate_user_id
   and m.kind='student' and m.roster_archived_at is null
   and lower(regexp_replace(trim(m.full_name),'[[:space:]]+',' ','g'))
       =lower(regexp_replace(trim(n.candidate_name),'[[:space:]]+',' ','g'))
 ) then raise exception 'Minister must be a registered active student of this game';end if;

 v_doc:=private.stage8_create_appointment_decree(n.id);

 update public.government_nominations
 set status='appointed',appointed_at=now(),decided_at=coalesce(decided_at,now()),updated_at=now(),
     appointment_document_id=coalesce(appointment_document_id,v_doc),
     note=trim(both from concat_ws(E'\n',nullif(note,''),'Назначено Президентом после трёх отклонений Государственной Думой.'))
 where id=n.id;

 if n.candidate_user_id is not null then
  update public.game_members m
  set role_title=case when exists(
    select 1 from public.game_office_assignments a
    where a.game_id=n.game_id and a.user_id=n.candidate_user_id
      and a.status='active'
      and lower(trim(a.role_title))='президент российской федерации'
  ) then 'Президент Российской Федерации'
    when private.is_appointed_pm(n.game_id,n.candidate_user_id)
      then 'Председатель Правительства Российской Федерации'
    else n.office_title end
  where m.game_id=n.game_id and m.user_id=n.candidate_user_id;
  if n.office_key like 'ministry_%' then
   v_unit_key:=substring(n.office_key from 10);
   update public.institution_units set head_user_id=n.candidate_user_id
   where game_id=n.game_id and unit_kind='ministry' and unit_key=v_unit_key;
  end if;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(n.game_id,n.stage_no,'Формирование Правительства','notice','Назначение после трёх отклонений · '||n.office_title,n.candidate_name,v_uid);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_government_nomination(p_game_id uuid, p_office_key text, p_office_title text, p_office_kind text, p_candidate_user_id uuid, p_candidate_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_uid uuid:=(select auth.uid());
 v_role text;
 v_route text;
 v_attempt integer;
 v_id uuid;
 v_structure_status text;
 v_doc uuid;
 v_body text;
 v_stage integer:=case when p_office_kind in ('deputy_pm','duma_minister','security_minister') then 9 else 8 end;
begin
 if v_uid is null or not private.is_game_member(p_game_id) or private.is_game_observer(p_game_id) then raise exception 'Game participant access required'; end if;
 -- Serialize nominations in this classroom, including the attempt number.
 perform 1 from public.games where id=p_game_id for update;
 if p_office_kind not in ('prime_minister','deputy_pm','duma_minister','security_minister','central_bank_chair') then raise exception 'Unsupported office kind'; end if;
 if length(trim(coalesce(p_office_key,'')))<2 or length(trim(coalesce(p_office_title,'')))<3 or length(trim(coalesce(p_candidate_name,'')))<3 then raise exception 'Office and candidate are required'; end if;
 if v_stage=9 and p_candidate_user_id is null then raise exception 'Minister must be a registered active student in this game';end if;
 if p_candidate_user_id is not null and not exists(
  select 1 from public.game_members where game_id=p_game_id and user_id=p_candidate_user_id and kind='student' and roster_archived_at is null
 ) then raise exception 'Candidate must be a game participant'; end if;

 if v_stage=9 and not exists (
  select 1 from public.game_members m
  where m.game_id=p_game_id and m.user_id=p_candidate_user_id
   and m.kind='student' and m.roster_archived_at is null
   and lower(regexp_replace(trim(m.full_name),'[[:space:]]+',' ','g'))
       =lower(regexp_replace(trim(p_candidate_name),'[[:space:]]+',' ','g'))
 ) then raise exception 'Candidate name must match the selected registered student';end if;

 if p_office_kind in ('prime_minister','central_bank_chair') and p_office_key<>p_office_kind then raise exception 'Office key must match office kind';end if;
 if v_stage=9 and not exists(select 1 from public.government_nominations where game_id=p_game_id and office_kind='prime_minister' and status='appointed') then raise exception 'Appoint the Prime Minister at stage 8 first';end if;
 v_role:=coalesce(private.game_role(p_game_id,v_uid),'');
 select status into v_structure_status from public.government_structures where game_id=p_game_id;

 if p_office_kind in ('prime_minister','central_bank_chair') then
  v_route:='president_to_duma';
  if private.is_game_teacher(p_game_id) or not private.can_manage_presidential_policy(p_game_id,v_uid) then raise exception 'President role required'; end if;
 elsif p_office_kind in ('deputy_pm','duma_minister') then
  v_route:='pm_to_duma';
  if not private.is_appointed_pm(p_game_id,v_uid) then raise exception 'Appointed Prime Minister role required'; end if;
  if v_structure_status is distinct from 'approved' then raise exception 'Government structure must be approved first'; end if;
  if p_office_key not in ('ministry_social','ministry_economic') then raise exception 'This portfolio belongs to the Duma-approved group'; end if;
 else
  v_route:='president_after_sf';
  if private.is_game_teacher(p_game_id) or not private.can_manage_presidential_policy(p_game_id,v_uid) then raise exception 'President role required'; end if;
  if v_structure_status is distinct from 'approved' then raise exception 'Government structure must be approved first'; end if;
  if p_office_key not in ('ministry_defence','ministry_internal','ministry_foreign') then raise exception 'Unsupported special portfolio'; end if;
 end if;

 if exists(select 1 from public.government_nominations where game_id=p_game_id and office_key=trim(p_office_key) and status not in ('rejected','withdrawn')) then
  raise exception 'This office already has an active nomination or appointed head';end if;
 -- Repeated appointments to different ministries are allowed; the existing
 -- unique active nomination for the same office is still enforced above.

 select coalesce(max(attempt_no),0)+1 into v_attempt
 from public.government_nominations where game_id=p_game_id and office_key=trim(p_office_key);
 if v_attempt>3 and p_office_kind in ('prime_minister','deputy_pm','duma_minister') then
  raise exception 'Three Duma rejections have already been recorded for this office';
 end if;

 insert into public.government_nominations(
  game_id,stage_no,office_key,office_title,office_kind,route,candidate_user_id,candidate_name,attempt_no,status,nominated_by
 ) values(
  p_game_id,v_stage,trim(p_office_key),trim(p_office_title),p_office_kind,v_route,p_candidate_user_id,trim(p_candidate_name),v_attempt,
  case when v_route='president_after_sf' then 'consultation_pending' else 'submitted' end,v_uid
 ) returning id into v_id;

 if v_route in ('president_to_duma','pm_to_duma') then
  v_body:='ГОСУДАРСТВЕННАЯ ДУМА ФЕДЕРАЛЬНОГО СОБРАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ'
   ||E'\n\nПРОЕКТ ПОСТАНОВЛЕНИЯ'
   ||E'\n\nО кандидатуре '||trim(p_candidate_name)||' на должность '||trim(p_office_title)
   ||E'\n\nГосударственная Дума постановляет:'
   ||E'\n1. '||case when p_office_kind='central_bank_chair' then 'Назначить ' else 'Утвердить ' end
   ||trim(p_candidate_name)||' на должность '||trim(p_office_title)||'.'
   ||case when p_office_kind='central_bank_chair' then '' else E'\n2. Направить настоящее постановление Президенту Российской Федерации.' end;

  v_doc:=private.stage8_create_formal_document(
   p_game_id,
   'О кандидатуре '||trim(p_candidate_name)||' на должность '||trim(p_office_title),
   'gd_resolution','gd','Государственная Дума Федерального Собрания Российской Федерации',
   v_body,'gd_resolution',1,
   jsonb_build_object(
    'purpose','government_nomination',
    'nomination_id',v_id,
    'office_key',trim(p_office_key),
    'candidate_name',trim(p_candidate_name),
    'attempt_no',v_attempt
   )
  );
  update public.government_nominations set formal_document_id=v_doc where id=v_id;
 end if;

 -- После внесения Думской кандидатуры в той же транзакции открывается голосование.
 if v_route in ('president_to_duma','pm_to_duma') then
  perform private.ensure_government_nomination_vote(v_id);
 end if;
 return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_formal_document_tools(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();manage boolean;open_vote boolean;has_ballot boolean;editable boolean;signable boolean;next_step jsonb;president_editor boolean;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or not private.is_game_member(d.game_id) then raise exception 'Документ недоступен';end if;
 manage:=d.status_code NOT IN ('rejected','superseded','withdrawn') AND private.matches_formal_owner(d.game_id,u,d.current_owner_key,d.author_id);
 open_vote:=exists(select 1 from public.game_votes where formal_document_id=d.id and status='open');
 -- An opened ballot is not yet a cast vote. Editing stops permanently
 -- once ANY linked vote has a ballot (open or closed), even from another user.
 has_ballot:=exists(
   select 1 from public.game_votes v join public.game_ballots b on b.vote_id=v.id
   where v.formal_document_id=d.id
 );
 president_editor:=d.doc_type='president_decree' and d.subject_key='president' and d.workflow_key='president_act'
  and d.status_code in ('draft','review','revision','signed','published')
  and not private.is_game_teacher(d.game_id) and private.can_manage_presidential_policy(d.game_id,u);
 editable:=not has_ballot and (private.is_game_teacher(d.game_id) or (manage and d.current_owner_key<>'system' and d.status_code not in ('signed','published','adopted','rejected')) or president_editor);
 next_step:=CASE WHEN d.status_code IN ('rejected','superseded','withdrawn') THEN NULL ELSE d.workflow_steps->(d.current_step+1) END;
 signable:=d.status_code NOT IN ('rejected','superseded','withdrawn') and not open_vote and not private.formal_vote_required(d) and (
  (manage and coalesce(d.workflow_steps->d.current_step->>'action','') ilike '%подпис%')
  or ((d.metadata->>'signed_by'=u::text) and d.status_code in ('signed','published','adopted')
   and d.metadata ? 'revision_changed_at'
   and (not (d.metadata ? 'signed_on') or (d.metadata->>'revision_changed_at')::timestamptz>(d.metadata->>'signed_on')::timestamptz))
  or (president_editor and d.status_code='signed' and d.metadata ? 'revision_changed_at'
   and (not (d.metadata ? 'signed_on') or (d.metadata->>'revision_changed_at')::timestamptz>(d.metadata->>'signed_on')::timestamptz))
 );
 return jsonb_build_object('can_edit',editable,'can_manage',manage,'can_sign',signable,
 'can_copy',exists(select 1 from public.game_members where game_id=d.game_id and user_id=u and kind<>'observer'),
 'vote_required',private.formal_vote_required(d),'open_vote',open_vote,'has_ballot',has_ballot,'next_owner',next_step->>'owner','next_action',CASE WHEN d.status_code IN ('rejected','superseded','withdrawn') THEN NULL ELSE d.workflow_steps->d.current_step->>'action' END);
end;$function$
;

CREATE OR REPLACE FUNCTION public.update_formal_draft(p_document_id uuid, p_title text, p_body_text text, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();access jsonb;rev integer;meta jsonb;change_note text;reopen_presidential boolean;
begin
 -- Vote submission locks its parent vote first. Lock in the same order
 -- before editing, so concurrent first ballots cannot be overlooked.
 -- One indexed lookup, only on explicit Save (no polling or new API calls).
 perform v.id from public.game_votes v where v.formal_document_id=p_document_id
 order by v.id for update;
 select * into d from public.formal_documents where id=p_document_id for update;
 if exists(
   select 1 from public.game_votes v join public.game_ballots b on b.vote_id=v.id
   where v.formal_document_id=p_document_id
 ) then raise exception 'Редактирование запрещено: по документу уже подан голос';end if;
 access:=public.get_formal_document_tools(p_document_id);
 if not (access->>'can_edit')::boolean then raise exception 'Редактирование недоступно: проверьте полномочия или статус документа';end if;
 if p_metadata ? 'expected_revision' and (p_metadata->>'expected_revision')::integer<>coalesce((d.metadata->>'revision')::integer,1) then raise exception 'Документ уже изменён другим участником. Откройте текущую редакцию и повторите правку';end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Введите название документа';end if;
 if length(coalesce(p_body_text,''))>1000000 then raise exception 'Текст документа слишком большой';end if;
 meta:=d.metadata;
 if p_metadata ? 'issuer_name' then meta:=meta||jsonb_build_object('issuer_name',left(trim(p_metadata->>'issuer_name'),300));end if;
 if p_metadata ? 'place' then meta:=meta||jsonb_build_object('place',left(trim(p_metadata->>'place'),150));end if;
 if trim(p_title)=d.title and p_body_text is not distinct from d.body_text and meta=d.metadata then return;end if;
 rev:=coalesce((d.metadata->>'revision')::integer,1);
 insert into public.formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
 values(d.game_id,d.id,rev,d.title,d.body_text,d.metadata,u);
 meta:=meta||jsonb_build_object('revision',rev+1,'revision_changed_at',clock_timestamp(),'revision_changed_by',u);
 reopen_presidential:=d.doc_type='president_decree' and d.subject_key='president'
  and d.workflow_key='president_act' and d.status_code='published'
  and not private.is_game_teacher(d.game_id) and private.can_manage_presidential_policy(d.game_id,u);
 update public.formal_documents set title=trim(p_title),body_text=p_body_text,metadata=meta,
  current_step=case when reopen_presidential then 1 else current_step end,
  status_code=case when reopen_presidential then 'review' else status_code end,
  status_label=case when reopen_presidential then 'Новая редакция — на подписи Президента' else status_label end,
  current_owner_key=case when reopen_presidential then 'president' else current_owner_key end,
  updated_at=clock_timestamp() where id=d.id;
 change_note:=nullif(left(trim(coalesce(p_metadata->>'edit_note','')),2000),'');
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,u,'Сохранена редакция '||(rev+1),d.status_code,case when reopen_presidential then 'review' else d.status_code end,d.current_owner_key,case when reopen_presidential then 'president' else d.current_owner_key end,change_note);
end;$function$
;

CREATE OR REPLACE FUNCTION public.sign_formal_document(p_document_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;access jsonb;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.workflow_key='budget' or d.doc_type='federal_budget' then perform private.lock_budget_actor(d.game_id);end if;
 access:=public.get_formal_document_tools(p_document_id);
 if not (access->>'can_sign')::boolean then raise exception 'Подписание этой редакции сейчас недоступно';end if;
 if d.status_code in ('signed','published','adopted') then
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,auth.uid(),'Подписана редакция '||coalesce(d.metadata->>'revision','1'),d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,p_note);
 else perform public.advance_formal_document(d.id,'advance',coalesce(nullif(p_note,''),'Подписано уполномоченным лицом'));end if;
 if d.doc_type='president_decree' and d.workflow_key='president_act' then
  update public.formal_documents set
   metadata=metadata||jsonb_build_object('signed_by',(select auth.uid())::text,'signed_on',clock_timestamp()),
   updated_at=clock_timestamp()
  where id=d.id;
 end if;
end;$function$
;
