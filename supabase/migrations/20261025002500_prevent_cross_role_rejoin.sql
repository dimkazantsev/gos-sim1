-- Prevent cross-role overwrite through an invite even with valid credentials.
CREATE OR REPLACE FUNCTION public.join_game_with_code(p_game_code text, p_invite_code text, p_full_name text, p_group_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g uuid;k public.member_kind;v_invite uuid;v_group text;v_name text:=btrim(coalesce(p_full_name,''));
begin
 if (select auth.uid()) is null then raise exception 'Authentication required';end if;
 if v_name='' then raise exception 'Full name is required';end if;
 select ga.id,ic.kind,ic.id into g,k,v_invite
 from public.games ga join public.invite_codes ic on ic.game_id=ga.id
 where ga.game_code=upper(btrim(p_game_code)) and ic.active
  and ic.code_hash=extensions.crypt(p_invite_code,ic.code_hash)
 order by case ic.kind when 'teacher' then 0 else 1 end limit 1;
 if g is null then raise exception 'Invalid game or invite code';end if;
 -- A teacher or participant account cannot be reassigned simply by
 -- entering a different invitation code; use a separate authenticated user.
 if exists(
  select 1 from public.game_members gm
  where gm.game_id=g and gm.user_id=(select auth.uid()) and gm.kind<>k
 ) then raise exception 'Для входа с другой ролью используйте отдельную учётную запись';
 end if;
 if k='student' then
  select a.group_name into v_group from private.game_group_access_codes a
   where a.game_id=g and a.invite_id=v_invite;
  v_group:=coalesce(v_group,nullif(btrim(p_group_name),''));
  if v_group is null then raise exception 'Group required';end if;
 end if;
 insert into public.game_members(game_id,user_id,full_name,group_name,kind)
 values(g,(select auth.uid()),v_name,v_group,k)
 on conflict(game_id,user_id) do update
 set full_name=excluded.full_name,group_name=excluded.group_name;
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(g,(select auth.uid()),'member_joined','member',
  jsonb_build_object('kind',k,'full_name',v_name));
 return g;
end $function$

