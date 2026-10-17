
-- Stage 4 / ГОС.ID: each deputy may distribute their own mandate package among
-- several committees. Government/ministry assignments remain unchanged.
CREATE TABLE IF NOT EXISTS public.committee_mandate_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
 unit_id uuid NOT NULL REFERENCES public.institution_units(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 party_id uuid NOT NULL REFERENCES public.game_parties(id),
 mandates integer NOT NULL CHECK (mandates BETWEEN 1 AND 90),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (unit_id,user_id)
);
CREATE INDEX IF NOT EXISTS committee_mandate_allocations_game_unit_idx ON public.committee_mandate_allocations(game_id,unit_id,party_id);
CREATE INDEX IF NOT EXISTS committee_mandate_allocations_game_member_idx ON public.committee_mandate_allocations(game_id,user_id);
ALTER TABLE public.committee_mandate_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.committee_mandate_allocations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.committee_mandate_allocations TO authenticated;
DROP POLICY IF EXISTS committee_mandate_allocations_read ON public.committee_mandate_allocations;
CREATE POLICY committee_mandate_allocations_read ON public.committee_mandate_allocations
 FOR SELECT TO authenticated USING (private.is_game_member(game_id));
DO $publication$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='committee_mandate_allocations')
 THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.committee_mandate_allocations; END IF;
END $publication$;

-- Compute faction quotas from actually held deputy mandates. When individual
-- party mandates have not yet been assigned, use existing 450-seat fallback.
-- Largest remainder yields EXACTLY 90 seats per committee without rounding loss.
CREATE OR REPLACE FUNCTION private.committee_quota_matrix(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $matrix$
DECLARE v_result jsonb;
BEGIN
 WITH representation AS (
   SELECT p.id AS party_id,p.name AS party_name,p.color,
          coalesce(sum(private.gd_member_capacity(gm.game_id,gm.user_id)),0)::integer AS seats
   FROM public.game_parties p
   JOIN public.game_members gm ON gm.game_id=p.game_id AND gm.team=p.name
     AND gm.kind='student' AND gm.roster_archived_at IS NULL
   WHERE p.game_id=p_game_id AND p.registration_status='registered'
   GROUP BY p.id,p.name,p.color
 ), active_parties AS (
   SELECT *,seats::numeric/nullif(sum(seats) OVER(),0) AS share FROM representation WHERE seats>0
 ), raw AS (
   SELECT u.id unit_id,u.title,p.party_id,p.party_name,p.color,p.seats,
      (coalesce(u.mandate_capacity,90)*p.share) AS raw_quota,
      floor(coalesce(u.mandate_capacity,90)*p.share)::integer AS base,
      coalesce(u.mandate_capacity,90) AS capacity
   FROM public.institution_units u CROSS JOIN active_parties p
   WHERE u.game_id=p_game_id AND u.unit_kind='committee'
 ), ranked AS (
   SELECT r.*,(r.raw_quota-r.base) AS remainder,
     r.capacity-sum(r.base) OVER (PARTITION BY r.unit_id) AS spare,
     row_number() OVER (PARTITION BY r.unit_id ORDER BY r.raw_quota-r.base DESC,r.party_id) AS rank
   FROM raw r
 ), quotas AS (
   SELECT *,base+CASE WHEN rank<=spare THEN 1 ELSE 0 END AS quota FROM ranked
 ), assigned AS (
   SELECT unit_id,party_id,sum(mandates)::integer assigned_mandates,count(*)::integer students
   FROM public.committee_mandate_allocations WHERE game_id=p_game_id
   GROUP BY unit_id,party_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'unit_id',q.unit_id,'title',q.title,'party_id',q.party_id,
   'party_name',q.party_name,'color',q.color,'quota',q.quota,
   'party_mandates',q.seats,'assigned_mandates',coalesce(a.assigned_mandates,0),
   'students',coalesce(a.students,0))
   ORDER BY q.title,q.party_name),'[]'::jsonb)
 INTO v_result
 FROM quotas q LEFT JOIN assigned a ON a.unit_id=q.unit_id AND a.party_id=q.party_id;
 RETURN v_result;
END;
$matrix$;
REVOKE ALL ON FUNCTION private.committee_quota_matrix(uuid) FROM PUBLIC,anon,authenticated;

