-- Safe per-game exclusion and erasure of profile data; preserve historical FKs.
create table if not exists public.game_member_access_blocks(
 game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null,
 action text not null check(action in ('excluded','profile_erased')),
 blocked_at timestamptz not null default now(),
 blocked_by uuid not null,
 primary key(game_id,user_id)
);
alter table public.game_member_access_blocks enable row level security;
revoke all on public.game_member_access_blocks from public,anon,authenticated;

create or replace function private.reject_blocked_membership()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.game_member_access_blocks b
 where b.game_id=new.game_id and b.user_id=new.user_id)
 then raise exception 'Доступ к игре закрыт преподавателем'; end if;
 return new;
end $$;
drop trigger if exists reject_blocked_membership on public.game_members;
create trigger reject_blocked_membership before insert or update on public.game_members
for each row execute function private.reject_blocked_membership();

create or replace function private.is_game_member(g uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
  exists(select 1 from public.platform_admins a where a.user_id=auth.uid())
  or (
   not exists(select 1 from public.game_member_access_blocks b where b.game_id=g and b.user_id=auth.uid())
   and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid() and m.roster_archived_at is null)
  )
 );
$$;

create or replace function public.teacher_participant_roster(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Teacher required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'user_id',m.user_id,'full_name',m.full_name,'kind',m.kind,'role_title',m.role_title,
 'joined_at',m.joined_at,'roster_archived_at',m.roster_archived_at,
 'access_action',b.action,'blocked_at',b.blocked_at,
 'last_seen_at',p.last_seen_at) order by m.joined_at desc),'[]'::jsonb)
 into v_result from public.game_members m
 left join public.game_member_access_blocks b on b.game_id=m.game_id and b.user_id=m.user_id
 left join public.game_presence p on p.game_id=m.game_id and p.user_id=m.user_id
 where m.game_id=p_game_id;
 return v_result;
end $$;

create or replace function public.teacher_manage_participant(
 p_game_id uuid,p_user_id uuid,p_action text,p_confirm_name text)
returns text language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_member public.game_members%rowtype; v_owner uuid;
begin
 if v_actor is null or not private.is_game_teacher(p_game_id) then raise exception 'Teacher required'; end if;
 if p_action not in ('exclude','erase_profile') then raise exception 'Invalid action'; end if;
 select owner_id into v_owner from public.games where id=p_game_id for update;
 if v_owner is null then raise exception 'Game not found'; end if;
 if p_user_id=v_actor or p_user_id=v_owner
 or exists(select 1 from public.platform_admins where user_id=p_user_id)
 then raise exception 'Protected administrator'; end if;
 select * into v_member from public.game_members
 where game_id=p_game_id and user_id=p_user_id for update;
 if not found then raise exception 'Member not found'; end if;
 if v_member.kind='teacher' then raise exception 'Teacher accounts are protected'; end if;
 if p_confirm_name is distinct from v_member.full_name then raise exception 'Confirmation mismatch'; end if;
 -- With a row lock held, remove any previous block within this transaction to allow escalation from exclusion to profile erasure.
 -- Other transactions cannot observe the temporary removal before commit.
 delete from public.game_member_access_blocks where game_id=p_game_id and user_id=p_user_id;
 -- Change member BEFORE reinstalling block, so the blocking trigger cannot intercept this update.
 update public.game_members set
  roster_archived_at=coalesce(roster_archived_at,now()),
  full_name=case when p_action='erase_profile' then 'Удалённый участник' else full_name end,
  group_name=case when p_action='erase_profile' then null else group_name end,
  role_title=case when p_action='erase_profile' then null else role_title end,
  team=case when p_action='erase_profile' then null else team end
 where game_id=p_game_id and user_id=p_user_id;
 insert into public.game_member_access_blocks(game_id,user_id,action,blocked_by)
 values(p_game_id,p_user_id,case when p_action='exclude' then 'excluded' else 'profile_erased' end,v_actor)
 on conflict(game_id,user_id) do update
 set action=excluded.action,blocked_at=now(),blocked_by=excluded.blocked_by;
 delete from public.game_presence where game_id=p_game_id and user_id=p_user_id;
 if p_action='erase_profile' then
  delete from public.game_profiles where game_id=p_game_id and user_id=p_user_id;
  delete from public.member_login_emails where game_id=p_game_id and user_id=p_user_id;
 end if;
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p_game_id,v_actor,'teacher_participant_access','member',jsonb_build_object('target_user_id',p_user_id,'mode',p_action));
 return case when p_action='exclude' then 'excluded' else 'profile_erased' end;
end $$;
revoke all on function public.teacher_participant_roster(uuid) from public,anon,authenticated;
grant execute on function public.teacher_participant_roster(uuid) to authenticated;
revoke all on function public.teacher_manage_participant(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.teacher_manage_participant(uuid,uuid,text,text) to authenticated;

-- Own-row blitz policies alone do not check game membership; restrict those reads after exclusion.
create policy blitz_assignments_current_member on public.blitz_assignments as restrictive
 for select to authenticated using (private.is_game_member(game_id));
create policy blitz_daily_plans_current_member on public.blitz_daily_plans as restrictive
 for select to authenticated using (private.is_game_member(game_id));
