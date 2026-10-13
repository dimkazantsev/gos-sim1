-- Disposable database fixture. NEVER execute against production.
create schema private;
create schema auth;
create role anon;
create role authenticated;
create type public.member_kind as enum('student','teacher','observer');
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('test.user_id',true),'')::uuid
$$;
create table public.games(id uuid primary key,game_code text);
create table public.game_members(game_id uuid not null,user_id uuid not null,
 kind public.member_kind not null,primary key(game_id,user_id));
create table public.invite_codes(id uuid primary key,game_id uuid not null,
 code_hash text not null,kind public.member_kind not null,
 active boolean not null default true,created_at timestamptz not null default now());
create table private.game_group_access_codes(game_id uuid not null,invite_id uuid primary key,
 group_name text not null);
create function private.is_game_teacher(g uuid) returns boolean
 language sql stable security definer set search_path to '' as $$
 select exists(select 1 from public.game_members
 where game_id=g and user_id=auth.uid() and kind='teacher')
$$;
insert into public.games(id,game_code) values
 ('11111111-1111-4111-8111-111111111111','8.414'),
 ('22222222-2222-4222-8222-222222222222','OTHER');
insert into public.game_members(game_id,user_id,kind) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','teacher'),
 ('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','student'),
 ('22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','teacher');
insert into public.invite_codes(id,game_id,code_hash,kind) values
 ('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','hashed participant','student'),
 ('00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','hashed group','student'),
 ('00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','hashed guest','observer'),
 ('00000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','hashed teacher','teacher'),
 ('00000000-0000-4000-8000-000000000005','22222222-2222-4222-8222-222222222222','other game','observer');
insert into private.game_group_access_codes(game_id,invite_id,group_name)
values('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000002','8.414');
