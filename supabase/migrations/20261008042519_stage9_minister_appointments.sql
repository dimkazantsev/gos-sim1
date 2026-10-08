-- Author clarification: minister appointments belong to stage 9; committees stay at stage 4.

CREATE OR REPLACE FUNCTION private.stage8_create_formal_document(p_game_id uuid, p_title text, p_doc_type text, p_subject_key text, p_subject_label text, p_body text, p_workflow_key text, p_step integer, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_id uuid:=gen_random_uuid();
 v_uid uuid:=coalesce(auth.uid(),(select owner_id from public.games where id=p_game_id));
 v_steps jsonb;
 v_prefix text;
 v_no bigint;
 v_registry text;
 v_to text;
 v_from text;
 v_stage integer:=case when p_metadata->>'office_key' like 'ministry_%' then 9 else 8 end;
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
  v_id,p_game_id,v_stage,v_registry,trim(p_title),p_doc_type,p_subject_key,p_subject_label,v_uid,
  p_body,p_workflow_key,v_steps,p_step,v_to,v_steps->p_step->>'label',v_steps->p_step->>'owner',
  coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('stage_no',v_stage,'automatic',true)
 );

 insert into public.formal_document_history(
  document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note
 ) values(
  v_id,p_game_id,v_uid,
  case when p_doc_type='gd_resolution' then 'Кандидатура внесена в повестку Государственной Думы'
       else 'Акт оформлен автоматически по результату процедуры этапа '||v_stage end,
  v_from,v_to,
  case when p_step>0 then v_steps->(p_step-1)->>'owner' else v_steps->p_step->>'owner' end,
  v_steps->p_step->>'owner',
  p_title
 );
 return v_id;
end;
$function$;


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
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_office_kind not in ('prime_minister','deputy_pm','duma_minister','security_minister','central_bank_chair') then raise exception 'Unsupported office kind'; end if;
 if length(trim(coalesce(p_office_key,'')))<2 or length(trim(coalesce(p_office_title,'')))<3 or length(trim(coalesce(p_candidate_name,'')))<3 then raise exception 'Office and candidate are required'; end if;
 if p_candidate_user_id is not null and not exists(
  select 1 from public.game_members where game_id=p_game_id and user_id=p_candidate_user_id and kind='student'
 ) then raise exception 'Candidate must be a game participant'; end if;

 if p_office_kind in ('prime_minister','central_bank_chair') and p_office_key<>p_office_kind then raise exception 'Office key must match office kind';end if;
 if v_stage=9 and not exists(select 1 from public.government_nominations where game_id=p_game_id and office_kind='prime_minister' and status='appointed') then raise exception 'Appoint the Prime Minister at stage 8 first';end if;
 v_role:=coalesce(private.game_role(p_game_id,v_uid),'');
 select status into v_structure_status from public.government_structures where game_id=p_game_id;

 if p_office_kind in ('prime_minister','central_bank_chair') then
  v_route:='president_to_duma';
  if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
 elsif p_office_kind in ('deputy_pm','duma_minister') then
  v_route:='pm_to_duma';
  if not private.is_appointed_pm(p_game_id,v_uid) then raise exception 'Appointed Prime Minister role required'; end if;
  if v_structure_status is distinct from 'approved' then raise exception 'Government structure must be approved first'; end if;
  if p_office_key not in ('ministry_social','ministry_economic','ministry_foreign') then raise exception 'This portfolio belongs to the Duma-approved group'; end if;
 else
  v_route:='president_after_sf';
  if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
  if v_structure_status is distinct from 'approved' then raise exception 'Government structure must be approved first'; end if;
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

 return v_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.open_government_nomination_vote(p_nomination_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
  n.game_id,n.stage_no,'Утверждение кандидатуры · '||n.office_title,
  n.candidate_name||'. Для принятия решения требуется большинство от общего числа депутатов Государственной Думы.',
  'mandate','open',v_uid,'gd','government_nomination',
  'fraction',0.5,'eligible_majority',0.5,true,false,'none','none',
  n.formal_document_id,'agenda'
 ) returning id into v_vote;

 update public.government_nominations set status='vote_open',vote_id=v_vote,updated_at=now() where id=n.id;
 return v_vote;
