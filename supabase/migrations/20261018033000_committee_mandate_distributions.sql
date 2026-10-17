-- Stage 4: one deputy can assign distinct mandate amounts across several committees.
-- Existing elections, head roles, assignments, ministries and voting mandate sources preserved.
ALTER TABLE public.institution_assignments ADD COLUMN IF NOT EXISTS mandates_allocated integer NOT NULL DEFAULT 0;
ALTER TABLE public.institution_assignments DROP CONSTRAINT IF EXISTS institution_assignments_game_id_user_id_unit_kind_key;
CREATE UNIQUE INDEX IF NOT EXISTS institution_assignments_single_ministry_per_student
ON public.institution_assignments(game_id,user_id) WHERE unit_kind='ministry';
ALTER TABLE public.institution_assignments DROP CONSTRAINT IF EXISTS committee_allocations_range;
ALTER TABLE public.institution_assignments ADD CONSTRAINT committee_allocations_range
CHECK (mandates_allocated>=0 AND (unit_kind<>'committee' OR mandates_allocated<=90));


CREATE OR REPLACE FUNCTION public.get_committee_matrix(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $matrix$
declare v_uid uuid:=auth.uid();v_result jsonb;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then
   raise exception 'Необходим доступ участника игры';end if;
 with parties as (
  select gp.id,gp.name,gp.color,
    coalesce(sum(private.gd_member_capacity(gm.game_id,gm.user_id)),0)::numeric seats
  from public.game_parties gp
  left join public.game_members gm ON gm.game_id=gp.game_id and gm.team=gp.name
     and gm.kind='student' and gm.roster_archived_at is null
  where gp.game_id=p_game_id
  group by gp.id,gp.name,gp.color
 ), active_parties as (
  select id,name,color,seats,seats/nullif(sum(seats) over(),0) as share
  from parties where seats>0
 ), raw as (
  select u.id unit_id,u.title,p.id party_id,p.name party_name,p.color,
     coalesce(u.mandate_capacity,90)::integer capacity,
     floor(p.share*coalesce(u.mandate_capacity,90))::integer base,
     (p.share*coalesce(u.mandate_capacity,90))
       -floor(p.share*coalesce(u.mandate_capacity,90)) remainder
  from public.institution_units u cross join active_parties p
  where u.game_id=p_game_id and u.unit_kind='committee'
 ), ranked as (
  select r.*,
   r.capacity-sum(r.base) over(partition by r.unit_id) extra,
   row_number() over(partition by r.unit_id order by r.remainder desc,r.party_id) rn
  from raw r
 ), assigned as (
  select a.unit_id,a.party_id,
   count(*) filter (where a.mandates_allocated>0)::integer students,
   coalesce(sum(a.mandates_allocated),0)::integer assigned_mandates
  from public.institution_assignments a
  where a.game_id=p_game_id and a.unit_kind='committee'
  group by a.unit_id,a.party_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
    'unit_id',q.unit_id,'title',q.title,
    'party_id',q.party_id,'party_name',q.party_name,'color',q.color,
    'quota',q.base+case when q.rn<=q.extra then 1 else 0 end,
    'students',coalesce(a.students,0),'assigned_mandates',coalesce(a.assigned_mandates,0)
 ) order by q.title,q.party_name),'[]'::jsonb)
 into v_result from ranked q left join assigned a
 on a.unit_id=q.unit_id and a.party_id=q.party_id;
 return v_result;
end;
$matrix$;

CREATE OR REPLACE FUNCTION public.get_committee_member_capacities(p_game_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $capacity$
 select case when auth.uid() is null or not private.is_game_member(p_game_id)
 then '[]'::jsonb else (
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,
    'capacity',private.gd_member_capacity(m.game_id,m.user_id))
    order by m.joined_at,m.user_id),'[]'::jsonb)
  from public.game_members m
  where m.game_id=p_game_id and m.kind='student' and m.roster_archived_at is null
 ) end;
