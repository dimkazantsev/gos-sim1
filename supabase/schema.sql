create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

create type public.member_kind as enum ('student','teacher','observer');
create type public.action_status as enum ('draft','submitted','accepted','rejected');
create type public.message_kind as enum ('text','audio','video','file','system');

create table public.games(
 id uuid primary key default gen_random_uuid(),
 title text not null,
 game_code text not null unique,
 owner_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'lobby',
 current_round int not null default 1 check (current_round > 0),
 turn_open boolean not null default false,
 turn_ends_at timestamptz,
 settings jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create table public.game_members(
 game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 full_name text not null check (char_length(full_name) between 2 and 200),
 group_name text,
 kind public.member_kind not null default 'student',
 role_title text,
 team text,
 score numeric not null default 0,
 joined_at timestamptz not null default now(),
 primary key(game_id,user_id)
);

create table public.invite_codes(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 code_hash text not null,
 kind public.member_kind not null,
 active boolean not null default true,
 created_at timestamptz not null default now()
);

create table public.rounds(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 round_no int not null check (round_no > 0),
 status text not null default 'planned',
 started_at timestamptz,
 ends_at timestamptz,
 unique(game_id,round_no)
);

create table public.state_metrics(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 metric_key text not null,
 label text not null,
 value numeric not null default 0,
 previous_value numeric,
 unit text,
 is_public boolean not null default true,
 updated_at timestamptz not null default now(),
 unique(game_id,metric_key)
);

create table public.game_events(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 round_no int not null default 1,
 category text not null default 'general',
 severity text not null default 'info',
 title text not null,
 body text not null,
 effects jsonb not null default '{}'::jsonb,
 audience jsonb not null default '{"public":true}'::jsonb,
 created_by uuid references auth.users(id),
 published_at timestamptz not null default now()
);

create table public.player_actions(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 round_no int not null default 1,
 author_id uuid not null references auth.users(id),
 action_type text not null,
 title text not null,
 body text not null,
 budget numeric not null default 0 check (budget >= 0),
 urgency text not null default 'normal',
 status public.action_status not null default 'submitted',
 payload jsonb not null default '{}'::jsonb,
 teacher_feedback text,
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 submitted_at timestamptz not null default now()
);

create table public.chat_channels(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 name text not null,
 kind text not null default 'public' check (kind in ('public','team','private','teacher')),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);

create table public.channel_members(
 channel_id uuid not null references public.chat_channels(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(channel_id,user_id)
);

create table public.chat_messages(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 channel_id uuid not null references public.chat_channels(id) on delete cascade,
 author_id uuid references auth.users(id),
 kind public.message_kind not null default 'text',
 text text,
 storage_path text,
 mime_type text,
 created_at timestamptz not null default now(),
 check (text is not null or storage_path is not null)
);

create table public.game_documents(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 title text not null,
 doc_type text,
 body text,
 visibility jsonb not null default '{"public":true}'::jsonb,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);

create table public.missions(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 round_no int,
 title text not null,
 body text,
 assigned_to uuid references auth.users(id),
 assigned_team text,
 status text not null default 'open',
 created_at timestamptz not null default now()
);

create table public.audit_log(
 id bigint generated always as identity primary key,
 game_id uuid not null references public.games(id) on delete cascade,
 actor_id uuid references auth.users(id),
 action text not null,
 entity_type text,
 entity_id uuid,
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create index game_members_user_idx on public.game_members(user_id);
create index game_events_game_published_idx on public.game_events(game_id,published_at desc);
create index player_actions_game_submitted_idx on public.player_actions(game_id,submitted_at desc);
create index chat_messages_channel_created_idx on public.chat_messages(channel_id,created_at);
create index audit_log_game_created_idx on public.audit_log(game_id,created_at desc);

create or replace function private.is_game_member(g uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
 select exists(
   select 1
   from public.game_members gm
   where gm.game_id = g and gm.user_id = (select auth.uid())
 );
$$;

create or replace function private.is_game_teacher(g uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
 select exists(
   select 1
   from public.game_members gm
   where gm.game_id = g
     and gm.user_id = (select auth.uid())
     and gm.kind = 'teacher'
 );
$$;

create or replace function private.can_access_channel(c uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
 select exists(
   select 1
   from public.chat_channels cc
   where cc.id = c
     and private.is_game_member(cc.game_id)
     and (
       cc.kind = 'public'
       or private.is_game_teacher(cc.game_id)
       or exists(
         select 1
         from public.channel_members cm
         where cm.channel_id = cc.id
           and cm.user_id = (select auth.uid())
       )
     )
 );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.is_game_member(uuid) from public, anon;
revoke all on function private.is_game_teacher(uuid) from public, anon;
revoke all on function private.can_access_channel(uuid) from public, anon;
grant execute on function private.is_game_member(uuid) to authenticated;
grant execute on function private.is_game_teacher(uuid) to authenticated;
grant execute on function private.can_access_channel(uuid) to authenticated;

create or replace function public.create_game_session(
 p_title text,
 p_game_code text,
 p_teacher_code text,
 p_student_code text,
 p_teacher_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
 g uuid;
 c uuid;
begin
 if (select auth.uid()) is null then
   raise exception 'Authentication required';
 end if;
 if coalesce(trim(p_title),'') = '' or coalesce(trim(p_game_code),'') = '' then
   raise exception 'Title and game code are required';
 end if;
 if char_length(p_teacher_code) < 4 or char_length(p_student_code) < 4 then
   raise exception 'Invite codes must be at least 4 characters';
 end if;
 if p_teacher_code = p_student_code then
   raise exception 'Teacher and student codes must be different';
 end if;

 insert into public.games(title,game_code,owner_id,status)
 values(trim(p_title),upper(trim(p_game_code)),(select auth.uid()),'lobby')
 returning id into g;

 insert into public.game_members(game_id,user_id,full_name,kind,role_title)
 values(g,(select auth.uid()),trim(p_teacher_name),'teacher','Руководитель симуляции');

 insert into public.invite_codes(game_id,code_hash,kind) values
 (g,extensions.crypt(p_teacher_code,extensions.gen_salt('bf')),'teacher'),
 (g,extensions.crypt(p_student_code,extensions.gen_salt('bf')),'student');

 insert into public.state_metrics(game_id,metric_key,label,value,unit) values
 (g,'legitimacy','Легитимность',67,'%'),
 (g,'economy','Экономика',54,'%'),
 (g,'budget','Бюджет',742,' млн'),
 (g,'social_tension','Социальное напряжение',41,'%'),
 (g,'security','Безопасность',73,'%');

 insert into public.chat_channels(game_id,name,kind,created_by)
 values(g,'Общий штаб','public',(select auth.uid()))
 returning id into c;

 insert into public.rounds(game_id,round_no,status) values(g,1,'planned');

 insert into public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
 values(g,(select auth.uid()),'game_created','game',g,jsonb_build_object('title',trim(p_title)));

 return g;
end
$$;

create or replace function public.join_game_with_code(
 p_game_code text,
 p_invite_code text,
 p_full_name text,
 p_group_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
 g uuid;
 k public.member_kind;
begin
 if (select auth.uid()) is null then
   raise exception 'Authentication required';
 end if;
 if coalesce(trim(p_full_name),'') = '' then
   raise exception 'Full name is required';
 end if;

 select ga.id, ic.kind
 into g,k
 from public.games ga
 join public.invite_codes ic on ic.game_id = ga.id
 where ga.game_code = upper(trim(p_game_code))
   and ic.active
   and ic.code_hash = extensions.crypt(p_invite_code,ic.code_hash)
 order by case ic.kind when 'teacher' then 0 else 1 end
 limit 1;

 if g is null then
   raise exception 'Invalid game or invite code';
 end if;

 insert into public.game_members(game_id,user_id,full_name,group_name,kind)
 values(g,(select auth.uid()),trim(p_full_name),nullif(trim(p_group_name),''),k)
 on conflict(game_id,user_id)
 do update set full_name=excluded.full_name,group_name=excluded.group_name;

 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(g,(select auth.uid()),'member_joined','member',jsonb_build_object('kind',k,'full_name',trim(p_full_name)));

 return g;
end
$$;

revoke all on function public.create_game_session(text,text,text,text,text) from public, anon;
revoke all on function public.join_game_with_code(text,text,text,text) from public, anon;
grant execute on function public.create_game_session(text,text,text,text,text) to authenticated;
grant execute on function public.join_game_with_code(text,text,text,text) to authenticated;

alter table public.games enable row level security;
alter table public.game_members enable row level security;
alter table public.invite_codes enable row level security;
alter table public.rounds enable row level security;
alter table public.state_metrics enable row level security;
alter table public.game_events enable row level security;
alter table public.player_actions enable row level security;
alter table public.chat_channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.game_documents enable row level security;
alter table public.missions enable row level security;
alter table public.audit_log enable row level security;

create policy games_read on public.games
for select to authenticated
using(private.is_game_member(id));

create policy games_teacher_update on public.games
for update to authenticated
using(private.is_game_teacher(id))
with check(private.is_game_teacher(id));

create policy members_read on public.game_members
for select to authenticated
using(private.is_game_member(game_id));

create policy members_teacher_update on public.game_members
for update to authenticated
using(private.is_game_teacher(game_id))
with check(private.is_game_teacher(game_id));

create policy rounds_read on public.rounds
for select to authenticated
using(private.is_game_member(game_id));

create policy rounds_teacher_all on public.rounds
for all to authenticated
using(private.is_game_teacher(game_id))
with check(private.is_game_teacher(game_id));

create policy metrics_read on public.state_metrics
for select to authenticated
using(private.is_game_member(game_id));

create policy metrics_teacher_all on public.state_metrics
for all to authenticated
using(private.is_game_teacher(game_id))
with check(private.is_game_teacher(game_id));

create policy events_read on public.game_events
for select to authenticated
using(private.is_game_member(game_id));

create policy events_teacher_all on public.game_events
for all to authenticated
using(private.is_game_teacher(game_id))
with check(private.is_game_teacher(game_id));

create policy actions_read on public.player_actions
for select to authenticated
using(private.is_game_teacher(game_id) or author_id=(select auth.uid()));

create policy actions_insert on public.player_actions
for insert to authenticated
with check(
 author_id=(select auth.uid())
 and private.is_game_member(game_id)
 and exists(
   select 1 from public.games g
   where g.id=game_id and g.turn_open=true
 )
);

create policy actions_teacher_update on public.player_actions
for update to authenticated
using(private.is_game_teacher(game_id))
with check(private.is_game_teacher(game_id));

create policy channels_read on public.chat_channels
for select to authenticated
using(private.can_access_channel(id));

create policy channels_teacher_all on public.chat_channels
for all to authenticated
using(private.is_game_teacher(game_id))
with check(private.is_game_teacher(game_id));

create policy channel_members_read on public.channel_members
for select to authenticated
using(private.can_access_channel(channel_id));

create policy channel_members_teacher_all on public.channel_members
for all to authenticated
using(
 exists(
   select 1 from public.chat_channels c
   where c.id=channel_id and private.is_game_teacher(c.game_id)
 )
)
with check(
 exists(
   select 1 from public.chat_channels c
   where c.id=channel_id and private.is_game_teacher(c.game_id)
 )
);

create policy messages_read on public.chat_messages
for select to authenticated
using(private.can_access_channel(channel_id));

create policy messages_insert on public.chat_messages
for insert to authenticated
with check(
 author_id=(select auth.uid())
 and private.can_access_channel(channel_id)
 and exists(
   select 1 from public.chat_channels c
   where c.id=channel_id and c.game_id=game_id
 )
);

create policy docs_read on public.game_documents
for select to authenticated
using(private.is_game_member(game_id));

create policy docs_teacher_all on public.game_documents
for all to authenticated
using(private.is_game_teacher(game_id))
with check(private.is_game_teacher(game_id));

create policy missions_read on public.missions
for select to authenticated
using(private.is_game_member(game_id));

create policy missions_teacher_all on public.missions
for all to authenticated
using(private.is_game_teacher(game_id))
with check(private.is_game_teacher(game_id));

create policy audit_read on public.audit_log
for select to authenticated
using(private.is_game_teacher(game_id));

revoke all on table public.invite_codes from anon, authenticated;
grant select, update on table public.games to authenticated;
grant select, update on table public.game_members to authenticated;
grant select, insert, update, delete on table public.rounds to authenticated;
grant select, insert, update, delete on table public.state_metrics to authenticated;
grant select, insert, update, delete on table public.game_events to authenticated;
grant select, insert, update on table public.player_actions to authenticated;
grant select, insert, update, delete on table public.chat_channels to authenticated;
grant select, insert, update, delete on table public.channel_members to authenticated;
grant select, insert on table public.chat_messages to authenticated;
grant select, insert, update, delete on table public.game_documents to authenticated;
grant select, insert, update, delete on table public.missions to authenticated;
grant select on table public.audit_log to authenticated;

insert into storage.buckets(id,name,public)
values('game-media','game-media',false)
on conflict(id) do update set public=false;

create policy game_media_insert
on storage.objects for insert to authenticated
with check(
 bucket_id='game-media'
 and (storage.foldername(name))[3]=(select auth.uid())::text
 and private.can_access_channel(((storage.foldername(name))[2])::uuid)
);

create policy game_media_read
on storage.objects for select to authenticated
using(
 bucket_id='game-media'
 and private.can_access_channel(((storage.foldername(name))[2])::uuid)
);

alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.state_metrics;
alter publication supabase_realtime add table public.game_events;
alter publication supabase_realtime add table public.player_actions;
alter publication supabase_realtime add table public.chat_messages;
