-- Stage 4: registered party chairs nominate their own deputies for committee chair elections.
-- No attendance vote privilege, agenda privilege or election-management privilege is granted.
-- Preserves existing security-definer context, game scoping, stage gate and candidate checks.
CREATE OR REPLACE FUNCTION public.nominate_office_candidate(p_election_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare e public.office_elections%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_id uuid;v_unit uuid;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if e.status<>'nomination' then raise exception 'Nomination is closed'; end if;
 if e.stage_no=4 AND NOT private.gd_stage4_meeting_active(e.game_id) then
  raise exception 'Этап Государственной Думы закрыт или повестка не утверждена';end if;

 -- Nomination of a committee chair belongs to the chair of a registered party,
 -- not necessarily a personally registered deputy. Deputies still elect the chair.
 if e.stage_no=4 and e.office_key like 'committee:%' then
  select p.id into v_party from public.game_parties p
  join public.game_members gm on gm.game_id=p.game_id and gm.user_id=v_uid
  where p.game_id=e.game_id and p.leader_user_id=v_uid
    and p.registration_status='registered'
    and gm.kind='student' and gm.roster_archived_at is null
  limit 1;
  if v_party is null and not private.is_game_teacher(e.game_id) then
   raise exception 'Кандидатуру председателя комитета может выдвинуть председатель зарегистрированной партии';
  end if;
 else
  if not private.is_game_teacher(e.game_id) then
   perform private.require_game_meeting_registration(e.game_id,v_uid,e.stage_no,'gd');
  end if;
  v_party:=private.party_led_by(e.game_id,v_uid);
 end if;
 -- A registered GD deputy may propose a candidate from their own
 -- registered faction. The chair retains management of the election.
 if v_party IS NULL AND e.stage_no=4
   AND e.office_key IN ('gd_chair','gd_deputy_1','gd_deputy_2')
   AND private.gd_stage4_deputy_can_propose(e.game_id,v_uid) THEN
  SELECT p.id INTO v_party FROM public.game_members gm
   JOIN public.game_parties p ON p.game_id=gm.game_id AND p.name=gm.team
  WHERE gm.game_id=e.game_id AND gm.user_id=v_uid
    AND gm.kind='student' AND gm.roster_archived_at IS NULL
    AND p.registration_status='registered' LIMIT 1;
 END IF;
 if v_party is null and not private.is_game_teacher(e.game_id)
 then raise exception 'Кандидатуру может предложить зарегистрированный депутат своей фракции'; end if;
 if private.is_game_teacher(e.game_id) then
   select p.id into v_party
   from public.game_members m join public.game_parties p on p.game_id=m.game_id and p.name=m.team
   where m.game_id=e.game_id and m.user_id=p_user_id limit 1;
 end if;
 if v_party is null then raise exception 'Candidate must belong to a faction'; end if;
 if not exists(
   select 1 from public.game_members m join public.game_parties p on p.game_id=m.game_id and p.name=m.team
   where m.game_id=e.game_id and m.user_id=p_user_id and p.id=v_party and m.kind='student'
 ) then raise exception 'Faction can nominate only its own member'; end if;

 if e.office_key like 'committee:%' then
   v_unit:=substring(e.office_key from 11)::uuid;
   if private.gd_member_capacity(e.game_id,p_user_id)<=0
   then raise exception 'Кандидат должен представлять действующие депутатские мандаты Государственной Думы'; end if;
 end if;

 insert into public.office_candidates(election_id,game_id,user_id,party_id,nominated_by)
 values(e.id,e.game_id,p_user_id,v_party,v_uid)
 on conflict(election_id,user_id) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.office_candidates where election_id=e.id and user_id=p_user_id; end if;
 return v_id;
end;$function$;
