-- Stage 9: allow one registered student to head several ministries.
-- Existing appointments, votes and decrees are left untouched.
-- Isolation: each ministry has its own (unit_id,user_id) assignment record.
-- Avoid additional queries/subscriptions or unsafe role privilege broadening.
DROP INDEX IF EXISTS public.government_nominations_one_ministry_candidate_idx;
DROP INDEX IF EXISTS public.institution_assignments_single_ministry_per_student;

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
  ) then 'Президент Российской Федерации' else n.office_title end
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
  ) then 'Президент Российской Федерации' else n.office_title end
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
$function$;

CREATE OR REPLACE FUNCTION public.assign_institution_member(p_unit_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_target_party uuid;v_role text;v_id uuid;
begin
 select * into u from public.institution_units where id=p_unit_id for update;
 if u.id is null then raise exception 'Institution unit not found'; end if;
 if u.unit_kind='committee' then raise exception 'Для комитетов используйте распределение депутатских мандатов';end if;
 if v_uid is null or not private.is_game_member(u.game_id) or private.is_game_observer(u.game_id) then raise exception 'Game participant access required';end if;
 if not exists(select 1 from public.game_members where game_id=u.game_id and user_id=p_user_id and kind='student' and roster_archived_at is null) then raise exception 'Student not found in this game'; end if;

 if u.unit_kind='committee' then
   if u.head_user_id is null then raise exception 'Сначала изберите председателя комитета';end if;
   if not exists(select 1 from public.party_member_mandates where game_id=u.game_id and user_id=p_user_id and base_mandates>0) then raise exception 'Участник не получил депутатских мандатов';end if;
   v_party:=private.member_party_id(u.game_id,v_uid);
   v_target_party:=private.member_party_id(u.game_id,p_user_id);
   if not private.is_game_teacher(u.game_id) then
     if v_uid is distinct from u.head_user_id and (v_party is null or not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid)) then raise exception 'Полномочия председателя комитета или руководителя фракции отсутствуют';end if;
     if v_uid is distinct from u.head_user_id and v_target_party is distinct from v_party then raise exception 'Руководитель фракции назначает только участников своей фракции';end if;
   end if;
   if v_target_party is null then raise exception 'Committee member must belong to a parliamentary faction'; end if;
 else
   v_role:=private.game_role(u.game_id,v_uid);
   if not private.is_game_teacher(u.game_id)
      and v_uid is distinct from u.head_user_id
      and v_role not like '%председател%правительств%'
   then raise exception 'Minister / Prime Minister / teacher access required'; end if;
   v_target_party:=null;
 end if;

 insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,created_by)
 values(u.game_id,u.id,u.unit_kind,p_user_id,v_target_party,v_uid)
 on conflict(unit_id,user_id) do update
 set unit_id=excluded.unit_id,party_id=excluded.party_id,created_by=v_uid,created_at=now()
 returning id into v_id;
 return v_id;
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
   on conflict(unit_id,user_id) do update set unit_id=excluded.unit_id,assignment_role='head',created_by=v_uid,created_at=now();
 else
   insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
   values(u.game_id,u.id,'committee',p_user_id,private.member_party_id(u.game_id,p_user_id),'head',v_uid)
   on conflict(unit_id,user_id) do update set unit_id=excluded.unit_id,party_id=excluded.party_id,assignment_role='head',created_by=v_uid,created_at=now();
 end if;
end;$function$;

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
 on conflict(unit_id,user_id) do update
 set unit_id=excluded.unit_id,assignment_role='head',party_id=null
 where public.institution_assignments.unit_id is distinct from excluded.unit_id
    or public.institution_assignments.assignment_role is distinct from 'head'
    or public.institution_assignments.party_id is not null;
end;$function$;

-- Legacy nominations with no user_id are intentionally not reassigned:
-- determining their identity requires an explicit President/teacher decision.
