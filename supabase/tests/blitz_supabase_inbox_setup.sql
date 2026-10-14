-- Disposable local Supabase fixture for the inbox migration.
create schema if not exists private;
alter table public.game_members add column if not exists roster_archived_at timestamptz;
alter table public.blitz_questions add column if not exists legal_review_status text not null default 'approved';
create table if not exists public.game_stages(
 game_id uuid not null references public.games(id),stage_no integer not null,status text not null default 'open',
 primary key(game_id,stage_no)
);
create table if not exists public.blitz_daily_plans(
 game_id uuid not null,user_id uuid not null,assigned_day date not null,
 stage_no integer not null,target_count integer not null,primary key(game_id,user_id,assigned_day)
);
-- Production owns the full implementation; the isolated fixture only verifies
-- compatibility and permissions of the newly added public/cron RPCs.
create or replace function public.blitz_issue_for_day(p_game uuid,p_student uuid,p_day date,p_stage integer)
returns integer language sql security definer set search_path='public','pg_temp'
as $q$select 0::integer$q$;
