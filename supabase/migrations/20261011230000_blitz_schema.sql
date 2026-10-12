
-- Additive Blitz schema; does not alter login, existing VSN or grades.
create table if not exists public.blitz_questions (
 id bigint generated always as identity primary key,
 topic text not null,
 question text not null unique,
 options jsonb not null check (jsonb_typeof(options)='array' and jsonb_array_length(options) in (2,4)),
 correct_index integer not null check (correct_index between 0 and 3 and correct_index < jsonb_array_length(options)),
 legal_act text not null,
 article text not null,
 source_url text not null,
 explanation text not null,
 verified boolean not null default false
);
create table if not exists public.blitz_daily_plans (
 game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null,
 assigned_day date not null,
 stage_no integer not null,
 target_count integer not null check(target_count between 3 and 5),
 primary key(game_id,user_id,assigned_day)
);
create table if not exists public.blitz_assignments (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null,
 question_id bigint not null references public.blitz_questions(id),
 stage_no integer not null,
 assigned_day date not null,
 available_at timestamptz not null,
 started_at timestamptz,
 answered_at timestamptz,
 chosen_index integer,
 is_correct boolean,
 unique (game_id,user_id,question_id),
 constraint blitz_answer_complete check (
  (answered_at is null and chosen_index is null and is_correct is null)
  or (answered_at is not null and is_correct is not null)
 )
);
create index if not exists blitz_queue_idx on public.blitz_assignments(game_id,user_id,answered_at,available_at);
create index if not exists blitz_teacher_idx on public.blitz_assignments(game_id,question_id,user_id);
create table if not exists public.blitz_check_notes (
 game_id uuid not null references public.games(id) on delete cascade,
 check_key text not null,
 teacher_id uuid not null,
 correction text not null default '',
 updated_at timestamptz not null default now(),
 primary key(game_id,check_key)
);
alter table public.blitz_questions enable row level security;
alter table public.blitz_daily_plans enable row level security;
alter table public.blitz_assignments enable row level security;
alter table public.blitz_check_notes enable row level security;
revoke all on public.blitz_questions,public.blitz_daily_plans,public.blitz_assignments,public.blitz_check_notes from anon,authenticated;
grant select on public.blitz_assignments,public.blitz_daily_plans,public.blitz_check_notes to authenticated;
grant insert,update on public.blitz_check_notes to authenticated;
DO $policy$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='blitz_assignments' AND policyname='blitz_student_assigned') THEN
  EXECUTE $policy_sql$create policy blitz_student_assigned on public.blitz_assignments for select to authenticated using (
 user_id = (select auth.uid())
 or exists(select 1 from public.game_members m where m.game_id=blitz_assignments.game_id and m.user_id=(select auth.uid()) and m.kind='teacher')
);$policy_sql$;
 END IF;
END $policy$;
DO $policy$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='blitz_daily_plans' AND policyname='blitz_student_daily') THEN
  EXECUTE $policy_sql$create policy blitz_student_daily on public.blitz_daily_plans for select to authenticated using (
 user_id=(select auth.uid())
 or exists(select 1 from public.game_members m where m.game_id=blitz_daily_plans.game_id and m.user_id=(select auth.uid()) and m.kind='teacher')
);$policy_sql$;
 END IF;
END $policy$;
DO $policy$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='blitz_check_notes' AND policyname='blitz_teacher_notes_read') THEN
  EXECUTE $policy_sql$create policy blitz_teacher_notes_read on public.blitz_check_notes for select to authenticated using (
 exists(select 1 from public.game_members m where m.game_id=blitz_check_notes.game_id and m.user_id=(select auth.uid()) and m.kind='teacher')
);$policy_sql$;
 END IF;
END $policy$;
DO $policy$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='blitz_check_notes' AND policyname='blitz_teacher_notes_insert') THEN
  EXECUTE $policy_sql$create policy blitz_teacher_notes_insert on public.blitz_check_notes for insert to authenticated with check (
 teacher_id=(select auth.uid()) and exists(select 1 from public.game_members m where m.game_id=blitz_check_notes.game_id and m.user_id=(select auth.uid()) and m.kind='teacher')
);$policy_sql$;
 END IF;
END $policy$;
DO $policy$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='blitz_check_notes' AND policyname='blitz_teacher_notes_update') THEN
  EXECUTE $policy_sql$create policy blitz_teacher_notes_update on public.blitz_check_notes for update to authenticated using (
 exists(select 1 from public.game_members m where m.game_id=blitz_check_notes.game_id and m.user_id=(select auth.uid()) and m.kind='teacher')
) with check (teacher_id=(select auth.uid()));$policy_sql$;
 END IF;
END $policy$;
