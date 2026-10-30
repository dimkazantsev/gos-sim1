-- Disposable QA fixture for #491: 100 Auth/JWT impact projections.
-- Retains production impact_rules/impact_ledger read-RLS semantics,
-- but is NOT the full game schema, and must never run on production.
create schema if not exists private;
create function private.is_game_member(g uuid)
returns boolean language sql stable security definer set search_path='' as $member$
select auth.uid() is not null and exists (
  select 1 from public.game_members m
  where m.game_id=g and m.user_id=auth.uid()
) $member$;
revoke all on function private.is_game_member(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_game_member(uuid) to authenticated;
alter table public.game_members enable row level security;
revoke all on public.game_members from public,anon,authenticated;

create table public.impact_rules(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 rule_key text not null, label text not null,
 event_type text not null, description text,
 conditions jsonb not null default '{}'::jsonb,
 effects jsonb not null default '{}'::jsonb,
 enabled boolean not null default true,
 auto_apply boolean not null default true,
 priority integer not null default 100,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(game_id,rule_key)
);
alter table public.impact_rules enable row level security;
create policy impact_rules_read on public.impact_rules for select to authenticated using(private.is_game_member(game_id));
revoke all on public.impact_rules from public,anon,authenticated;
grant select on public.impact_rules to authenticated;

create table public.impact_ledger(
 id bigserial primary key,
 game_id uuid not null references public.games(id) on delete cascade,
 rule_id uuid references public.impact_rules(id) on delete set null,
 rule_key text not null,
 source_type text not null, source_id text not null,
 actor_id uuid references auth.users(id) on delete set null,
 effects jsonb not null default '{}'::jsonb,
 note text, status text not null default 'applied' check(status in ('applied','reverted','adjusted')),
 created_at timestamptz not null default now(), reverted_at timestamptz,
 unique(game_id,rule_key,source_type,source_id)
);
create index impact_ledger_game_time_idx on public.impact_ledger(game_id,created_at desc);
alter table public.impact_ledger enable row level security;
create policy impact_ledger_read on public.impact_ledger for select to authenticated using(private.is_game_member(game_id));
revoke all on public.impact_ledger from public,anon,authenticated;
grant select on public.impact_ledger to authenticated;

create table public.qa_impact_projection_guard(marker text primary key);
insert into public.qa_impact_projection_guard values ('gos-id-disposable-impact-projection-100-v1');
revoke all on public.qa_impact_projection_guard from public,anon,authenticated;
grant select on public.qa_impact_projection_guard to service_role;
