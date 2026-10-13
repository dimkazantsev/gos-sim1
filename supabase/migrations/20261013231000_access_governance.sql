-- ГОС.ID: unified invitations and reversible membership moderation.
-- Existing invitation hashes, identity records, scores and publications stay intact.
create table if not exists private.game_member_access (
 game_id uuid not null,
 user_id uuid not null,
 mode text not null default 'active' check (mode in ('active','blocked','removed')),
 restricted_actions text[] not null default '{}'::text[],
 expires_at timestamptz,
 reason text not null default '',
 changed_by uuid not null,
 changed_at timestamptz not null default now(),
 primary key(game_id,user_id),
 foreign key(game_id,user_id) references public.game_members(game_id,user_id) on delete cascade,
 check (restricted_actions <@ array['chat','posts','documents','votes','cases']::text[]),
 check (mode='active' or cardinality(restricted_actions)=0),
 check (mode<>'removed' or expires_at is null)
);
create index if not exists game_member_access_expiry_idx on private.game_member_access(game_id,expires_at);
alter table private.game_member_access enable row level security;
revoke all on private.game_member_access from public,anon,authenticated;

-- Central membership gate, used by the existing RLS policies. Timed bans expire automatically.
create or replace function private.is_game_member(g uuid)
returns boolean language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null then return false; end if;
 if exists(select 1 from public.platform_admins p where p.user_id=v_uid) then return true; end if;
 return exists(
  select 1 from public.game_members gm
  left join private.game_member_access a on a.game_id=gm.game_id and a.user_id=gm.user_id
  where gm.game_id=g and gm.user_id=v_uid
    and (gm.kind='teacher' or a.mode is null or a.mode='active'
         or (a.mode='blocked' and a.expires_at is not null and a.expires_at<=now()))
 );
end $$;

create or replace function private.can_game_member_action(p_game uuid,p_action text)
returns boolean language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid:=auth.uid();v_mode text;v_actions text[];v_until timestamptz;
begin
 if v_uid is null then return true; end if; -- server-side scheduled maintenance
 if not private.is_game_member(p_game) then return false; end if;
 select mode,restricted_actions,expires_at into v_mode,v_actions,v_until
 from private.game_member_access where game_id=p_game and user_id=v_uid;
 if not found then return true; end if;
 if v_until is not null and v_until<=now() then return v_mode<>'removed'; end if;
 return v_mode='active' and not (p_action=any(v_actions));
end $$;

-- Trigger guard also applies to SECURITY DEFINER RPCs; UI-only restrictions are insufficient.
create or replace function private.guard_game_member_action()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_game uuid;v_action text;
begin
 if auth.uid() is null then return new; end if;
 if tg_table_name='game_ballots' then
  select game_id into v_game from public.game_votes where id=new.vote_id;
  v_action:='votes';
 else
  v_game:=new.game_id;
  v_action:=case tg_table_name
   when 'chat_messages' then 'chat'
   when 'political_posts' then 'posts'
   when 'formal_documents' then 'documents'
   when 'event_decisions' then 'cases'
  end;
 end if;
 if v_game is not null and v_action is not null
    and not private.can_game_member_action(v_game,v_action) then
  raise exception 'Действие временно ограничено преподавателем или доступ к игре закрыт' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists guard_game_member_access on public.chat_messages;
create trigger guard_game_member_access before insert or update on public.chat_messages
for each row execute function private.guard_game_member_action();
drop trigger if exists guard_game_member_access on public.political_posts;
create trigger guard_game_member_access before insert or update on public.political_posts
for each row execute function private.guard_game_member_action();
drop trigger if exists guard_game_member_access on public.formal_documents;
create trigger guard_game_member_access before insert or update on public.formal_documents
for each row execute function private.guard_game_member_action();
drop trigger if exists guard_game_member_access on public.game_ballots;
create trigger guard_game_member_access before insert or update on public.game_ballots
for each row execute function private.guard_game_member_action();
drop trigger if exists guard_game_member_access on public.event_decisions;
create trigger guard_game_member_access before insert or update on public.event_decisions
for each row execute function private.guard_game_member_action();

create or replace function public.teacher_member_access_list(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_rows jsonb;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'user_id',m.user_id,'full_name',m.full_name,'group_name',m.group_name,
  'role_title',m.role_title,'joined_at',m.joined_at,
  'mode',coalesce(a.mode,'active'),
  'restricted_actions',coalesce(a.restricted_actions,'{}'::text[]),
  'expires_at',a.expires_at,'reason',coalesce(a.reason,''),
  'changed_at',a.changed_at
 ) order by m.full_name,m.joined_at),'[]'::jsonb) into v_rows
 from public.game_members m
 left join private.game_member_access a on a.game_id=m.game_id and a.user_id=m.user_id
 where m.game_id=p_game_id and m.kind<>'teacher';
 return v_rows;
end $$;
revoke all on function public.teacher_member_access_list(uuid) from public,anon,authenticated;
grant execute on function public.teacher_member_access_list(uuid) to authenticated;

