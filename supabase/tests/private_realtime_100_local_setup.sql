-- Disposal-only local Supabase fixture. NEVER apply as production migration.
-- Uses the real production policies and party-document Broadcast trigger,
-- with a deliberately smaller membership predicate for an isolated schema.
create schema if not exists private;
create or replace function private.is_game_member(p_game uuid)
returns boolean
language sql stable security definer set search_path = ''
as $member$
  select auth.uid() is not null
    and exists (
      select 1 from public.game_members m
      where m.game_id=p_game and m.user_id=auth.uid()
    );
$member$;
revoke all on function private.is_game_member(uuid) from public,anon,authenticated;

create table public.party_documents(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  status text not null default 'submitted'
);
-- The local test runner's service-role client can insert one metadata-only row.
-- It never uploads document bodies or secret answers.
