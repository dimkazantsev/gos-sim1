-- Code management is OWNER-ONLY, including legacy endpoints previously
-- accessible to any co-teacher. A co-teacher never sees the owner's secrets.
CREATE OR REPLACE FUNCTION public.teacher_create_access_code(p_game_id uuid, p_code text, p_scope text, p_group_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_secret text:=btrim(coalesce(p_code,''));v_group text:=btrim(coalesce(p_group_name,''));
begin
 if not private.is_game_code_owner(p_game_id) then raise exception 'Только владелец игры вправе управлять кодами';end if;
 if p_scope not in ('participant','group') then raise exception 'Invalid code scope';end if;
 if char_length(v_secret) not between 8 and 80 then raise exception 'Access code must contain 8 to 80 characters';end if;
 if p_scope='group' and char_length(v_group) not between 1 and 80 then raise exception 'Group name required';end if;
 if p_scope='participant' and v_group<>'' then raise exception 'Common code cannot be bound to a group';end if;
 if exists(select 1 from public.invite_codes i where i.game_id=p_game_id and i.active
   and i.code_hash=extensions.crypt(v_secret,i.code_hash))
 then raise exception 'Access code already exists in this game';end if;
 insert into public.invite_codes(game_id,kind,code_hash,active)
 values(p_game_id,'student',extensions.crypt(v_secret,extensions.gen_salt('bf')),true)
 returning id into v_id;
 if p_scope='group' then
  insert into private.game_group_access_codes(invite_id,game_id,group_name)
  values(v_id,p_game_id,v_group);
 end if;
 return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.teacher_create_saved_invitation(p_game_id uuid, p_code text, p_scope text, p_group_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;v_secret text:=btrim(coalesce(p_code,''));v_vault_id uuid;
begin
 if not private.is_game_code_owner(p_game_id) then raise exception 'Только владелец игры вправе управлять кодами'; end if;
 if p_scope in ('participant','group') then
  v_id:=public.teacher_create_access_code(p_game_id,v_secret,p_scope,p_group_name);
 elsif p_scope='teacher' then
  if char_length(v_secret) not between 8 and 80 then raise exception 'Код преподавателя должен содержать 8–80 символов';end if;
  if exists(select 1 from public.invite_codes i where i.game_id=p_game_id and i.active
   and i.code_hash=extensions.crypt(v_secret,i.code_hash)) then raise exception 'Этот код уже действует';end if;
  insert into public.invite_codes(game_id,kind,code_hash,active)
   values(p_game_id,'teacher',extensions.crypt(v_secret,extensions.gen_salt('bf')),true)
   returning id into v_id;
 elsif p_scope='guest' then
  if char_length(v_secret) not between 6 and 80 then raise exception 'Guest invitation must contain 6-80 characters';end if;
  if exists(select 1 from public.invite_codes i where i.game_id=p_game_id and i.active
    and i.code_hash=extensions.crypt(v_secret,i.code_hash)) then
   raise exception 'Code already exists';end if;
  insert into public.invite_codes(game_id,kind,code_hash,active)
   values(p_game_id,'observer',extensions.crypt(v_secret,extensions.gen_salt('bf')),true)
   returning id into v_id;
 else raise exception 'Invalid invitation type';end if;
 select vault.create_secret(v_secret,null,'Invitation code stored for teacher access',null) into v_vault_id;
 insert into private.game_invitation_secrets(game_id,invite_id,vault_secret_id)
 values(p_game_id,v_id,v_vault_id);
 return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.teacher_delete_access_code(p_game_id uuid, p_invite_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not private.is_game_code_owner(p_game_id) then raise exception 'Только владелец игры вправе управлять кодами'; end if;
 -- Only already revoked codes can be purged. Never delete game_members or login credentials.
 delete from public.invite_codes
 where id=p_invite_id and game_id=p_game_id
  and kind in ('student','observer','teacher') and active=false;
 return found;
end $function$
;

CREATE OR REPLACE FUNCTION public.teacher_revoke_access_code(p_game_id uuid, p_invite_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not private.is_game_code_owner(p_game_id) then raise exception 'Только владелец игры вправе управлять кодами'; end if;
 update public.invite_codes set active=false
 where id=p_invite_id and game_id=p_game_id and kind in ('student','observer','teacher') and active;
 return found;
end $function$
;

CREATE OR REPLACE FUNCTION public.teacher_update_game_code(p_game_id uuid, p_new_code text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text:=upper(btrim(coalesce(p_new_code,'')));
begin
 if not private.is_game_code_owner(p_game_id) then raise exception 'Только владелец игры вправе управлять кодами';end if;
 if v_code !~ '^[A-Z0-9-]{4,32}$' then raise exception 'Game code must be 4-32 Latin letters, digits or hyphens';end if;
 update public.games set game_code=v_code where id=p_game_id;
 if not found then raise exception 'Game not found';end if;
 return v_code;
end $function$
;

-- Bypass routes for older clients must not create games or elevate roles.
REVOKE ALL ON FUNCTION public.create_game_session(text,text,text,text,text) FROM PUBLIC,authenticated,anon;
REVOKE ALL ON FUNCTION public.resume_member_game(text) FROM PUBLIC,authenticated,anon;
