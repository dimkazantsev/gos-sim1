-- Multi-candidate State Duma leadership elections for stage 4.
-- Faction leaders may split their effective mandate weight across candidates.

create table if not exists public.office_elections(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null default 4,
  office_key text not null check(office_key in ('gd_chair','gd_deputy_1','gd_deputy_2')),
  office_title text not null,
  round_no integer not null default 1 check(round_no in (1,2)),
  vote_mode text not null default 'open' check(vote_mode in ('open','secret')),
  status text not null default 'nomination' check(status in ('nomination','open','closed','finished')),
  parent_election_id uuid references public.office_elections(id) on delete set null,
  winner_candidate_id uuid,
  created_by uuid not null references auth.users(id) on delete cascade,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.office_candidates(
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.office_elections(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  party_id uuid not null references public.game_parties(id) on delete cascade,
  nominated_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(election_id,user_id)
);

alter table public.office_elections
  add constraint office_elections_winner_fk
  foreign key(winner_candidate_id) references public.office_candidates(id) on delete set null;

create table if not exists public.office_ballots(
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.office_elections(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  party_id uuid not null references public.game_parties(id) on delete cascade,
  candidate_id uuid not null references public.office_candidates(id) on delete cascade,
  votes integer not null check(votes>=0),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique(election_id,party_id,candidate_id)
);

create index if not exists office_elections_game_idx on public.office_elections(game_id,stage_no,created_at);
create index if not exists office_candidates_election_idx on public.office_candidates(election_id);
create index if not exists office_ballots_election_idx on public.office_ballots(election_id,party_id);

alter table public.office_elections enable row level security;
alter table public.office_candidates enable row level security;
alter table public.office_ballots enable row level security;
revoke all privileges on table public.office_elections from anon,authenticated;
revoke all privileges on table public.office_candidates from anon,authenticated;
revoke all privileges on table public.office_ballots from anon,authenticated;
grant select on table public.office_elections to authenticated;
grant select on table public.office_candidates to authenticated;
grant select on table public.office_ballots to authenticated;

drop policy if exists office_elections_read on public.office_elections;
create policy office_elections_read on public.office_elections for select to authenticated
using(private.is_game_member(game_id));
drop policy if exists office_candidates_read on public.office_candidates;
create policy office_candidates_read on public.office_candidates for select to authenticated
using(private.is_game_member(game_id));
drop policy if exists office_ballots_read on public.office_ballots;
create policy office_ballots_read on public.office_ballots for select to authenticated
using(
  private.is_game_teacher(game_id)
  or exists(
    select 1 from public.office_elections e
    where e.id=election_id and (e.vote_mode='open' or e.status in ('closed','finished'))
  )
  or exists(
    select 1 from public.game_parties p
    where p.id=party_id and p.leader_user_id=(select auth.uid())
  )
);

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='office_elections')
 then alter publication supabase_realtime add table public.office_elections; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='office_candidates')
 then alter publication supabase_realtime add table public.office_candidates; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='office_ballots')
 then alter publication supabase_realtime add table public.office_ballots; end if;
end $$;

