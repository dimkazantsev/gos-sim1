-- Synthetic PostgreSQL fixture. Never run against real GOС.ID data.
create schema if not exists auth;
create schema if not exists private;
do $$begin
 if not exists(select from pg_roles where rolname='anon')then create role anon nologin;end if;
 if not exists(select from pg_roles where rolname='authenticated')then create role authenticated nologin;end if;
end$$;
create or replace function auth.uid() returns uuid language sql stable as $f$
 select nullif(current_setting('app.test_uid',true),'')::uuid $f$;
create table public.game_members(
 game_id uuid not null,user_id uuid not null,kind text not null,role_title text not null,
 roster_archived_at timestamptz,primary key(game_id,user_id)
);
create table public.game_office_assignments(
 id uuid primary key,game_id uuid not null,user_id uuid not null,role_title text not null,
 status text not null,created_at timestamptz default now()
);
create table public.formal_documents(
 id uuid default gen_random_uuid() primary key,game_id uuid not null,author_id uuid not null,
 subject_key text not null,metadata jsonb not null default '{}'::jsonb
);
create or replace function private.is_game_teacher(p_game uuid)
returns boolean language sql stable as $f$
select exists(select 1 from public.game_members m where m.game_id=p_game
 and m.user_id=auth.uid() and m.kind='teacher') $f$;
