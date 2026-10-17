-- Regional agreement writes are stage 3 KSRF actions and need approved agenda + personal attendance.
CREATE OR REPLACE FUNCTION public.set_regional_agreement_allocation(p_rule_id uuid, p_party_id uuid, p_regions integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r public.regional_election_rules%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into r from public.regional_election_rules where id=p_rule_id for update;
 if r.id is null then raise exception 'Regional rule not found'; end if;
 if r.method<>'agreement' or r.status<>'adopted' then raise exception 'Agreement allocation is not active'; end if;
 if not private.is_game_teacher(r.game_id) and private.party_led_by(r.game_id,v_uid) is null then raise exception 'Faction leader / teacher access required'; end if;
 if not private.is_game_teacher(r.game_id) then
  perform private.require_game_meeting_registration(r.game_id,v_uid,3,'ksrf');
 end if;
 if not exists(select 1 from public.game_parties where id=p_party_id and game_id=r.game_id) then raise exception 'Party not found'; end if;
 if not private.is_game_teacher(r.game_id) and private.party_led_by(r.game_id,v_uid)<>p_party_id then raise exception 'Faction leader may edit only their own allocation proposal'; end if;
 if p_regions<0 or p_regions>89 then raise exception 'Regions must be 0-89'; end if;
 insert into public.regional_allocations(rule_id,game_id,party_id,regions,source)
 values(r.id,r.game_id,p_party_id,p_regions,'agreement')
 on conflict(rule_id,party_id) do update set regions=excluded.regions,updated_at=now();
end;$function$;