-- User-facing matrix remains protected. Server-side stage readiness and
-- capacity checks use private.committee_quota_matrix without session identity.
CREATE OR REPLACE FUNCTION public.get_committee_matrix(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $publicmatrix$
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_member(p_game_id)
 THEN RAISE EXCEPTION 'Game access required'; END IF;
 RETURN private.committee_quota_matrix(p_game_id);
END;
$publicmatrix$;
REVOKE ALL ON FUNCTION public.get_committee_matrix(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_committee_matrix(uuid) TO authenticated;

-- Single lock per game prevents two simultaneous appointments oversubscribing
-- a member, faction or committee. Snapshot is authoritative under the lock.
CREATE OR REPLACE FUNCTION public.set_committee_mandates(
 p_unit_id uuid,p_user_id uuid,p_mandates integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $allocate$
DECLARE
 u public.institution_units%rowtype;
 v_actor uuid:=auth.uid();
 v_party uuid;
 v_actor_party uuid;
 v_capacity integer;
 v_previous integer;
 v_member_used integer;
 v_unit_used integer;
 v_faction_used integer;
 v_quota integer;
BEGIN
 SELECT * INTO u FROM public.institution_units WHERE id=p_unit_id;
 IF u.id IS NULL OR u.unit_kind<>'committee' THEN RAISE EXCEPTION 'Комитет не найден'; END IF;
 IF v_actor IS NULL OR NOT private.is_game_member(u.game_id) OR private.is_game_observer(u.game_id)
 THEN RAISE EXCEPTION 'Недостаточно прав для распределения мандатов'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.game_stages
   WHERE game_id=u.game_id AND stage_no=4 AND status='open')
 THEN RAISE EXCEPTION 'Формирование комитетов доступно только на открытом четвёртом этапе'; END IF;
 IF u.head_user_id IS NULL THEN RAISE EXCEPTION 'Сначала изберите председателя комитета'; END IF;
 IF p_mandates IS NULL OR p_mandates<0 OR p_mandates>coalesce(u.mandate_capacity,90)
 THEN RAISE EXCEPTION 'Недопустимое количество мандатов'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=u.game_id AND user_id=p_user_id
   AND kind='student' AND roster_archived_at IS NULL)
 THEN RAISE EXCEPTION 'Депутат не участвует в действующем составе игры'; END IF;
 v_party:=private.member_party_id(u.game_id,p_user_id);
 IF v_party IS NULL OR NOT EXISTS(SELECT 1 FROM public.game_parties
    WHERE id=v_party AND game_id=u.game_id AND registration_status='registered')
 THEN RAISE EXCEPTION 'Депутат должен принадлежать к зарегистрированной фракции'; END IF;
 v_actor_party:=private.member_party_id(u.game_id,v_actor);
 IF NOT private.is_game_teacher(u.game_id) AND v_actor IS DISTINCT FROM u.head_user_id
    AND NOT EXISTS(SELECT 1 FROM public.game_parties
      WHERE id=v_actor_party AND leader_user_id=v_actor AND game_id=u.game_id AND id=v_party)
 THEN RAISE EXCEPTION 'Назначение доступно председателю комитета или руководителю своей фракции'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('committee-mandates:'||u.game_id::text,0));
 SELECT * INTO u FROM public.institution_units WHERE id=p_unit_id FOR UPDATE;
 SELECT coalesce(mandates,0) INTO v_previous
 FROM public.committee_mandate_allocations WHERE unit_id=u.id AND user_id=p_user_id;
 v_previous:=coalesce(v_previous,0);
 v_capacity:=private.gd_member_capacity(u.game_id,p_user_id);
 SELECT coalesce(sum(mandates),0)::integer INTO v_member_used
 FROM public.committee_mandate_allocations WHERE game_id=u.game_id AND user_id=p_user_id;
 SELECT coalesce(sum(mandates),0)::integer INTO v_unit_used
 FROM public.committee_mandate_allocations WHERE unit_id=u.id;
 SELECT coalesce(sum(mandates),0)::integer INTO v_faction_used
 FROM public.committee_mandate_allocations WHERE unit_id=u.id AND party_id=v_party;
 SELECT (item->>'quota')::integer INTO v_quota
 FROM jsonb_array_elements(public.get_committee_matrix(u.game_id)) item
 WHERE item->>'unit_id'=u.id::text AND item->>'party_id'=v_party::text;
 IF v_capacity<=0 OR v_quota IS NULL THEN
   RAISE EXCEPTION 'У депутата отсутствуют действующие мандаты или квота фракции'; END IF;
 IF v_member_used-v_previous+p_mandates>v_capacity
 THEN RAISE EXCEPTION 'Превышен личный пакет депутатских мандатов'; END IF;
 IF v_unit_used-v_previous+p_mandates>coalesce(u.mandate_capacity,90)
 THEN RAISE EXCEPTION 'В комитете нельзя распределить более 90 мандатов'; END IF;
 IF v_faction_used-v_previous+p_mandates>v_quota
 THEN RAISE EXCEPTION 'Превышена квота фракции в данном комитете'; END IF;
 IF p_mandates=0 THEN
   DELETE FROM public.committee_mandate_allocations WHERE unit_id=u.id AND user_id=p_user_id;
 ELSE
   INSERT INTO public.committee_mandate_allocations(
      game_id,unit_id,user_id,party_id,mandates,created_by)
   VALUES(u.game_id,u.id,p_user_id,v_party,p_mandates,v_actor)
   ON CONFLICT(unit_id,user_id) DO UPDATE SET
      mandates=EXCLUDED.mandates,party_id=EXCLUDED.party_id,updated_at=now();
 END IF;