$capacity$;
REVOKE ALL ON FUNCTION public.get_committee_member_capacities(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_committee_member_capacities(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.allocate_committee_mandates(p_unit_id uuid,p_user_id uuid,p_mandates integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $allocation$
declare
 u public.institution_units%rowtype;
 uid uuid:=auth.uid();v_party uuid;v_actor_party uuid;
 v_capacity integer;v_person_total integer;v_unit_total integer;
 v_party_total integer;v_quota integer;v_id uuid;
begin
 if uid is null then raise exception 'Необходим вход в игру';end if;
 select * into u from public.institution_units where id=p_unit_id;
 if u.id is null or u.unit_kind<>'committee' then raise exception 'Комитет не найден';end if;
 if not private.is_game_member(u.game_id) or private.is_game_observer(u.game_id)
 then raise exception 'Недостаточно прав для формирования комитета';end if;
 -- Serializes all committee allocations within the game, including 40 simultaneous deputies.
 perform pg_advisory_xact_lock(hashtextextended('committee-mandates:'||u.game_id::text,0));
 select * into u from public.institution_units where id=p_unit_id for update;
 if u.head_user_id is null then raise exception 'Сначала изберите председателя комитета';end if;
 if p_mandates is null or p_mandates<0 or p_mandates>coalesce(u.mandate_capacity,90)
 then raise exception 'Некорректное количество мандатов';end if;
 if not exists(select 1 from public.game_members m where m.game_id=u.game_id
   and m.user_id=p_user_id and m.kind='student' and m.roster_archived_at is null)
 then raise exception 'Депутат не найден среди действующих участников';end if;
 v_party:=private.member_party_id(u.game_id,p_user_id);
 if v_party is null then raise exception 'Депутат должен состоять во фракции';end if;
 if not private.is_game_teacher(u.game_id) and uid is distinct from u.head_user_id then
   v_actor_party:=private.member_party_id(u.game_id,uid);
   if v_actor_party is distinct from v_party OR not exists(
      select 1 from public.game_parties gp where gp.id=v_party and gp.game_id=u.game_id
      and gp.leader_user_id=uid)
   then raise exception 'Назначать депутатов своей фракции может её председатель';end if;
 end if;
 v_capacity:=private.gd_member_capacity(u.game_id,p_user_id);
 if v_capacity<=0 then raise exception 'У депутата нет действующих мандатов';end if;
 if p_mandates=0 and not exists(
   select 1 from public.institution_assignments a where a.unit_id=p_unit_id
     and a.user_id=p_user_id and a.assignment_role='head')
 then raise exception 'Для участия необходимо выделить хотя бы один мандат';end if;
 select coalesce(sum(a.mandates_allocated),0)::integer into v_person_total
 from public.institution_assignments a
 where a.game_id=u.game_id and a.unit_kind='committee' and a.user_id=p_user_id
 and a.unit_id<>p_unit_id;
 if v_person_total+p_mandates>v_capacity then
  raise exception 'Превышено количество мандатов депутата: доступно %',greatest(0,v_capacity-v_person_total);
 end if;
 select coalesce(sum(a.mandates_allocated),0)::integer into v_unit_total
 from public.institution_assignments a where a.unit_id=p_unit_id
 and a.user_id<>p_user_id;
 if v_unit_total+p_mandates>coalesce(u.mandate_capacity,90) then
  raise exception 'Комитет не может иметь более 90 мандатов';end if;
 select coalesce(sum(a.mandates_allocated),0)::integer into v_party_total
 from public.institution_assignments a where a.unit_id=p_unit_id
 and a.party_id=v_party and a.user_id<>p_user_id;
 select (j->>'quota')::integer into v_quota
 from jsonb_array_elements(public.get_committee_matrix(u.game_id)) j
 where j->>'unit_id'=u.id::text and j->>'party_id'=v_party::text;
 if v_quota is null then raise exception 'Фракционная квота не определена';end if;
 if v_party_total+p_mandates>v_quota then
  raise exception 'Превышена квота фракции в комитете: %',v_quota;end if;
 insert into public.institution_assignments(
  game_id,unit_id,unit_kind,user_id,party_id,mandates_allocated,created_by)
 values(u.game_id,u.id,'committee',p_user_id,v_party,p_mandates,uid)
 on conflict(unit_id,user_id) do update set
  mandates_allocated=excluded.mandates_allocated,
  party_id=excluded.party_id,created_by=excluded.created_by,
  created_at=now()
 returning id into v_id;
 return v_id;
end;
$allocation$;
REVOKE ALL ON FUNCTION public.allocate_committee_mandates(uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.allocate_committee_mandates(uuid,uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_institution_member(p_unit_id uuid,p_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $legacy$
declare u public.institution_units%rowtype;uid uuid:=auth.uid();v_role text;v_id uuid;
begin
 select * into u from public.institution_units where id=p_unit_id;
 if u.id is null then raise exception 'Подразделение не найдено';end if;
 if u.unit_kind='committee' then
   if uid is null or not private.is_game_member(u.game_id) or private.is_game_observer(u.game_id)
   then raise exception 'Необходим доступ участника игры';end if;
   select id into v_id from public.institution_assignments where unit_id=p_unit_id and user_id=p_user_id;
   if v_id is not null then return v_id;end if;
   return public.allocate_committee_mandates(p_unit_id,p_user_id,1);
 end if;
 if uid is null or not private.is_game_member(u.game_id) or private.is_game_observer(u.game_id)
 then raise exception 'Необходим доступ участника игры';end if;
 if not exists(select 1 from public.game_members where game_id=u.game_id
   and user_id=p_user_id and kind='student' and roster_archived_at is null)
 then raise exception 'Участник не найден';end if;
 v_role:=private.game_role(u.game_id,uid);
 if not private.is_game_teacher(u.game_id) and uid is distinct from u.head_user_id
    and v_role not like '%председател%правительств%'
 then raise exception 'Недостаточно прав для назначения в министерство';end if;
 insert into public.institution_assignments(
  game_id,unit_id,unit_kind,user_id,party_id,created_by)
 values(u.game_id,u.id,'ministry',p_user_id,null,uid)
 on conflict(game_id,user_id) where unit_kind='ministry' do update
 set unit_id=excluded.unit_id,party_id=null,created_by=uid,created_at=now()
 returning id into v_id;
 return v_id;
end;
$legacy$;

CREATE OR REPLACE FUNCTION public.remove_institution_member(p_assignment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare a public.institution_assignments%rowtype;u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_role text;
begin
 select * into a from public.institution_assignments where id=p_assignment_id;
 if a.id is null then return; end if;
 if v_uid is null or not private.is_game_member(a.game_id) or private.is_game_observer(a.game_id) then raise exception 'Game participant access required';end if;
 select * into u from public.institution_units where id=a.unit_id;
 if a.unit_kind='committee' then
   v_party:=private.member_party_id(a.game_id,v_uid);
   if a.assignment_role='head' then
    raise exception 'Избранный председатель не может быть исключён из своего комитета';end if;
   if not private.is_game_teacher(a.game_id) and v_uid is distinct from u.head_user_id
      and not exists(select 1 from public.game_parties
         where id=v_party and leader_user_id=v_uid and id=a.party_id)
   then raise exception 'Исключение доступно председателю комитета или руководителю фракции'; end if;
 else
   v_role:=private.game_role(a.game_id,v_uid);
   if not private.is_game_teacher(a.game_id) and v_uid is distinct from u.head_user_id and v_role not like '%председател%правительств%'
   then raise exception 'Minister / Prime Minister / teacher access required'; end if;
 end if;
 if a.unit_kind='committee' then
   perform pg_advisory_xact_lock(hashtextextended('committee-mandates:'||a.game_id::text,0));
 end if;
 delete from public.institution_assignments where id=a.id;
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
  -- Stored base mandates take precedence. Until assigned, use the verified
  -- equal-seat GD capacity (450 seats across active participants).
  select case when (select coalesce(sum(pm.base_mandates),0) from public.party_member_mandates pm where pm.game_id=p_game)>0
   then (select coalesce(sum(pm.base_mandates),0) from public.party_member_mandates pm where pm.game_id=p_game)
   else (select coalesce(sum(private.gd_member_capacity(gm.game_id,gm.user_id)),0)
     from public.game_members gm where gm.game_id=p_game and gm.kind='student' and gm.roster_archived_at is null)
   end into n;
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
    and (select coalesce(sum(a.mandates_allocated),0) from public.institution_assignments a
         where a.unit_id=u.id)<>coalesce(u.mandate_capacity,90))
  then b:=b||jsonb_build_array('Не в каждом комитете распределено ровно 90 мандатов');end if;
  if (select coalesce(sum(a.mandates_allocated),0)
      from public.institution_assignments a where a.game_id=p_game and a.unit_kind='committee')<>450
  then b:=b||jsonb_build_array('По пяти комитетам распределено не 450 мандатов');end if;
  if exists(select 1 from public.game_members gm
    where gm.game_id=p_game and gm.kind='student' and gm.roster_archived_at is null
      and (select coalesce(sum(a.mandates_allocated),0) from public.institution_assignments a
        where a.game_id=p_game and a.unit_kind='committee' and a.user_id=gm.user_id)
        <>private.gd_member_capacity(gm.game_id,gm.user_id))
  then b:=b||jsonb_build_array('Не все мандаты действующих депутатов распределены по комитетам');end if;
 elsif p_stage=5 then
  select count(*) into c from public.ghost_voting_policies where game_id=p_game and status='adopted';
  m:=jsonb_build_object('policy_adopted',c);
  if c=0 then b:=b||jsonb_build_array('ГД не приняла постановление о режиме Goust Voting'); end if;
  if exists(select 1 from public.game_parties where game_id=p_game and ghost_active) then w:=w||jsonb_build_array('Сейчас действует временная потеря мандатов Goust Voting; снимите её после завершения соответствующего заседания'); end if;
 elsif p_stage=6 then
  select count(*) into c from public.presidential_candidates where game_id=p_game and archived_at is null and registration_status='registered';
  select count(*) into c2 from public.presidential_candidates where game_id=p_game and archived_at is null and registration_status in ('submitted','revision');
  select count(*) into c3 from public.presidential_system_proposals where game_id=p_game and status='adopted';
  m:=jsonb_build_object('registered_candidates',c,'pending_candidates',c2,'duma_system_decision',c3);
  if c3=0 then b:=b||jsonb_build_array('Государственная Дума ещё не утвердила тип избирательной системы выборов Президента');end if;
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
  select count(*) into c3 from public.game_members gm where gm.game_id=p_game and gm.kind='student' and gm.roster_archived_at is null
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
   where gm.game_id=p_game and gm.kind='student' and gm.roster_archived_at is null
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
  select count(*) into c from public.game_members where game_id=p_game and kind='student' and roster_archived_at is null;
  select count(*) into c3 from (select r.user_id from public.game_reflections r join public.game_members gm on gm.game_id=r.game_id and gm.user_id=r.user_id and gm.kind='student' and gm.roster_archived_at is null where r.game_id=p_game and r.status in ('submitted','reviewed') group by r.user_id having count(distinct r.phase_key)>=6) q;
  m:=jsonb_build_object('students',c,'students_completed_reflection',c3);
  if c=0 then b:=b||jsonb_build_array('В игре нет студентов, для которых можно провести итоговую рефлексию');
  elsif c3<c then b:=b||jsonb_build_array('Не все студенты сдали рефлексию по шести фазам игры'); end if;
  if exists(select 1 from public.game_reflections where game_id=p_game and status='submitted') then w:=w||jsonb_build_array('Есть сданные рефлексии, которые преподаватель ещё не разобрал'); end if;
 end if;
 return jsonb_build_object('stage_no',p_stage,'ready',jsonb_array_length(b)=0,'blockers',b,'warnings',w,'metrics',m);
end;
$function$;

-- Connected head and ministry paths must use the new unique indexes.
CREATE OR REPLACE FUNCTION private.committee_chair_election_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_unit uuid;v_user uuid;
begin
 if new.status='finished'
    and new.winner_candidate_id is not null
    and new.office_key like 'committee:%'
    and (old.status is distinct from new.status or old.winner_candidate_id is distinct from new.winner_candidate_id)
 then
   v_unit:=substring(new.office_key from 11)::uuid;
   select user_id into v_user from public.office_candidates where id=new.winner_candidate_id;
   update public.institution_units set head_user_id=v_user where id=v_unit and game_id=new.game_id and unit_kind='committee';
   if v_user is not null then
     insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
     values(new.game_id,v_unit,'committee',v_user,private.member_party_id(new.game_id,v_user),'head',new.created_by)
     on conflict(unit_id,user_id) do update
     set unit_id=excluded.unit_id,party_id=excluded.party_id,assignment_role='head',created_by=excluded.created_by,created_at=now();
   end if;
 end if;
 return new;
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
 on conflict(game_id,user_id) where unit_kind='ministry' do update
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
   on conflict(game_id,user_id) where unit_kind='ministry' do update set unit_id=excluded.unit_id,assignment_role='head',created_by=v_uid,created_at=now();
 else
   insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
   values(u.game_id,u.id,'committee',p_user_id,private.member_party_id(u.game_id,p_user_id),'head',v_uid)
   on conflict(unit_id,user_id) do update set unit_id=excluded.unit_id,party_id=excluded.party_id,assignment_role='head',created_by=v_uid,created_at=now();
 end if;
end;$function$;