create or replace function public.teacher_set_member_access(
 p_game_id uuid,p_user_id uuid,p_mode text,p_actions text[],
 p_expires_at timestamptz,p_reason text
) returns boolean language plpgsql security definer set search_path to '' as $$
declare v_kind public.member_kind;v_actions text[]:=coalesce(p_actions,'{}'::text[]);
declare v_reason text:=btrim(coalesce(p_reason,''));
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required'; end if;
 select kind into v_kind from public.game_members where game_id=p_game_id and user_id=p_user_id for update;
 if not found then raise exception 'Участник не найден в этой игре'; end if;
 if v_kind='teacher' or exists(select 1 from public.platform_admins where user_id=p_user_id) then
  raise exception 'Нельзя ограничивать преподавателя или администратора';
 end if;
 if p_mode not in ('active','blocked','removed') then raise exception 'Неверный тип ограничения'; end if;
 if v_actions <@ array['chat','posts','documents','votes','cases']::text[] is not true
  or (p_mode<>'active' and cardinality(v_actions)>0) then raise exception 'Неверные ограничиваемые функции'; end if;
 if p_mode='removed' and p_expires_at is not null then raise exception 'Исключение бессрочное'; end if;
 if p_expires_at is not null and p_expires_at<=now() then raise exception 'Дата окончания должна быть в будущем'; end if;
 if p_mode='active' and cardinality(v_actions)=0 and p_expires_at is not null then
  raise exception 'Для восстановления срока не требуется'; end if;
 if (p_mode<>'active' or cardinality(v_actions)>0) and char_length(v_reason)<3 then
  raise exception 'Укажите основание (не менее 3 символов)'; end if;
 insert into private.game_member_access(game_id,user_id,mode,restricted_actions,expires_at,reason,changed_by)
 values(p_game_id,p_user_id,p_mode,v_actions,p_expires_at,v_reason,auth.uid())
 on conflict(game_id,user_id) do update set
  mode=excluded.mode,restricted_actions=excluded.restricted_actions,
  expires_at=excluded.expires_at,reason=excluded.reason,
  changed_by=excluded.changed_by,changed_at=now();
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p_game_id,auth.uid(),'member_access_changed','member',
  jsonb_build_object('user_id',p_user_id,'mode',p_mode,'actions',v_actions,
                     'expires_at',p_expires_at,'reason',v_reason));
 return true;
end $$;
revoke all on function public.teacher_set_member_access(uuid,uuid,text,text[],timestamptz,text) from public,anon,authenticated;
grant execute on function public.teacher_set_member_access(uuid,uuid,text,text[],timestamptz,text) to authenticated;

-- Guest and participant invitations share one teacher-only catalogue (never exposes hashes).
create or replace function public.teacher_access_code_list(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_codes jsonb;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,
  'scope',case when i.kind='observer' then 'guest'
               when g.invite_id is null then 'participant' else 'group' end,
  'group_name',g.group_name,'active',i.active,'created_at',i.created_at
 ) order by i.created_at desc),'[]'::jsonb) into v_codes
 from public.invite_codes i
 left join private.game_group_access_codes g on g.invite_id=i.id and g.game_id=i.game_id
 where i.game_id=p_game_id and i.kind in ('student','observer');
 return v_codes;
end $$;

create or replace function public.teacher_revoke_access_code(p_game_id uuid,p_invite_id uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required'; end if;
 update public.invite_codes set active=false
 where id=p_invite_id and game_id=p_game_id and kind in ('student','observer') and active;
 return found;
end $$;

-- Guest invitations already use bcrypt hashes; keep their 6-character minimum.
create or replace function public.create_observer_invite(p_game_id uuid,p_code text)
returns void language plpgsql security definer set search_path to 'public','private','pg_temp' as $$
declare v_code text:=btrim(coalesce(p_code,''));
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required'; end if;
 if char_length(v_code) not between 6 and 80 then raise exception 'Код гостя должен содержать от 6 до 80 символов'; end if;
 if exists(select 1 from public.invite_codes where game_id=p_game_id and active
  and code_hash=extensions.crypt(v_code,code_hash)) then
  raise exception 'Такой код уже используется в игре';
 end if;
 insert into public.invite_codes(game_id,code_hash,kind,active)
 values(p_game_id,extensions.crypt(v_code,extensions.gen_salt('bf')),'observer',true);
end $$;

-- Restore explicit code-RPC privileges and prevent public invocation.
revoke all on function public.teacher_access_code_list(uuid) from public,anon,authenticated;
grant execute on function public.teacher_access_code_list(uuid) to authenticated;
revoke all on function public.teacher_revoke_access_code(uuid,uuid) from public,anon,authenticated;
grant execute on function public.teacher_revoke_access_code(uuid,uuid) to authenticated;
revoke all on function public.create_observer_invite(uuid,text) from public,anon,authenticated;
grant execute on function public.create_observer_invite(uuid,text) to authenticated;

-- Existing join semantics retained, plus server-side rejection of banned/removed identities.
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
 if exists(select 1 from private.game_member_access a
   where a.game_id=g and a.user_id=auth.uid()
   and (a.mode='removed' or (a.mode='blocked' and (a.expires_at is null or a.expires_at>now()))))
 then raise exception 'Доступ к игре ограничен преподавателем'; end if;
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
