-- Keep bootstrap identity consistent with the existing membership/RLS guard.
-- No table writes, grant changes or response-shape changes.
create or replace function public.get_my_game_identity(p_game uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.game_members%rowtype;
  v_game public.games%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  if not private.is_game_member(p_game) then
    return jsonb_build_object('game', null, 'member', null);
  end if;

  select * into v_member
  from public.game_members gm
  where gm.game_id = p_game and gm.user_id = v_uid;

  if not found and not private.is_platform_admin() then
    return jsonb_build_object('game', null, 'member', null);
  end if;

  select * into v_game from public.games g where g.id = p_game;
  if v_game.id is null then
    return jsonb_build_object('game', null, 'member', null);
  end if;

  return jsonb_build_object(
    'game', to_jsonb(v_game),
    'member', case when v_member.user_id is null then null else to_jsonb(v_member) end
  );
end;
$$;