create or replace function public.create_office_election(
 p_game_id uuid,p_office_key text,p_vote_mode text default 'open'
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_title text;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
 if p_office_key not in ('gd_chair','gd_deputy_1','gd_deputy_2') then raise exception 'Unsupported office'; end if;
 if p_vote_mode not in ('open','secret') then raise exception 'Unsupported vote mode'; end if;
 if exists(select 1 from public.office_elections where game_id=p_game_id and office_key=p_office_key and status in ('nomination','open'))
 then raise exception 'An active election for this office already exists'; end if;
 v_title:=case p_office_key when 'gd_chair' then 'Председатель Государственной Думы'
   when 'gd_deputy_1' then 'Заместитель Председателя ГД №1'
   else 'Заместитель Председателя ГД №2' end;
 insert into public.office_elections(game_id,office_key,office_title,vote_mode,created_by)
 values(p_game_id,p_office_key,v_title,p_vote_mode,v_uid) returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.create_office_election(uuid,text,text) from public,anon;
grant execute on function public.create_office_election(uuid,text,text) to authenticated;

create or replace function public.nominate_office_candidate(p_election_id uuid,p_user_id uuid)
returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare e public.office_elections%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_id uuid;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if e.status<>'nomination' then raise exception 'Nomination is closed'; end if;
 v_party:=private.party_led_by(e.game_id,v_uid);
 if v_party is null and not private.is_game_teacher(e.game_id) then raise exception 'Faction leader access required'; end if;
 if private.is_game_teacher(e.game_id) then
   select p.id into v_party
   from public.game_members m join public.game_parties p on p.game_id=m.game_id and p.name=m.team
   where m.game_id=e.game_id and m.user_id=p_user_id limit 1;
 end if;
 if v_party is null then raise exception 'Candidate must belong to a faction'; end if;
 if not exists(
   select 1 from public.game_members m join public.game_parties p on p.game_id=m.game_id and p.name=m.team
   where m.game_id=e.game_id and m.user_id=p_user_id and p.id=v_party and m.kind='student'
 ) then raise exception 'Faction can nominate only its own member'; end if;
 insert into public.office_candidates(election_id,game_id,user_id,party_id,nominated_by)
 values(e.id,e.game_id,p_user_id,v_party,v_uid)
 on conflict(election_id,user_id) do nothing
 returning id into v_id;
 if v_id is null then select id into v_id from public.office_candidates where election_id=e.id and user_id=p_user_id; end if;
 return v_id;
end;
$$;
revoke all on function public.nominate_office_candidate(uuid,uuid) from public,anon;
grant execute on function public.nominate_office_candidate(uuid,uuid) to authenticated;

create or replace function public.open_office_election(p_election_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare e public.office_elections%rowtype;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if not private.is_game_teacher(e.game_id) then raise exception 'Teacher access required'; end if;
 if e.status<>'nomination' then raise exception 'Election cannot be opened'; end if;
 if (select count(*) from public.office_candidates where election_id=e.id)<1 then raise exception 'Nominate at least one candidate'; end if;
 update public.office_elections set status='open',opened_at=now() where id=e.id;
end;
$$;
revoke all on function public.open_office_election(uuid) from public,anon;
grant execute on function public.open_office_election(uuid) to authenticated;

create or replace function public.set_office_ballot(
 p_election_id uuid,p_candidate_id uuid,p_votes integer
) returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare e public.office_elections%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_capacity integer;v_other integer;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if e.status<>'open' then raise exception 'Election is not open'; end if;
 if p_votes<0 then raise exception 'Votes cannot be negative'; end if;
 if not exists(select 1 from public.office_candidates where id=p_candidate_id and election_id=e.id)
 then raise exception 'Candidate not found in this election'; end if;

 v_party:=private.party_led_by(e.game_id,v_uid);
 if v_party is null then raise exception 'Only faction leaders submit faction ballots'; end if;
 select coalesce(sum(effective_mandates),0)::integer into v_capacity
 from public.party_member_mandates where game_id=e.game_id and party_id=v_party;
 select coalesce(sum(votes),0)::integer into v_other
 from public.office_ballots where election_id=e.id and party_id=v_party and candidate_id<>p_candidate_id;
 if v_other+p_votes>v_capacity then raise exception 'Faction ballot exceeds current effective mandates'; end if;

 insert into public.office_ballots(election_id,game_id,party_id,candidate_id,votes,submitted_by)
 values(e.id,e.game_id,v_party,p_candidate_id,p_votes,v_uid)
 on conflict(election_id,party_id,candidate_id)
 do update set votes=excluded.votes,submitted_by=v_uid,updated_at=now();
end;
$$;
revoke all on function public.set_office_ballot(uuid,uuid,integer) from public,anon;
grant execute on function public.set_office_ballot(uuid,uuid,integer) to authenticated;

create or replace function public.close_office_election(p_election_id uuid)
returns jsonb
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare e public.office_elections%rowtype;winner record;c_count integer;v_runoff uuid;out_json jsonb;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if not private.is_game_teacher(e.game_id) then raise exception 'Teacher access required'; end if;
 if e.status<>'open' then raise exception 'Election is not open'; end if;

 select c.id,c.user_id,coalesce(sum(b.votes),0)::integer votes
 into winner
 from public.office_candidates c left join public.office_ballots b on b.candidate_id=c.id and b.election_id=e.id
 where c.election_id=e.id
 group by c.id,c.user_id
 order by votes desc,c.created_at
 limit 1;
 select count(*)::integer into c_count from public.office_candidates where election_id=e.id;

 update public.office_elections set status='closed',closed_at=now() where id=e.id;

 if winner.id is not null and winner.votes>225 then
  update public.office_elections set status='finished',winner_candidate_id=winner.id where id=e.id;
  out_json:=jsonb_build_object('status','finished','winner_candidate_id',winner.id,'winner_user_id',winner.user_id,'votes',winner.votes);
  return out_json;
 end if;

 if e.round_no=1 and c_count>2 then
  insert into public.office_elections(game_id,stage_no,office_key,office_title,round_no,vote_mode,status,parent_election_id,created_by)
  values(e.game_id,e.stage_no,e.office_key,e.office_title,2,e.vote_mode,'nomination',e.id,(select auth.uid()))
  returning id into v_runoff;

  insert into public.office_candidates(election_id,game_id,user_id,party_id,nominated_by)
  select v_runoff,e.game_id,c.user_id,c.party_id,(select auth.uid())
  from public.office_candidates c
  left join public.office_ballots b on b.candidate_id=c.id and b.election_id=e.id
  where c.election_id=e.id
  group by c.id,c.user_id,c.party_id
  order by coalesce(sum(b.votes),0) desc,c.created_at
  limit 2;

  update public.office_elections set status='open',opened_at=now() where id=v_runoff;
  out_json:=jsonb_build_object('status','runoff','runoff_election_id',v_runoff);
 else
  out_json:=jsonb_build_object('status','no_winner','leader_candidate_id',winner.id,'leader_votes',coalesce(winner.votes,0));
 end if;
 return out_json;
end;
$$;
revoke all on function public.close_office_election(uuid) from public,anon;
grant execute on function public.close_office_election(uuid) to authenticated;
