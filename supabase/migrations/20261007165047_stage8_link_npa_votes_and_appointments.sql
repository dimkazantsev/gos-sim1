alter table public.government_nominations
  add column if not exists formal_document_id uuid references public.formal_documents(id) on delete set null,
  add column if not exists appointment_document_id uuid references public.formal_documents(id) on delete set null;

alter table public.government_structures
  add column if not exists formal_document_id uuid references public.formal_documents(id) on delete set null;

create or replace function private.stage8_create_formal_document(
 p_game_id uuid,
 p_title text,
 p_doc_type text,
 p_subject_key text,
 p_subject_label text,
 p_body text,
 p_workflow_key text,
 p_step integer,
 p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 v_id uuid:=gen_random_uuid();
 v_uid uuid:=coalesce(auth.uid(),(select owner_id from public.games where id=p_game_id));
 v_steps jsonb;
 v_prefix text;
 v_no bigint;
 v_registry text;
 v_to text;
 v_from text;
begin
 if v_uid is null then raise exception 'Actor not found'; end if;
 v_steps:=private.formal_workflow(p_workflow_key);
 if jsonb_array_length(v_steps)=0 then raise exception 'Formal workflow is empty'; end if;
 if p_step<0 or p_step>=jsonb_array_length(v_steps) then raise exception 'Invalid workflow step'; end if;

 v_prefix:=case p_doc_type
  when 'gd_resolution' then 'ПГД'
  when 'president_decree' then 'УК'
  else 'НПА'
 end;
 v_no:=nextval('public.formal_registry_seq');
 v_registry:='ИГРА-'||v_prefix||'-'||lpad(v_no::text,4,'0');
 v_to:=v_steps->p_step->>'code';
 v_from:=case when p_step>0 then v_steps->(p_step-1)->>'code' else v_to end;

 insert into public.formal_documents(
  id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
  body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
 ) values(
  v_id,p_game_id,8,v_registry,trim(p_title),p_doc_type,p_subject_key,p_subject_label,v_uid,
  p_body,p_workflow_key,v_steps,p_step,v_to,v_steps->p_step->>'label',v_steps->p_step->>'owner',
  coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('stage_no',8,'automatic',true)
 );

 insert into public.formal_document_history(
  document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note
 ) values(
  v_id,p_game_id,v_uid,
  case when p_doc_type='gd_resolution' then 'Кандидатура внесена в повестку Государственной Думы'
       else 'Акт оформлен автоматически по результату процедуры этапа 8' end,
  v_from,v_to,
  case when p_step>0 then v_steps->(p_step-1)->>'owner' else v_steps->p_step->>'owner' end,
  v_steps->p_step->>'owner',
  p_title
 );
 return v_id;
end;
$$;
revoke all on function private.stage8_create_formal_document(uuid,text,text,text,text,text,text,integer,jsonb) from public,anon,authenticated;

create or replace function private.stage8_create_appointment_decree(p_nomination_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 n public.government_nominations%rowtype;
 v_doc uuid;
 v_title text;
 v_body text;
begin
 select * into n from public.government_nominations where id=p_nomination_id;
 if n.id is null then raise exception 'Nomination not found'; end if;
 if n.office_kind='central_bank_chair' then return null; end if;
 if n.appointment_document_id is not null then return n.appointment_document_id; end if;

 v_title:='О назначении '||n.candidate_name||' на должность '||n.office_title;
 v_body:='УКАЗ ПРЕЗИДЕНТА РОССИЙСКОЙ ФЕДЕРАЦИИ'||E'\n\n'||v_title||E'\n\n'
  ||'Назначить '||n.candidate_name||' на должность '||n.office_title||'.'
  ||E'\n\nНастоящий Указ вступает в силу со дня его подписания.';

 v_doc:=private.stage8_create_formal_document(
  n.game_id,v_title,'president_decree','president','Президент Российской Федерации',
  v_body,'president_decree',2,
  jsonb_build_object(
   'purpose','government_appointment',
   'nomination_id',n.id,
   'office_key',n.office_key,
   'candidate_name',n.candidate_name
  )
 );

 update public.government_nominations set appointment_document_id=v_doc,updated_at=now() where id=n.id;
 return v_doc;
end;
$$;
revoke all on function private.stage8_create_appointment_decree(uuid) from public,anon,authenticated;

create or replace function public.submit_government_nomination(
 p_game_id uuid,p_office_key text,p_office_title text,p_office_kind text,p_candidate_user_id uuid,p_candidate_name text
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 v_uid uuid:=(select auth.uid());
 v_role text;
 v_route text;
 v_attempt integer;
 v_id uuid;
 v_structure_status text;
 v_doc uuid;
 v_body text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_office_kind not in ('prime_minister','deputy_pm','duma_minister','security_minister','central_bank_chair') then raise exception 'Unsupported office kind'; end if;
 if length(trim(coalesce(p_office_key,'')))<2 or length(trim(coalesce(p_office_title,'')))<3 or length(trim(coalesce(p_candidate_name,'')))<3 then raise exception 'Office and candidate are required'; end if;
 if p_candidate_user_id is not null and not exists(
  select 1 from public.game_members where game_id=p_game_id and user_id=p_candidate_user_id and kind='student'
 ) then raise exception 'Candidate must be a game participant'; end if;

 v_role:=private.game_role(p_game_id,v_uid);
 select status into v_structure_status from public.government_structures where game_id=p_game_id;

 if p_office_kind in ('prime_minister','central_bank_chair') then
  v_route:='president_to_duma';
  if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
 elsif p_office_kind in ('deputy_pm','duma_minister') then
  v_route:='pm_to_duma';
  if not private.is_appointed_pm(p_game_id,v_uid) then raise exception 'Appointed Prime Minister role required'; end if;
  if v_structure_status<>'approved' then raise exception 'Government structure must be approved first'; end if;
  if p_office_key not in ('ministry_social','ministry_economic','ministry_foreign') then raise exception 'This portfolio belongs to the Duma-approved group'; end if;
 else
  v_route:='president_after_sf';
  if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
  if v_structure_status<>'approved' then raise exception 'Government structure must be approved first'; end if;
  if p_office_key not in ('ministry_defence','ministry_internal') then raise exception 'Unsupported special portfolio'; end if;
 end if;

 if p_office_kind in ('deputy_pm','duma_minister','security_minister') and exists(
  select 1 from public.government_nominations where game_id=p_game_id and office_key=p_office_key and status='appointed'
 ) then raise exception 'This ministry already has an appointed head'; end if;

 select coalesce(max(attempt_no),0)+1 into v_attempt
 from public.government_nominations where game_id=p_game_id and office_key=trim(p_office_key);
 if v_attempt>3 and p_office_kind in ('prime_minister','deputy_pm','duma_minister') then
  raise exception 'Three Duma rejections have already been recorded for this office';
 end if;

 insert into public.government_nominations(
  game_id,office_key,office_title,office_kind,route,candidate_user_id,candidate_name,attempt_no,status,nominated_by
 ) values(
  p_game_id,trim(p_office_key),trim(p_office_title),p_office_kind,v_route,p_candidate_user_id,trim(p_candidate_name),v_attempt,
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

 return v_id;
end;
$$;
revoke all on function public.submit_government_nomination(uuid,text,text,text,uuid,text) from public,anon;
grant execute on function public.submit_government_nomination(uuid,text,text,text,uuid,text) to authenticated;

create or replace function public.open_government_nomination_vote(p_nomination_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 n public.government_nominations%rowtype;
 v_uid uuid:=(select auth.uid());
 v_vote uuid;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;
 if n.id is null then raise exception 'Nomination not found'; end if;
 if not private.is_game_teacher(n.game_id) then raise exception 'Teacher access required'; end if;
 if n.route not in ('president_to_duma','pm_to_duma') or n.status<>'submitted' then raise exception 'This nomination is not ready for a Duma vote'; end if;

 insert into public.game_votes(
  game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,
  pass_transition,fail_transition,formal_document_id,formal_step_code
 ) values(
  n.game_id,8,'Утверждение кандидатуры · '||n.office_title,
  n.candidate_name||'. Для принятия решения требуется большинство от общего числа депутатов Государственной Думы.',
  'mandate','open',v_uid,'gd','government_nomination',
  'fraction',0.5,'eligible_majority',0.5,true,false,'none','none',
  n.formal_document_id,'agenda'
 ) returning id into v_vote;

 update public.government_nominations set status='vote_open',vote_id=v_vote,updated_at=now() where id=n.id;
 return v_vote;
end;
$$;
revoke all on function public.open_government_nomination_vote(uuid) from public,anon;
grant execute on function public.open_government_nomination_vote(uuid) to authenticated;

create or replace function private.government_nomination_vote_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 n public.government_nominations%rowtype;
 v_rejections integer;
 v_old_status text;
begin
 if new.status='closed' and old.status is distinct from new.status then
  select * into n from public.government_nominations where vote_id=new.id for update;
  if n.id is not null then
   if n.formal_document_id is not null then
    select status_code into v_old_status from public.formal_documents where id=n.formal_document_id;
   end if;

   if new.result_code='passed' then
    if n.office_kind='central_bank_chair' then
     update public.government_nominations set status='appointed',decided_at=now(),appointed_at=now(),updated_at=now() where id=n.id;
     if n.candidate_user_id is not null then
      update public.game_members set role_title=n.office_title where game_id=n.game_id and user_id=n.candidate_user_id;
     end if;
     insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
     values(n.game_id,8,'Формирование Правительства','notice','Государственная Дума назначила · '||n.office_title,n.candidate_name,n.nominated_by);
    else
     update public.government_nominations set status='approved',decided_at=now(),updated_at=now() where id=n.id;
    end if;

    if n.formal_document_id is not null then
     update public.formal_documents
     set current_step=3,status_code='published',status_label='Оформлено',current_owner_key='system',updated_at=now(),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('vote_id',new.id,'vote_result','passed')
     where id=n.formal_document_id;
     insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
     values(n.formal_document_id,n.game_id,coalesce(auth.uid(),n.nominated_by),
       case when n.office_kind='central_bank_chair' then 'Государственная Дума назначила кандидата' else 'Государственная Дума утвердила кандидатуру' end,
       coalesce(v_old_status,'agenda'),'published','gd_council','system',new.result_label);
    end if;

   elsif new.result_code in ('rejected','no_quorum') then
    update public.government_nominations set status='rejected',decided_at=now(),updated_at=now() where id=n.id;

    if n.formal_document_id is not null then
     update public.formal_documents
     set status_code='rejected',status_label='Отклонено Государственной Думой',current_owner_key='system',updated_at=now(),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('vote_id',new.id,'vote_result',coalesce(new.result_code,'rejected'))
     where id=n.formal_document_id;
     insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
     values(n.formal_document_id,n.game_id,coalesce(auth.uid(),n.nominated_by),'Государственная Дума отклонила кандидатуру',
       coalesce(v_old_status,'agenda'),'rejected','gd_council','system',new.result_label);
    end if;

    select count(*)::integer into v_rejections
    from public.government_nominations where game_id=n.game_id and office_key=n.office_key and status='rejected';
    if v_rejections>=3 then
     insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
     values(n.game_id,8,'Формирование Правительства','critical','Третье отклонение кандидатуры · '||n.office_title,
      case when n.office_kind='prime_minister'
       then 'Зафиксировано три отклонения кандидатур Председателя Правительства. Президент назначает Председателя Правительства и вправе распустить Государственную Думу и назначить новые выборы.'
       else 'Зафиксировано три отклонения кандидатур по этой должности. Применяются последствия правил этапа 8.'
      end,n.nominated_by);
    end if;
   end if;
  end if;
 end if;
 return new;
end;
$$;
revoke execute on function private.government_nomination_vote_trigger() from public,anon,authenticated;

create or replace function public.appoint_government_nominee(p_nomination_id uuid)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
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
 v_role:=private.game_role(n.game_id,v_uid);
 if not private.is_game_teacher(n.game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
 if n.route in ('president_to_duma','pm_to_duma') and n.status<>'approved' then raise exception 'Duma approval is required before appointment'; end if;
 if n.route='president_after_sf' and n.status<>'consulted' then raise exception 'Federation Council consultation must be recorded first'; end if;

 v_doc:=private.stage8_create_appointment_decree(n.id);

 update public.government_nominations set status='appointed',appointed_at=now(),updated_at=now(),appointment_document_id=coalesce(appointment_document_id,v_doc) where id=n.id;
 if n.candidate_user_id is not null then
  update public.game_members set role_title=n.office_title where game_id=n.game_id and user_id=n.candidate_user_id;
  if n.office_key like 'ministry_%' then
   v_unit_key:=substring(n.office_key from 10);
   update public.institution_units set head_user_id=n.candidate_user_id
   where game_id=n.game_id and unit_kind='ministry' and unit_key=v_unit_key;
  end if;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(n.game_id,8,'Формирование Правительства','notice','Назначение · '||n.office_title,n.candidate_name,v_uid);
end;
$$;
revoke all on function public.appoint_government_nominee(uuid) from public,anon;
grant execute on function public.appoint_government_nominee(uuid) to authenticated;

create or replace function public.appoint_government_nominee_after_three_rejections(p_nomination_id uuid)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
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
 v_role:=private.game_role(n.game_id,v_uid);
 if not private.is_game_teacher(n.game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;

 select count(*)::integer into v_rejections
 from public.government_nominations
 where game_id=n.game_id and office_key=n.office_key and status='rejected';
 if v_rejections<3 then raise exception 'Three Duma rejections are required'; end if;

 v_doc:=private.stage8_create_appointment_decree(n.id);

 update public.government_nominations
 set status='appointed',appointed_at=now(),decided_at=coalesce(decided_at,now()),updated_at=now(),
     appointment_document_id=coalesce(appointment_document_id,v_doc),
     note=trim(both from concat_ws(E'\n',nullif(note,''),'Назначено Президентом после трёх отклонений Государственной Думой.'))
 where id=n.id;

 if n.candidate_user_id is not null then
  update public.game_members set role_title=n.office_title where game_id=n.game_id and user_id=n.candidate_user_id;
  if n.office_key like 'ministry_%' then
   v_unit_key:=substring(n.office_key from 10);
   update public.institution_units set head_user_id=n.candidate_user_id
   where game_id=n.game_id and unit_kind='ministry' and unit_key=v_unit_key;
  end if;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(n.game_id,8,'Формирование Правительства','notice','Назначение после трёх отклонений · '||n.office_title,n.candidate_name,v_uid);
end;
$$;
revoke all on function public.appoint_government_nominee_after_three_rejections(uuid) from public,anon;
grant execute on function public.appoint_government_nominee_after_three_rejections(uuid) to authenticated;

create or replace function public.review_government_structure(p_game_id uuid,p_action text,p_note text default null)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 v_uid uuid:=(select auth.uid());
 v_role text;
 s public.government_structures%rowtype;
 v_doc uuid;
 v_body text;
begin
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President / teacher access required'; end if;
 if p_action not in ('approve','revision') then raise exception 'Unsupported structure decision'; end if;
 select * into s from public.government_structures where game_id=p_game_id and status='submitted' for update;
 if s.game_id is null then raise exception 'Submitted structure not found'; end if;

 update public.government_structures
 set status=case when p_action='approve' then 'approved' else 'revision' end,
     note=nullif(trim(coalesce(p_note,'')),''),
     reviewed_by=v_uid,reviewed_at=now(),updated_at=now()
 where game_id=p_game_id;

 if p_action='approve' then
  update public.institution_units u
  set title=case u.unit_key
    when 'social' then s.social_title when 'economic' then s.economic_title when 'defence' then s.defence_title
    when 'foreign' then s.foreign_title when 'internal' then s.internal_title else u.title end
  where u.game_id=p_game_id and u.unit_kind='ministry';

  if s.formal_document_id is null then
   v_body:='УКАЗ ПРЕЗИДЕНТА РОССИЙСКОЙ ФЕДЕРАЦИИ'
    ||E'\n\nОб утверждении структуры Правительства Российской Федерации'
    ||E'\n\nУтвердить структуру Правительства Российской Федерации в составе пяти министерств:'
    ||E'\n1. '||s.social_title
    ||E'\n2. '||s.economic_title
    ||E'\n3. '||s.foreign_title
    ||E'\n4. '||s.defence_title
    ||E'\n5. '||s.internal_title||'.';
   v_doc:=private.stage8_create_formal_document(
    p_game_id,'Об утверждении структуры Правительства Российской Федерации',
    'president_decree','president','Президент Российской Федерации',
    v_body,'president_decree',2,
    jsonb_build_object('purpose','government_structure','five_ministries',true)
   );
   update public.government_structures set formal_document_id=v_doc where game_id=p_game_id;
  end if;
 end if;
end;
$$;
revoke all on function public.review_government_structure(uuid,text,text) from public,anon;
grant execute on function public.review_government_structure(uuid,text,text) to authenticated;
