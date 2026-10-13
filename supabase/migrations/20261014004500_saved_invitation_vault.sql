-- New invitation secrets use Supabase Vault, never plaintext in public schema.
create table if not exists private.game_invitation_secrets(
 game_id uuid not null,
 invite_id uuid primary key references public.invite_codes(id) on delete cascade,
 vault_secret_id uuid not null unique references vault.secrets(id),
 created_at timestamptz not null default now()
);
alter table private.game_invitation_secrets enable row level security;
revoke all on private.game_invitation_secrets from public,anon,authenticated;

create or replace function public.teacher_create_saved_invitation(
 p_game_id uuid,p_code text,p_scope text,p_group_name text default null
) returns uuid language plpgsql security definer set search_path to '' as $$
declare v_id uuid;v_secret text:=btrim(coalesce(p_code,''));v_vault_id uuid;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required'; end if;
 if p_scope in ('participant','group') then
  v_id:=public.teacher_create_access_code(p_game_id,v_secret,p_scope,p_group_name);
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
end $$;

create or replace function public.teacher_saved_invitation_list(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_result jsonb;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,
  'scope',case when i.kind='teacher' then 'teacher'
               when i.kind='observer' then 'guest'
               when gm.invite_id is not null then 'group' else 'participant' end,
  'group_name',gm.group_name,'active',i.active,'created_at',i.created_at,
  'code',s.decrypted_secret
 ) order by i.created_at desc),'[]'::jsonb) into v_result
 from public.invite_codes i
 left join private.game_group_access_codes gm on gm.invite_id=i.id and gm.game_id=i.game_id
 left join private.game_invitation_secrets m on m.invite_id=i.id and m.game_id=i.game_id
 left join vault.decrypted_secrets s on s.id=m.vault_secret_id
 where i.game_id=p_game_id and i.kind in ('teacher','student','observer');
 return v_result;
end $$;
revoke all on function public.teacher_create_saved_invitation(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.teacher_saved_invitation_list(uuid) from public,anon,authenticated;
grant execute on function public.teacher_create_saved_invitation(uuid,text,text,text) to authenticated;
grant execute on function public.teacher_saved_invitation_list(uuid) to authenticated;
