-- Expose the already enforced institution-meeting permissions as a
-- read-only, game-scoped response. Never infer them from a role title in React.
-- Existing agenda/minutes RPCs remain the sole authority for writes.
create or replace function public.get_my_institution_meeting_permissions(
 p_game_id uuid,p_stage_no integer,p_institution text
) returns jsonb
language plpgsql stable security definer
set search_path to ''
as $function$
declare
 v_uid uuid := (select auth.uid());
 v_can_coordinate boolean;
 v_can_attend boolean;
 v_delegated boolean;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре';
 end if;
 if not exists(select 1 from public.game_stages
  where game_id=p_game_id and stage_no=p_stage_no) then
  raise exception 'Этап игры не найден';
 end if;
 if p_institution not in ('ksrf','gd','government','municipality','sf','committee','region',
  'cec','ks','vs','central_bank','accounts')
  and not exists(select 1 from public.institution_units
    where game_id=p_game_id and 'unit:'||id::text=p_institution) then
  raise exception 'Орган не найден';
 end if;
 v_can_coordinate:=private.can_coordinate_institution_meeting(p_game_id,p_institution,v_uid);
 v_can_attend:=private.vote_member_has_office(p_game_id,v_uid,p_institution);
 select exists(select 1 from public.institution_meeting_records r
  where r.game_id=p_game_id and r.stage_no=p_stage_no
   and r.institution_key=p_institution and r.delegate_user_id=v_uid)
 into v_delegated;
 return jsonb_build_object(
  'can_coordinate',v_can_coordinate,
  'can_prepare',v_can_coordinate or v_delegated,
  'can_attend',v_can_attend
 );
end;
$function$;
revoke all on function public.get_my_institution_meeting_permissions(uuid,integer,text) from public,anon;
grant execute on function public.get_my_institution_meeting_permissions(uuid,integer,text) to authenticated,service_role;