END;
$allocate$;
REVOKE ALL ON FUNCTION public.set_committee_mandates(uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_committee_mandates(uuid,uuid,integer) TO authenticated;

-- Previous committee membership RPC has no mandate-count argument; disallow
-- ambiguous writes there. Ministry RPC remains fully compatible.
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
 on conflict(game_id,user_id,unit_kind) do update
 set unit_id=excluded.unit_id,party_id=excluded.party_id,created_by=v_uid,created_at=now()
 returning id into v_id;
 return v_id;
end;$function$;

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
 if u.unit_kind='committee' then raise exception 'Для комитетов используйте распределение депутатских мандатов';end if;
 if a.unit_kind='committee' then
   v_party:=private.member_party_id(a.game_id,v_uid);
   if not private.is_game_teacher(a.game_id)
      and not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid and id=a.party_id)
   then raise exception 'Faction leader access required'; end if;
 else
   v_role:=private.game_role(a.game_id,v_uid);
   if not private.is_game_teacher(a.game_id) and v_uid is distinct from u.head_user_id and v_role not like '%председател%правительств%'
   then raise exception 'Minister / Prime Minister / teacher access required'; end if;
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
  -- Every committee has 90 actually assigned mandates; a chairman alone does
  -- not satisfy readiness. All 450 seats must be allocated exactly once.
  select coalesce(sum(a.mandates),0)::integer into c3
  from public.committee_mandate_allocations a where a.game_id=p_game;
  m:=m||jsonb_build_object('committee_mandates_allocated',c3,'committee_mandates_required',450);
  if c3<>450 then b:=b||jsonb_build_array('Не распределены все 450 депутатских мандатов между комитетами');end if;
  if exists(select 1 from public.institution_units u where u.game_id=p_game and u.unit_kind='committee'
    and coalesce((select sum(a.mandates) from public.committee_mandate_allocations a
      where a.unit_id=u.id),0)<>coalesce(u.mandate_capacity,90))
  then b:=b||jsonb_build_array('Не во всех пяти комитетах распределены ровно 90 мандатов');end if;
  -- Quotas and personal capacity may change after a deputy leaves or mandate
  -- losses are applied. Do not accept a full-looking but now invalid matrix.
  if exists(
    select 1 from public.committee_mandate_allocations a
    where a.game_id=p_game
    group by a.user_id
    having sum(a.mandates)>private.gd_member_capacity(p_game,a.user_id))
  then b:=b||jsonb_build_array('Распределение превышает действующие личные мандаты депутатов');end if;
  if exists(select 1 from jsonb_array_elements(private.committee_quota_matrix(p_game)) row
      where (row->>'assigned_mandates')::integer>(row->>'quota')::integer)
  then b:=b||jsonb_build_array('Превышены действующие квоты фракций в комитетах');end if;
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

-- Exact deputy capacities for the authenticated game dashboard; do not infer
-- them from missing base_mandates rows on the client.
CREATE OR REPLACE FUNCTION public.get_committee_deputy_capacity(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $capacity$
DECLARE v_out jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_member(p_game_id)
 THEN RAISE EXCEPTION 'Game access required'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'user_id',gm.user_id,'mandates',private.gd_member_capacity(gm.game_id,gm.user_id))
   ORDER BY gm.joined_at,gm.user_id),'[]'::jsonb) INTO v_out
 FROM public.game_members gm
 WHERE gm.game_id=p_game_id AND gm.kind='student' AND gm.roster_archived_at IS NULL;
 RETURN v_out;
END;
$capacity$;
REVOKE ALL ON FUNCTION public.get_committee_deputy_capacity(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_committee_deputy_capacity(uuid) TO authenticated;
