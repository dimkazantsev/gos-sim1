-- Disposable scoring QA only. Simplified local membership schema and assessment RLS.
-- The public.get_public_stage_scores RPC is imported unchanged from migration.
create schema if not exists private;
create function private.is_game_member(p_game uuid) returns boolean language sql stable security definer set search_path='' as $f$
select auth.uid() is not null and exists(select 1 from public.game_members where game_id=p_game and user_id=auth.uid()) $f$;
create function private.is_game_teacher(p_game uuid) returns boolean language sql stable security definer set search_path='' as $f$
select auth.uid() is not null and exists(select 1 from public.game_members where game_id=p_game and user_id=auth.uid() and kind='teacher') $f$;
revoke all on function private.is_game_member(uuid),private.is_game_teacher(uuid) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_game_member(uuid),private.is_game_teacher(uuid) to authenticated;
create table public.stage_assessments (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id),
 user_id uuid not null references auth.users(id),
 stage_no integer not null check(stage_no between 1 and 16),
 auto_score integer not null,
 final_score integer,
 status text not null,
 evidence_summary jsonb not null default '{}'::jsonb,
 rationale text,
 unique(game_id,user_id,stage_no)
);
alter table public.game_members enable row level security;
revoke all on public.game_members from public,anon,authenticated;
alter table public.stage_assessments enable row level security;
create policy stage_assessments_read on public.stage_assessments for select to authenticated
using(private.is_game_teacher(game_id) or (user_id=(select auth.uid()) and private.is_game_member(game_id)));
revoke all on public.stage_assessments from public,anon,authenticated;
grant select on public.stage_assessments to authenticated;
create table public.qa_scores_guard(marker text primary key);
insert into public.qa_scores_guard values ('gos-id-disposable-scores-100-v1');
revoke all on public.qa_scores_guard from public,anon,authenticated;
grant select on public.qa_scores_guard to service_role;
