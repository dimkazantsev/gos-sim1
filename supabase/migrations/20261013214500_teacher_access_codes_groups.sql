-- Access codes for existing games, with one server-authoritative group binding.
-- Additive: previously issued teacher/student/guest codes remain valid.
create table if not exists private.game_group_access_codes (
 invite_id uuid primary key references public.invite_codes(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 group_name text not null check (char_length(btrim(group_name)) between 1 and 80),
 created_at timestamptz not null default now()
);
create index if not exists game_group_access_codes_game_idx on private.game_group_access_codes(game_id);
alter table private.game_group_access_codes enable row level security;
revoke all on private.game_group_access_codes from public, anon, authenticated;

create or replace function public.teacher_create_access_code(
 p_game_id uuid,p_code text,p_scope text,p_group_name text default null
) returns uuid language plpgsql security definer set search_path to '' as $$
declare v_id uuid; v_secret text:=btrim(coalesce(p_code,''));v_group text:=btrim(coalesce(p_group_name,''));
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required';end if;
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
end $$;
revoke all on function public.teacher_create_access_code(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.teacher_create_access_code(uuid,text,text,text) to authenticated;

create or replace function public.teacher_access_code_list(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_codes jsonb;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,'scope',case when g.invite_id is null then 'participant' else 'group' end,
  'group_name',g.group_name,'active',i.active,'created_at',i.created_at
 ) order by i.created_at desc),'[]'::jsonb) into v_codes
 from public.invite_codes i left join private.game_group_access_codes g
  on g.invite_id=i.id and g.game_id=i.game_id
 where i.game_id=p_game_id and i.kind='student';
 return v_codes;
end $$;
revoke all on function public.teacher_access_code_list(uuid) from public,anon,authenticated;
grant execute on function public.teacher_access_code_list(uuid) to authenticated;

create or replace function public.teacher_revoke_access_code(p_game_id uuid,p_invite_id uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required';end if;
 update public.invite_codes set active=false
 where id=p_invite_id and game_id=p_game_id and kind='student' and active;
 return found;
end $$;
revoke all on function public.teacher_revoke_access_code(uuid,uuid) from public,anon,authenticated;
grant execute on function public.teacher_revoke_access_code(uuid,uuid) to authenticated;

create or replace function public.teacher_update_game_code(p_game_id uuid,p_new_code text)
returns text language plpgsql security definer set search_path to '' as $$
declare v_code text:=upper(btrim(coalesce(p_new_code,'')));
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required';end if;
 if v_code !~ '^[A-Z0-9-]{4,32}$' then raise exception 'Game code must be 4-32 Latin letters, digits or hyphens';end if;
 update public.games set game_code=v_code where id=p_game_id;
 if not found then raise exception 'Game not found';end if;
 return v_code;
end $$;
revoke all on function public.teacher_update_game_code(uuid,text) from public,anon,authenticated;
grant execute on function public.teacher_update_game_code(uuid,text) to authenticated;

-- Only group-bound student invitations override the entered group name.
-- The existing common student, teacher and guest paths remain compatible.
create or replace function public.join_game_with_code(
 p_game_code text,p_invite_code text,p_full_name text,p_group_name text default null
) returns uuid language plpgsql security definer set search_path to '' as $$
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
end $$;
-- Retain existing explicit RPC execute privileges; do not expose the private table.
