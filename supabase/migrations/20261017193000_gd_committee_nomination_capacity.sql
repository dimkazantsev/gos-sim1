-- Committee nominees must use the SAME verified 450-seat capacity as GD
-- registration and voting. No candidate, ballot, result or RLS data changed.
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

 if not private.is_game_teacher(e.game_id) then perform private.require_game_meeting_registration(e.game_id,v_uid,e.stage_no,'gd');end if;
 v_party:=private.party_led_by(e.game_id,v_uid);
 if v_party is null and not private.is_game_teacher(e.game_id) then raise exception 'Faction leader access required'; end if;
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
