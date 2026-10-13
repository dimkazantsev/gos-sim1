create or replace function public.teacher_manage_participant(
 p_game_id uuid,p_user_id uuid,p_action text,p_confirm_name text)
returns text language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_member public.game_members%rowtype; v_owner uuid;
begin
 if v_actor is null or not private.is_game_teacher(p_game_id) then raise exception 'Teacher required'; end if;
 if p_action is null or p_action not in ('exclude','erase_profile') then raise exception 'Invalid action'; end if;
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