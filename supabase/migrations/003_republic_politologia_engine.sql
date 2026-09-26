-- Republic Politologia game engine.
-- This migration mirrors the live Supabase schema used by GOS//SIM.

create table if not exists public.game_stages(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 stage_no integer not null check(stage_no between 1 and 16),
 title text not null,
 mode text not null,
 summary text not null,
 status text not null default 'locked' check(status in ('locked','open','completed')),
 deadline timestamptz,
 opened_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(game_id,stage_no)
);
create table if not exists public.game_parties(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 name text not null,
 ideology text,
 support numeric not null default 0 check(support between 0 and 100),
 mandates integer not null default 0 check(mandates>=0),
 regions integer not null default 0 check(regions>=0),
 budget numeric not null default 0,
 leader_user_id uuid references auth.users(id),
 color text not null default '#6f7cff',
 created_at timestamptz not null default now(),
 unique(game_id,name)
);
create table if not exists public.game_votes(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 stage_no integer not null default 1,
 title text not null,
 body text,
 voting_mode text not null default 'member' check(voting_mode in ('member','faction','mandate')),
 status text not null default 'open' check(status in ('open','closed')),
 created_by uuid references auth.users(id),
 opened_at timestamptz not null default now(),
 closed_at timestamptz
);
create table if not exists public.game_ballots(
 vote_id uuid not null references public.game_votes(id) on delete cascade,
 voter_id uuid not null references auth.users(id) on delete cascade,
 choice text not null check(choice in ('yes','no','abstain')),
 weight numeric not null default 1 check(weight>=0),
 created_at timestamptz not null default now(),
 primary key(vote_id,voter_id)
);
create table if not exists public.game_evaluations(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 stage_no integer not null check(stage_no between 1 and 16),
 user_id uuid not null references auth.users(id) on delete cascade,
 evaluator_id uuid not null references auth.users(id),
 score integer not null check(score between 0 and 3),
 note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(game_id,stage_no,user_id)
);
create table if not exists public.game_crises(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 stage_no integer not null default 15,
 crisis_type text not null,
 intensity text not null check(intensity in ('low','medium','high','ultra')),
 description text not null,
 effects jsonb not null default '{}'::jsonb,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);

alter table public.game_stages enable row level security;
alter table public.game_parties enable row level security;
alter table public.game_votes enable row level security;
alter table public.game_ballots enable row level security;
alter table public.game_evaluations enable row level security;
alter table public.game_crises enable row level security;

grant select on public.game_stages,public.game_parties,public.game_votes,public.game_ballots,public.game_evaluations,public.game_crises to authenticated;
grant insert,update,delete on public.game_stages,public.game_parties,public.game_votes,public.game_evaluations,public.game_crises to authenticated;
grant insert,update on public.game_ballots to authenticated;

drop policy if exists game_stages_read on public.game_stages;
create policy game_stages_read on public.game_stages for select to authenticated using(private.is_game_member(game_id));
drop policy if exists game_stages_teacher on public.game_stages;
create policy game_stages_teacher on public.game_stages for all to authenticated using(private.is_game_teacher(game_id)) with check(private.is_game_teacher(game_id));

drop policy if exists game_parties_read on public.game_parties;
create policy game_parties_read on public.game_parties for select to authenticated using(private.is_game_member(game_id));
drop policy if exists game_parties_teacher on public.game_parties;
create policy game_parties_teacher on public.game_parties for all to authenticated using(private.is_game_teacher(game_id)) with check(private.is_game_teacher(game_id));

drop policy if exists game_votes_read on public.game_votes;
create policy game_votes_read on public.game_votes for select to authenticated using(private.is_game_member(game_id));
drop policy if exists game_votes_teacher on public.game_votes;
create policy game_votes_teacher on public.game_votes for all to authenticated using(private.is_game_teacher(game_id)) with check(private.is_game_teacher(game_id));

drop policy if exists game_ballots_read on public.game_ballots;
create policy game_ballots_read on public.game_ballots for select to authenticated using(
 exists(select 1 from public.game_votes v where v.id=vote_id and private.is_game_member(v.game_id))
);
drop policy if exists game_ballots_insert on public.game_ballots;
create policy game_ballots_insert on public.game_ballots for insert to authenticated with check(
 voter_id=(select auth.uid()) and exists(select 1 from public.game_votes v where v.id=vote_id and v.status='open' and private.is_game_member(v.game_id))
);
drop policy if exists game_ballots_update on public.game_ballots;
create policy game_ballots_update on public.game_ballots for update to authenticated
 using(voter_id=(select auth.uid()))
 with check(voter_id=(select auth.uid()));

drop policy if exists game_evaluations_read on public.game_evaluations;
create policy game_evaluations_read on public.game_evaluations for select to authenticated using(private.is_game_member(game_id));
drop policy if exists game_evaluations_teacher on public.game_evaluations;
create policy game_evaluations_teacher on public.game_evaluations for all to authenticated using(private.is_game_teacher(game_id)) with check(private.is_game_teacher(game_id));

drop policy if exists game_crises_read on public.game_crises;
create policy game_crises_read on public.game_crises for select to authenticated using(private.is_game_member(game_id));
drop policy if exists game_crises_teacher on public.game_crises;
create policy game_crises_teacher on public.game_crises for all to authenticated using(private.is_game_teacher(game_id)) with check(private.is_game_teacher(game_id));

create index if not exists game_stages_game_idx on public.game_stages(game_id,stage_no);
create index if not exists game_parties_game_idx on public.game_parties(game_id);
create index if not exists game_votes_game_idx on public.game_votes(game_id,stage_no);
create index if not exists game_evaluations_game_user_idx on public.game_evaluations(game_id,user_id,stage_no);
create index if not exists game_crises_game_idx on public.game_crises(game_id,created_at desc);

do $$
declare t text;
begin
 foreach t in array array['game_members','chat_channels','channel_members','game_documents','game_stages','game_parties','game_votes','game_ballots','game_evaluations','game_crises'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;
