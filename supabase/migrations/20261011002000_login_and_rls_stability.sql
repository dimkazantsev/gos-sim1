-- Stabilize the GOS//SIMS login path for classroom bursts.
-- Keep end-user query limits strict while giving PostgREST enough time to
-- rebuild its schema cache on this large schema.

alter role authenticator set statement_timeout = '60s';
alter role authenticator set lock_timeout = '15s';

create or replace function private.is_game_member(g uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if exists (
    select 1 from public.game_members gm
    where gm.game_id = g and gm.user_id = v_uid
  ) then return true; end if;
  return exists (
    select 1 from public.platform_admins pa where pa.user_id = v_uid
  );
end;
$$;

create or replace function private.is_game_teacher(g uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if exists (
    select 1 from public.game_members gm
    where gm.game_id = g and gm.user_id = v_uid and gm.kind = 'teacher'
  ) then return true; end if;
  return exists (
    select 1 from public.platform_admins pa where pa.user_id = v_uid
  );
end;
$$;

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

revoke all on function public.get_my_game_identity(uuid) from public;
grant execute on function public.get_my_game_identity(uuid) to authenticated;

-- SELECT already uses the membership policies.  Teacher ALL policies made
-- every read evaluate an additional teacher check.  Preserve teacher write
-- access without adding that extra predicate to SELECT.

drop policy if exists metrics_teacher_all on public.state_metrics;
drop policy if exists metrics_teacher_insert on public.state_metrics;
drop policy if exists metrics_teacher_update on public.state_metrics;
drop policy if exists metrics_teacher_delete on public.state_metrics;
create policy metrics_teacher_insert on public.state_metrics for insert to authenticated
with check (private.is_game_teacher(game_id));
create policy metrics_teacher_update on public.state_metrics for update to authenticated
using (private.is_game_teacher(game_id)) with check (private.is_game_teacher(game_id));
create policy metrics_teacher_delete on public.state_metrics for delete to authenticated
using (private.is_game_teacher(game_id));

drop policy if exists game_stages_teacher on public.game_stages;
drop policy if exists game_stages_teacher_insert on public.game_stages;
drop policy if exists game_stages_teacher_update on public.game_stages;
drop policy if exists game_stages_teacher_delete on public.game_stages;
create policy game_stages_teacher_insert on public.game_stages for insert to authenticated
with check (private.is_game_teacher(game_id));
create policy game_stages_teacher_update on public.game_stages for update to authenticated
using (private.is_game_teacher(game_id)) with check (private.is_game_teacher(game_id));
create policy game_stages_teacher_delete on public.game_stages for delete to authenticated
using (private.is_game_teacher(game_id));

drop policy if exists game_parties_teacher on public.game_parties;
drop policy if exists game_parties_teacher_insert on public.game_parties;
drop policy if exists game_parties_teacher_update on public.game_parties;
drop policy if exists game_parties_teacher_delete on public.game_parties;
create policy game_parties_teacher_insert on public.game_parties for insert to authenticated
with check (private.is_game_teacher(game_id));
create policy game_parties_teacher_update on public.game_parties for update to authenticated
using (private.is_game_teacher(game_id)) with check (private.is_game_teacher(game_id));
create policy game_parties_teacher_delete on public.game_parties for delete to authenticated
using (private.is_game_teacher(game_id));

drop policy if exists game_votes_teacher on public.game_votes;
drop policy if exists game_votes_teacher_insert on public.game_votes;
drop policy if exists game_votes_teacher_update on public.game_votes;
drop policy if exists game_votes_teacher_delete on public.game_votes;
create policy game_votes_teacher_insert on public.game_votes for insert to authenticated
with check (private.is_game_teacher(game_id));
create policy game_votes_teacher_update on public.game_votes for update to authenticated
using (private.is_game_teacher(game_id)) with check (private.is_game_teacher(game_id));
create policy game_votes_teacher_delete on public.game_votes for delete to authenticated
using (private.is_game_teacher(game_id));

drop policy if exists events_teacher_all on public.game_events;
drop policy if exists events_teacher_insert on public.game_events;
drop policy if exists events_teacher_update on public.game_events;
drop policy if exists events_teacher_delete on public.game_events;
create policy events_teacher_insert on public.game_events for insert to authenticated
with check (private.is_game_teacher(game_id));
create policy events_teacher_update on public.game_events for update to authenticated
using (private.is_game_teacher(game_id)) with check (private.is_game_teacher(game_id));
create policy events_teacher_delete on public.game_events for delete to authenticated
using (private.is_game_teacher(game_id));
