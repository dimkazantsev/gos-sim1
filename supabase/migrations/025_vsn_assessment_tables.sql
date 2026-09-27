-- Automatic VSN assessment: storage, RLS and indexes for all 16 stages.

create extension if not exists pg_cron with schema extensions;

update public.games
set settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{evaluation_timezone}','"Asia/Barnaul"'::jsonb,true)
where not (coalesce(settings,'{}'::jsonb) ? 'evaluation_timezone');

create table if not exists public.stage_debriefs(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null check(stage_no between 1 and 16),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(game_id,stage_no,user_id)
);

create table if not exists public.stage_assessments(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null check(stage_no between 1 and 16),
  user_id uuid not null references auth.users(id) on delete cascade,
  auto_score integer not null default 0 check(auto_score between 0 and 3),
  final_score integer check(final_score between 0 and 3),
  status text not null default 'draft' check(status in ('draft','final')),
  criterion_law boolean not null default false,
  criterion_strategy boolean not null default false,
  criterion_debrief boolean not null default false,
  public_rationale text not null default '',
  evidence_summary jsonb not null default '{}'::jsonb,
  last_run_type text not null default 'hourly'
    check(last_run_type in ('hourly','nightly','stage_close','debrief','manual')),
  last_auto_at timestamptz,
  revision_count integer not null default 0,
  teacher_note text,
  finalized_by uuid references auth.users(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(game_id,stage_no,user_id)
);

create table if not exists public.stage_assessment_runs(
  id bigserial primary key,
  assessment_id uuid not null references public.stage_assessments(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_type text not null check(run_type in ('hourly','nightly','stage_close','debrief','manual')),
  auto_score integer not null check(auto_score between 0 and 3),
  criterion_law boolean not null,
  criterion_strategy boolean not null,
  criterion_debrief boolean not null,
  rationale text not null,
  evidence_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists stage_assessments_game_stage_idx
  on public.stage_assessments(game_id,stage_no,user_id);
create index if not exists stage_assessments_user_idx
  on public.stage_assessments(game_id,user_id,stage_no);
create index if not exists stage_assessment_runs_lookup_idx
  on public.stage_assessment_runs(game_id,user_id,stage_no,created_at desc);
create index if not exists stage_debriefs_lookup_idx
  on public.stage_debriefs(game_id,user_id,stage_no);
create index if not exists chat_messages_assessment_idx
  on public.chat_messages(game_id,author_id,created_at);
create index if not exists political_posts_assessment_idx
  on public.political_posts(game_id,author_id,created_at);
create index if not exists game_activity_assessment_idx
  on public.game_activity(game_id,actor_id,created_at);
create index if not exists player_actions_assessment_idx
  on public.player_actions(game_id,author_id,round_no);
create index if not exists formal_documents_assessment_idx
  on public.formal_documents(game_id,author_id,stage_no);
create index if not exists formal_history_assessment_idx
  on public.formal_document_history(game_id,actor_id,created_at);
create index if not exists party_invitations_assessment_idx
  on public.party_invitations(game_id,invited_by,created_at);
create index if not exists ballots_assessment_voter_idx
  on public.game_ballots(voter_id,created_at);

alter table public.stage_debriefs enable row level security;
alter table public.stage_assessments enable row level security;
alter table public.stage_assessment_runs enable row level security;

grant select,insert,update on public.stage_debriefs to authenticated;
grant select on public.stage_assessments to authenticated;
grant select on public.stage_assessment_runs to authenticated;

drop policy if exists stage_debriefs_read on public.stage_debriefs;
create policy stage_debriefs_read on public.stage_debriefs
for select to authenticated
using(private.is_game_teacher(game_id) or user_id=(select auth.uid()));

drop policy if exists stage_debriefs_insert on public.stage_debriefs;
create policy stage_debriefs_insert on public.stage_debriefs
for insert to authenticated
with check(private.is_game_member(game_id) and user_id=(select auth.uid()));

drop policy if exists stage_debriefs_update on public.stage_debriefs;
create policy stage_debriefs_update on public.stage_debriefs
for update to authenticated
using(user_id=(select auth.uid()) and private.is_game_member(game_id))
with check(user_id=(select auth.uid()) and private.is_game_member(game_id));

drop policy if exists stage_assessments_read on public.stage_assessments;
create policy stage_assessments_read on public.stage_assessments
for select to authenticated
using(private.is_game_member(game_id));

drop policy if exists stage_assessment_runs_read on public.stage_assessment_runs;
create policy stage_assessment_runs_read on public.stage_assessment_runs
for select to authenticated
using(private.is_game_teacher(game_id) or user_id=(select auth.uid()));

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='stage_assessments'
  ) then alter publication supabase_realtime add table public.stage_assessments; end if;
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='stage_debriefs'
  ) then alter publication supabase_realtime add table public.stage_debriefs; end if;
end $$;
