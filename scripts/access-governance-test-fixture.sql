-- Disposable PostgreSQL test fixture. Never run against production.
create schema auth;
create schema private;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create role anon;
create role authenticated;
create type public.member_kind as enum ('student','teacher','observer');
create or replace function auth.uid() returns uuid
 language sql stable as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
create table public.games(id uuid primary key,game_code text unique,title text,owner_id uuid);
create table public.platform_admins(user_id uuid primary key);
create table public.game_members(
 game_id uuid not null references public.games(id),
 user_id uuid not null,full_name text not null,group_name text,kind public.member_kind not null,
 role_title text,joined_at timestamptz not null default now(),
 primary key(game_id,user_id)
);
create table public.invite_codes(
 id uuid primary key default gen_random_uuid(),
 game_id uuid references public.games(id),
 code_hash text not null,kind public.member_kind not null,
 active boolean not null default true,created_at timestamptz not null default now()
);
create table private.game_group_access_codes(
 invite_id uuid primary key references public.invite_codes(id) on delete cascade,
 game_id uuid not null references public.games(id),
 group_name text not null
);
create table public.audit_log(
 id bigint generated always as identity primary key,
 game_id uuid not null,actor_id uuid,action text,entity_type text,payload jsonb
);
create table public.game_votes(id uuid primary key,game_id uuid not null references public.games(id));
create table public.chat_messages(id uuid primary key default gen_random_uuid(),game_id uuid not null,author_id uuid,text text);
create table public.political_posts(id uuid primary key default gen_random_uuid(),game_id uuid not null,author_id uuid);
create table public.formal_documents(id uuid primary key default gen_random_uuid(),game_id uuid not null,author_id uuid);
create table public.event_decisions(id uuid primary key default gen_random_uuid(),game_id uuid not null,actor_id uuid);
create table public.game_ballots(vote_id uuid not null references public.game_votes(id),voter_id uuid not null,primary key(vote_id,voter_id));
create or replace function private.is_game_teacher(g uuid)
returns boolean language sql stable security definer set search_path to '' as $$
 select exists(select 1 from public.game_members where game_id=g and user_id=auth.uid() and kind='teacher')
 or exists(select 1 from public.platform_admins where user_id=auth.uid())
$$;

insert into public.games(id,game_code,title,owner_id) values
 ('11111111-1111-4111-8111-111111111111','GOS-TEST','Game 1','22222222-2222-4222-8222-222222222222'),
 ('99999999-9999-4999-8999-999999999999','OTHER','Game 2','88888888-8888-4888-8888-888888888888');
insert into public.game_members(game_id,user_id,full_name,group_name,kind)
values
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Teacher',null,'teacher'),
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','Student','8.414','student'),
 ('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','Guest',null,'observer'),
 ('99999999-9999-4999-8999-999999999999','88888888-8888-4888-8888-888888888888','Other Teacher',null,'teacher');
insert into public.game_votes(id,game_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111');