end;
$function$;


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
 values(n.game_id,n.stage_no,'Формирование Правительства','notice','Назначение · '||n.office_title,n.candidate_name,v_uid);
end;
$function$;


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
 values(n.game_id,n.stage_no,'Формирование Правительства','notice','Назначение после трёх отклонений · '||n.office_title,n.candidate_name,v_uid);
end;
$function$;


CREATE OR REPLACE FUNCTION private.government_nomination_vote_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
     values(n.game_id,n.stage_no,'Формирование Правительства','notice','Государственная Дума назначила · '||n.office_title,n.candidate_name,n.nominated_by);
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
     values(n.game_id,n.stage_no,'Формирование Правительства','critical','Третье отклонение кандидатуры · '||n.office_title,
      case when n.office_kind='prime_minister'
       then 'Зафиксировано три отклонения кандидатур Председателя Правительства. Президент назначает Председателя Правительства и вправе распустить Государственную Думу и назначить новые выборы.'
       else 'Зафиксировано три отклонения кандидатур по этой должности. Применяются последствия правил этапа '||n.stage_no||'.'
      end,n.nominated_by);
    end if;
   end if;
  end if;
 end if;
 return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.ensure_stage9_units(p_game_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_structures%rowtype;
begin
 if (select auth.uid()) is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 select * into s from public.government_structures where game_id=p_game_id and status='approved';
 if not found then return;end if;
 insert into public.institution_units(game_id,unit_kind,unit_key,title,description,capacity_min,capacity_max)
 values
 (p_game_id,'ministry','social',s.social_title,'Труд, демография, культура, образование, здравоохранение и смежные вопросы',3,5),
 (p_game_id,'ministry','economic',s.economic_title,'Финансы, налоги, транспорт, энергетика и смежные вопросы',3,5),
 (p_game_id,'ministry','defence',s.defence_title,'Оборона и внутренняя безопасность',3,5),
 (p_game_id,'ministry','foreign',s.foreign_title,'Внешняя политика',3,5),
 (p_game_id,'ministry','internal',s.internal_title,'ОГВ, ОМС, национальности, гражданское общество, НКО и смежные вопросы',3,5)
 on conflict(game_id,unit_kind,unit_key) do update set title=excluded.title
 where public.institution_units.title is distinct from excluded.title;
 update public.institution_units set capacity_min=3,capacity_max=5
 where game_id=p_game_id and unit_kind='ministry' and capacity_min is null;
 update public.institution_units u set head_user_id=n.candidate_user_id
 from public.government_nominations n
 where u.game_id=p_game_id and u.unit_kind='ministry' and n.game_id=p_game_id
  and n.stage_no=9 and n.status='appointed' and n.office_key='ministry_'||u.unit_key
  and n.candidate_user_id is not null and u.head_user_id is distinct from n.candidate_user_id;
 insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
 select u.game_id,u.id,'ministry',n.candidate_user_id,null,'head',n.nominated_by
 from public.institution_units u join public.government_nominations n
  on n.game_id=u.game_id and n.office_key='ministry_'||u.unit_key and n.stage_no=9 and n.status='appointed'
 where u.game_id=p_game_id and u.unit_kind='ministry' and n.candidate_user_id is not null
 on conflict(game_id,user_id,unit_kind) do update
 set unit_id=excluded.unit_id,assignment_role='head',party_id=null
 where public.institution_assignments.unit_id is distinct from excluded.unit_id
    or public.institution_assignments.assignment_role is distinct from 'head'
    or public.institution_assignments.party_id is not null;
end;$function$;


CREATE OR REPLACE FUNCTION public.set_institution_head(p_unit_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_role text;
begin
 select * into u from public.institution_units where id=p_unit_id for update;
 if u.id is null then raise exception 'Institution unit not found'; end if;
 if not exists(select 1 from public.game_members where game_id=u.game_id and user_id=p_user_id and kind='student') then raise exception 'Student not found'; end if;
 if v_uid is null or not private.is_game_member(u.game_id) then raise exception 'Game access required';end if;
 v_role:=coalesce(private.game_role(u.game_id,v_uid),'');
 if u.unit_kind='committee' then
   if not private.is_game_teacher(u.game_id) then raise exception 'Committee chair must be recorded after the Duma election by the teacher'; end if;
 else
   if not exists(select 1 from public.government_nominations n
     where n.game_id=u.game_id and n.stage_no=9 and n.office_key='ministry_'||u.unit_key
       and n.status='appointed' and n.candidate_user_id=p_user_id)
   then raise exception 'Minister must already be appointed through stage 9';end if;
   if not private.is_game_teacher(u.game_id) and v_role not like '%председател%правительств%' and v_role not like '%президент%'
   then raise exception 'Prime Minister / President / teacher access required'; end if;
 end if;
 update public.institution_units set head_user_id=p_user_id where id=u.id;
 if u.unit_kind='ministry' then
   insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
   values(u.game_id,u.id,'ministry',p_user_id,null,'head',v_uid)
   on conflict(game_id,user_id,unit_kind) do update set unit_id=excluded.unit_id,assignment_role='head',created_by=v_uid,created_at=now();
 else
   insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
   values(u.game_id,u.id,'committee',p_user_id,private.member_party_id(u.game_id,p_user_id),'head',v_uid)
   on conflict(game_id,user_id,unit_kind) do update set unit_id=excluded.unit_id,party_id=excluded.party_id,assignment_role='head',created_by=v_uid,created_at=now();
 end if;
end;$function$;


CREATE OR REPLACE FUNCTION private.stage_readiness_json(p_game uuid, p_stage integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 b jsonb:='[]'::jsonb;
 w jsonb:='[]'::jsonb;
 m jsonb:='{}'::jsonb;
 c integer:=0;
 c2 integer:=0;
 c3 integer:=0;
 n numeric:=0;
 s text;
begin
 if p_stage=1 then
  select count(*) into c from public.game_parties where game_id=p_game;
  select count(*) into c2 from public.game_parties where game_id=p_game and registration_status='registered';
  m:=jsonb_build_object('parties',c,'registered',c2);
  if c=0 then b:=b||jsonb_build_array('Не создано ни одной политической партии'); end if;
  if c>0 and c2<c then b:=b||jsonb_build_array('Не все партии получили итоговый статус «зарегистрирована»'); end if;
 elsif p_stage=2 then
  select count(*) into c from public.parliamentary_election_rules where game_id=p_game and status='adopted';
  m:=jsonb_build_object('adopted_rules',c);
  if c=0 then b:=b||jsonb_build_array('КСРФ не принял тип избирательной системы и электоральную формулу'); end if;
 elsif p_stage=3 then
  select count(*) into c from public.regional_election_rules where game_id=p_game and status='allocated';
  select coalesce(sum(regions),0) into n from public.game_parties where game_id=p_game;
  m:=jsonb_build_object('allocated_rules',c,'regions',n);
  if c=0 then b:=b||jsonb_build_array('Не зафиксирован итог распределения 89 субъектов РФ'); end if;
  if c>0 and n<>89 then b:=b||jsonb_build_array('Сумма контролируемых субъектов не равна 89'); end if;
 elsif p_stage=4 then
  select coalesce(sum(mandates),0) into n from public.game_parties where game_id=p_game;
  select count(*) into c from public.office_elections where game_id=p_game and stage_no=4 and office_key='gd_chair' and status='finished';
  select count(*) into c2 from public.office_elections where game_id=p_game and stage_no=4 and office_key in ('gd_deputy_1','gd_deputy_2') and status='finished';
  m:=jsonb_build_object('mandates',n,'chair_finished',c,'deputies_finished',c2);
  if n<>450 then b:=b||jsonb_build_array('Распределено не 450 мандатов Государственной Думы'); end if;
  if c=0 then b:=b||jsonb_build_array('Не завершены выборы Председателя Государственной Думы'); end if;
  if c2<2 then b:=b||jsonb_build_array('Не завершены выборы двух заместителей Председателя ГД'); end if;

  select count(*) into c from public.institution_units where game_id=p_game and unit_kind='committee';
  select count(*) into c2 from public.institution_units where game_id=p_game and unit_kind='committee' and head_user_id is not null;
  m:=m||jsonb_build_object('committees',c,'committee_heads',c2);
  if c<5 then b:=b||jsonb_build_array('На первом заседании ГД не созданы все пять комитетов');end if;
  if c>=5 and c2<5 then b:=b||jsonb_build_array('Не избраны председатели всех пяти комитетов ГД');end if;
  if exists(select 1 from public.institution_units u where u.game_id=p_game and u.unit_kind='committee'
    and not exists(select 1 from public.institution_assignments a where a.unit_id=u.id))
  then b:=b||jsonb_build_array('Есть комитеты ГД без участников');end if;
 elsif p_stage=5 then
  select count(*) into c from public.ghost_voting_policies where game_id=p_game and status='adopted';
  m:=jsonb_build_object('policy_adopted',c);
  if c=0 then b:=b||jsonb_build_array('ГД не приняла постановление о режиме Ghost voting'); end if;
  if exists(select 1 from public.game_parties where game_id=p_game and ghost_active) then w:=w||jsonb_build_array('Сейчас действует временная потеря мандатов Ghost voting; снимите её после завершения соответствующего заседания'); end if;
 elsif p_stage=6 then
  select count(*) into c from public.presidential_candidates where game_id=p_game and registration_status='registered';
  select count(*) into c2 from public.presidential_candidates where game_id=p_game and registration_status in ('submitted','revision');
  m:=jsonb_build_object('registered_candidates',c,'pending_candidates',c2);
  if c=0 then b:=b||jsonb_build_array('Нет ни одного зарегистрированного кандидата в Президенты'); end if;
  if c2>0 then w:=w||jsonb_build_array('Есть кандидатуры, которые ещё находятся на проверке или доработке'); end if;
 elsif p_stage=7 then
  select status into s from public.presidential_election_settings where game_id=p_game;
  select count(*) into c from public.presidential_system_proposals where game_id=p_game and status='adopted';
  select count(*) into c2 from public.formal_documents where game_id=p_game and stage_no=7 and doc_type='sf_resolution' and metadata->>'purpose'='presidential_election_appointment';
  m:=jsonb_build_object('election_status',coalesce(s,'not_configured'),'duma_system_decision',c,'sf_appointment_resolution',c2);
  if c=0 then b:=b||jsonb_build_array('Государственная Дума не приняла тип мажоритарной системы выборов Президента'); end if;
  if c2=0 then b:=b||jsonb_build_array('Не создано постановление Совета Федерации о назначении выборов Президента'); end if;
  if s is null then b:=b||jsonb_build_array('Модель президентских выборов не настроена');
  elsif s='manual_required' then b:=b||jsonb_build_array('Президентские выборы требуют ручного разрешения преподавателем');
  elsif s<>'finished' then b:=b||jsonb_build_array('Президентские выборы ещё не завершены'); end if;
 elsif p_stage=8 then
  select count(*) into c from public.government_nominations where game_id=p_game and stage_no=8 and office_kind='prime_minister' and status='appointed';
  select count(*) into c2 from public.government_structures where game_id=p_game and status='approved';
  select count(*) into c3 from public.government_nominations where game_id=p_game and stage_no=8 and office_kind='central_bank_chair' and status='appointed';
  m:=jsonb_build_object('prime_minister_appointed',c,'structure_approved',c2,'central_bank_chair_appointed',c3);
  if c=0 then b:=b||jsonb_build_array('Председатель Правительства ещё не назначен');end if;
  if c2=0 then b:=b||jsonb_build_array('Президент не одобрил структуру из пяти министерств');end if;
  if c3=0 then b:=b||jsonb_build_array('Не завершено назначение Председателя Банка России решением Государственной Думы');end if;
  if exists(select 1 from public.government_nominations where game_id=p_game and stage_no=8 and status not in ('appointed','withdrawn','rejected'))
  then w:=w||jsonb_build_array('Есть незавершённые кадровые процедуры этапа 8');end if;
 elsif p_stage=9 then
  select count(*) into c from public.institution_units where game_id=p_game and unit_kind='ministry';
  select count(*) into c2 from public.institution_assignments where game_id=p_game and unit_kind='ministry';
  select count(*) into c3 from public.game_members gm where gm.game_id=p_game and gm.kind='student'
   and not exists(select 1 from public.institution_assignments a where a.game_id=p_game and a.user_id=gm.user_id and a.unit_kind='ministry');
  select count(distinct office_key) into n from public.government_nominations where game_id=p_game and stage_no=9 and office_key like 'ministry_%' and status='appointed';
  m:=jsonb_build_object('ministries',c,'ministry_members',c2,'unassigned_students',c3,'ministers_appointed',n,
   'special_ministers',(select count(*) from public.government_nominations where game_id=p_game and stage_no=9 and office_kind='security_minister' and status='appointed'),
   'deputy_pm',(select count(*) from public.government_nominations where game_id=p_game and stage_no=9 and office_kind='deputy_pm' and status='appointed'));
  if not exists(select 1 from public.government_nominations where game_id=p_game and office_kind='prime_minister' and status='appointed')
   or not exists(select 1 from public.government_structures where game_id=p_game and status='approved')
  then b:=b||jsonb_build_array('Завершите назначение Председателя Правительства и утверждение структуры на этапе 8');end if;
  if c<5 then b:=b||jsonb_build_array('Пять министерств ещё не созданы из утверждённой структуры');end if;
  if n<5 then b:=b||jsonb_build_array('Назначьте руководителей всех пяти министерств на этом этапе');end if;
  if (select count(*) from public.government_nominations where game_id=p_game and stage_no=9 and office_kind='security_minister' and status='appointed')<2
  then b:=b||jsonb_build_array('Назначьте обоих специальных министров после консультаций с Советом Федерации');end if;
  if not exists(select 1 from public.government_nominations where game_id=p_game and stage_no=9 and office_kind='deputy_pm' and status='appointed')
  then b:=b||jsonb_build_array('Назначьте одного из министров заместителем Председателя Правительства');end if;
  if exists(select 1 from public.institution_units u where u.game_id=p_game and u.unit_kind='ministry'
    and not exists(select 1 from public.institution_assignments a where a.unit_id=u.id))
  then b:=b||jsonb_build_array('Есть министерства без участников');end if;
  if c3>0 then b:=b||jsonb_build_array('Не все участники распределены по министерствам');end if;
  if exists(select 1 from public.institution_units u where u.game_id=p_game and u.unit_kind='ministry'
    and (select count(*) from public.institution_assignments a where a.unit_id=u.id) not between coalesce(u.capacity_min,3) and coalesce(u.capacity_max,5))
  then w:=w||jsonb_build_array('Численность некоторых министерств выходит за ориентир 3–5 человек; учитывайте размер учебной группы');end if;
 elsif p_stage=10 then
  select count(*) into c from public.presidential_addresses where game_id=p_game and status='published';
  select count(*) into c2 from public.state_programs where game_id=p_game;
  select count(*) into c3 from public.state_programs where game_id=p_game and status not in ('ready','government_vote','adopted','rejected');
  m:=jsonb_build_object('published_addresses',c,'programs',c2,'unfinished_programs',c3);
  if c=0 then b:=b||jsonb_build_array('Не опубликовано послание Президента с приоритетами государственной политики'); end if;
  if c2<5 then b:=b||jsonb_build_array('Создано менее пяти государственных программ — по одной для каждого игрового министерства'); end if;
  if c3>0 then b:=b||jsonb_build_array('Есть государственные программы, не прошедшие этап разработки и предварительного согласования'); end if;
 elsif p_stage=11 then
  select count(*) into c from public.government_sessions where game_id=p_game and stage_no=11 and status='closed';
  select count(*) into c2 from public.state_programs where game_id=p_game and status not in ('adopted','rejected');
  select count(*) into c3 from public.state_programs where game_id=p_game and status='adopted';
  select count(*) into n from public.formal_documents where game_id=p_game and stage_no=11 and doc_type='government_resolution'
    and status_code='published' and metadata ? 'state_program_id';
  m:=jsonb_build_object('closed_sessions',c,'unresolved_programs',c2,'adopted_programs',c3,'government_resolutions',n);
  if c=0 then b:=b||jsonb_build_array('Не закрыто ни одного заседания Правительства по государственным программам'); end if;
  if c2>0 then b:=b||jsonb_build_array('Не по всем государственным программам принято итоговое решение Правительства'); end if;
  if n<c3 then b:=b||jsonb_build_array('Не все принятые государственные программы оформлены постановлениями Правительства'); end if;
 elsif p_stage=12 then
  select count(*) into c from public.formal_documents where game_id=p_game and stage_no=12 and workflow_key='bill';
  select count(*) into c2 from public.duma_sessions where game_id=p_game and stage_no=12 and status='closed';
  select count(*) into c3 from public.formal_documents where game_id=p_game and stage_no=12 and workflow_key='bill' and status_code in ('published','rejected');
  m:=jsonb_build_object(
   'bills',c,'closed_duma_sessions',c2,'terminal_bills',c3,
   'published_bills',(select count(*) from public.formal_documents where game_id=p_game and stage_no=12 and workflow_key='bill' and status_code='published')
  );
  if c=0 then b:=b||jsonb_build_array('В реестре НПА нет законопроекта, созданного на этапе 12'); end if;
  if c2=0 then b:=b||jsonb_build_array('Не завершено ни одного заседания Государственной Думы с законодательной повесткой'); end if;
  if c3=0 then b:=b||jsonb_build_array('Ни один законопроект этапа 12 не доведён до итогового решения по формальной процедуре'); end if;
  if exists(select 1 from public.duma_sessions where game_id=p_game and stage_no=12 and status='open') then w:=w||jsonb_build_array('Сейчас открыто заседание ГД; завершите или осознанно перенесите остаток повестки'); end if;
  if exists(
   select 1 from public.formal_documents d
   where d.game_id=p_game and d.stage_no=12 and d.workflow_key='bill'
     and d.status_code not in ('published','rejected')
  ) then w:=w||jsonb_build_array('Есть законопроекты, которые ещё проходят процедуру'); end if;
 elsif p_stage=13 then
  select count(*) into c from public.budget_scenarios where game_id=p_game and stage_no=13 and status='final';
  select count(*) into c2 from public.budget_scenarios where game_id=p_game and stage_no=13 and status='final' and formal_document_id is not null;
  select count(*) into c3
  from public.budget_scenarios s join public.formal_documents d on d.id=s.formal_document_id
  where s.game_id=p_game and s.stage_no=13 and s.status='final' and d.status_code='published';
  m:=jsonb_build_object(
   'final_scenarios',c,'budget_bills',c2,'published_budget_laws',c3,
   'preliminary_reviews_accepted',(select count(*) from public.budget_preliminary_reviews br join public.formal_documents d on d.id=br.document_id where br.game_id=p_game and d.stage_no=13 and br.decision='accept')
  );
  if c=0 then b:=b||jsonb_build_array('Не зафиксирован итоговый бюджетный сценарий'); end if;
  if c2=0 then b:=b||jsonb_build_array('Из финального сценария не создан проект федерального бюджета в реестре НПА'); end if;
  if c2>0 and not exists(
    select 1 from public.budget_scenarios s join public.formal_documents d on d.id=s.formal_document_id
    where s.game_id=p_game and s.stage_no=13 and s.status='final'
      and (d.status_code in ('reading1','amendments','reading2','reading3','sf','president','published','budget_conciliation')
        or exists(select 1 from public.budget_preliminary_reviews br where br.document_id=d.id and br.decision='accept'))
  ) then b:=b||jsonb_build_array('Проект федерального бюджета не прошёл предварительную проверку Комитета по бюджету и Совета ГД'); end if;
  if c2>0 and c3=0 then b:=b||jsonb_build_array('Федеральный бюджет не завершил I–III чтения, рассмотрение Советом Федерации и президентскую стадию'); end if;
 elsif p_stage=14 then
  select count(*) into c from public.municipal_mayor_elections where game_id=p_game and status='finished';
  select count(*) into c2 from public.municipal_districts where game_id=p_game;
  select count(*) into c3 from public.municipal_districts where game_id=p_game and head_user_id is not null;
  select count(distinct district_key) into n from public.municipal_projects
   where game_id=p_game and stage_no=14 and status in ('submitted','vote_open','adopted','rejected') and district_key is not null;
  m:=jsonb_build_object(
   'mayor_election_finished',c,'districts',c2,'district_heads',c3,'districts_with_project',n,
   'assigned_students',(select count(*) from public.municipal_district_members where game_id=p_game)
  );
  if c=0 then b:=b||jsonb_build_array('Не завершены тайные выборы главы города Барнаула'); end if;
  if c2<5 then b:=b||jsonb_build_array('Не сформированы все пять районных администраций Барнаула'); end if;
  if c3<5 then b:=b||jsonb_build_array('Назначены не все пять глав районных администраций'); end if;
  if n<5 then b:=b||jsonb_build_array('Не каждый район подготовил и передал на рассмотрение собственный муниципальный проект'); end if;
  if exists(
   select 1 from public.game_members gm
   where gm.game_id=p_game and gm.kind='student'
     and gm.user_id is distinct from (select winner_user_id from public.municipal_mayor_elections where game_id=p_game and status='finished' order by closed_at desc limit 1)
     and not exists(select 1 from public.municipal_district_members dm where dm.game_id=p_game and dm.user_id=gm.user_id)
  ) then w:=w||jsonb_build_array('Есть студенты, не распределённые по районным администрациям'); end if;
  if exists(select 1 from public.municipal_projects where game_id=p_game and stage_no=14 and status in ('fieldwork','draft')) then w:=w||jsonb_build_array('Есть муниципальные проекты, оставшиеся на полевом или черновом этапе'); end if;
 elsif p_stage=15 then
  select count(*) into c from public.game_crises where game_id=p_game and stage_no=15;
  select count(*) into c2 from public.game_crises where game_id=p_game and stage_no=15 and status='resolved';
  m:=jsonb_build_object('crises',c,'resolved',c2);
  if c=0 then b:=b||jsonb_build_array('Кризисный сценарий этапа 15 ещё не запущен'); end if;
  if exists(select 1 from public.game_crises where game_id=p_game and stage_no=15 and status='active') then b:=b||jsonb_build_array('Активный кризис ещё не завершён и не разобран'); end if;
  if c>0 and c2=0 then b:=b||jsonb_build_array('Нет завершённого кризисного сценария'); end if;
 elsif p_stage=16 then
  select count(*) into c from public.game_members where game_id=p_game and kind='student';
  select count(*) into c3 from (select user_id from public.game_reflections where game_id=p_game and status in ('submitted','reviewed') group by user_id having count(distinct phase_key)>=6) q;
  m:=jsonb_build_object('students',c,'students_completed_reflection',c3);
  if c=0 then b:=b||jsonb_build_array('В игре нет студентов, для которых можно провести итоговую рефлексию');
  elsif c3<c then b:=b||jsonb_build_array('Не все студенты сдали рефлексию по шести фазам игры'); end if;
  if exists(select 1 from public.game_reflections where game_id=p_game and status='submitted') then w:=w||jsonb_build_array('Есть сданные рефлексии, которые преподаватель ещё не разобрал'); end if;
 end if;
 return jsonb_build_object('stage_no',p_stage,'ready',jsonb_array_length(b)=0,'blockers',b,'warnings',w,'metrics',m);
end;
$function$;


CREATE OR REPLACE FUNCTION public.create_game_session(p_title text, p_game_code text, p_teacher_code text, p_student_code text, p_teacher_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 g uuid;
 c uuid;
begin
 if (select auth.uid()) is null then
   raise exception 'Authentication required';
 end if;
 if coalesce(trim(p_title),'') = '' or coalesce(trim(p_game_code),'') = '' then
   raise exception 'Title and game code are required';
 end if;
 if char_length(p_teacher_code) < 4 or char_length(p_student_code) < 4 then
   raise exception 'Invite codes must be at least 4 characters';
 end if;
 if p_teacher_code = p_student_code then
   raise exception 'Teacher and student codes must be different';
 end if;

 insert into public.games(title,game_code,owner_id,status)
 values(trim(p_title),upper(trim(p_game_code)),(select auth.uid()),'lobby')
 returning id into g;

 insert into public.game_members(game_id,user_id,full_name,kind,role_title)
 values(g,(select auth.uid()),trim(p_teacher_name),'teacher','Руководитель симуляции');

 insert into public.invite_codes(game_id,code_hash,kind) values
 (g,extensions.crypt(p_teacher_code,extensions.gen_salt('bf')),'teacher'),
 (g,extensions.crypt(p_student_code,extensions.gen_salt('bf')),'student');

 insert into public.state_metrics(game_id,metric_key,label,value,unit) values
 (g,'legitimacy','Легитимность',67,'%'),
 (g,'economy','Экономика',54,'%'),
 (g,'budget','Бюджет',742,'млн'),
 (g,'social_tension','Социальное напряжение',41,'%'),
 (g,'security','Безопасность',73,'%');

 insert into public.chat_channels(game_id,name,kind,created_by)
 values(g,'Общий штаб','public',(select auth.uid()))
 returning id into c;

 insert into public.rounds(game_id,round_no,status) values(g,1,'planned');

 insert into public.game_stages(game_id,stage_no,title,mode,summary,status) values
 (g,1,'Создание партий','Заочный','Учредительный съезд: название, идеология, программа минимум из 10 пунктов, символика, председатель и пакет документов для регистрации.','open'),
 (g,2,'Тип избирательной системы','Заочный','Определить тип системы выборов в ГД и электоральную формулу; позиции фракций, переговоры и голосование простым большинством.','locked'),
 (g,3,'Выборы в субъектах РФ','Заочный','Определить способ распределения контроля над региональными парламентами: случайный, пропорциональный или договорной.','locked'),
 (g,4,'Первое заседание Государственной Думы','Заочный / очный','Избрать руководство ГД, создать пять комитетов, распределить депутатов и избрать председателей комитетов.','locked'),
 (g,5,'Ghost voting','Заочный / очный','Определить режим ghost voting и разыгрывать отсутствие 25–50 депутатов перед соответствующими заседаниями.','locked'),
 (g,6,'Кандидаты в Президенты РФ','Заочный','Выдвижение кандидатов, политические программы и регистрационные документы в ЦИК.','locked'),
 (g,7,'Выборы Президента','Заочный / очный','Определить тип мажоритарной системы, провести кампанию, голосование и при необходимости второй тур, затем инаугурацию.','locked'),
 (g,8,'Председатель Правительства и структура','Заочный / очный','Назначение Председателя Правительства и Председателя Банка России; утверждение структуры из пяти министерств.','locked'),
 (g,9,'Министры и команды ведомств','Заочный / очный','Выдвижение, согласование и назначение пяти министров; набор сотрудников в команды ведомств.','locked'),
 (g,10,'Разработка государственных программ','Заочный / очный','Министерства разрабатывают государственные программы по своим направлениям под руководством министров.','locked'),
 (g,11,'Представление государственных программ','Очный / заочный','Представить государственные программы на заседании Правительства и принять решения по ним.','locked'),
 (g,12,'Разработка законопроектов','Заочный / очный','Моделирование законодательного процесса: инициатива, законопроект, обсуждение, голосование и оформление решений.','locked'),
 (g,13,'Бюджетное правило и федеральный бюджет','Заочный / очный','Банк России и Правительство моделируют бюджетное правило, макропрогноз, доходы, расходы, дефицит и проект федерального бюджета.','locked'),
 (g,14,'Местное самоуправление','Заочный / очный','Работа муниципальных органов Барнаула: глава города, районные администрации, исследование территории и проектные решения.','locked'),
 (g,15,'Кризис / конфликт в государственном управлении','Заочный','Преподаватель в любой момент разыгрывает кризисное, конфликтное или чрезвычайное событие и оценивает реакцию должностных лиц.','locked'),
 (g,16,'Обсуждение деловой игры','Очный','Итоговая рефлексия: анализ решений, эффективности, логики действий и предложения по улучшению игры.','locked');

 insert into public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
 values(g,(select auth.uid()),'game_created','game',g,jsonb_build_object('title',trim(p_title)));

 return g;
end
$function$;

-- Keep nomination IDs, ballot references, decisions and document bodies.
update public.government_nominations set stage_no=9
where office_kind in ('deputy_pm','duma_minister','security_minister') and stage_no<>9;
update public.game_votes v set stage_no=9
where v.stage_no<>9 and exists(select 1 from public.government_nominations n where n.stage_no=9 and n.vote_id=v.id);
update public.formal_documents d set stage_no=9,metadata=coalesce(d.metadata,'{}'::jsonb)||jsonb_build_object('stage_no',9)
where exists(select 1 from public.government_nominations n where n.stage_no=9 and (n.formal_document_id=d.id or n.appointment_document_id=d.id))
 and (d.stage_no<>9 or d.metadata->>'stage_no' is distinct from '9');
update public.game_stages set title='Председатель Правительства и структура',
 summary='Назначение Председателя Правительства и Председателя Банка России; утверждение структуры из пяти министерств.' where stage_no=8;
update public.game_stages set title='Министры и команды ведомств',
 summary='Выдвижение, согласование и назначение пяти министров; набор сотрудников в команды ведомств.' where stage_no=9;
