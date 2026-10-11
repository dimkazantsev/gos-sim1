-- Event routing: 330-case approved review matrix, stage/competence and 89 fixed party territories.
create table if not exists public.event_case_routing(
 game_id uuid not null references public.games(id) on delete cascade,
 case_id uuid not null references public.event_cases(id) on delete cascade,
 earliest_stage integer not null check(earliest_stage between 1 and 16),
 latest_stage integer not null default 15 check(latest_stage between 1 and 16),
 region_code text references public.fiscal_region_reference(code),
 destination text not null check(destination in ('individual','regional','regional_joint','federal_collective','federal_joint')),
 requires_office boolean not null default true,
 primary key(game_id,case_id),
 check(earliest_stage<=latest_stage)
);
create table if not exists public.game_region_party_control(
 game_id uuid not null references public.games(id) on delete cascade,
 region_code text not null references public.fiscal_region_reference(code),
 party_id uuid not null references public.game_parties(id) on delete cascade,
 election_rule_id uuid not null references public.regional_election_rules(id) on delete cascade,
 fixed_at timestamptz not null default now(),
 primary key(game_id,region_code)
);
create index if not exists event_case_routing_destination_idx on public.event_case_routing(game_id,earliest_stage,destination);
create index if not exists game_region_party_control_party_idx on public.game_region_party_control(game_id,party_id);
alter table public.event_case_routing enable row level security;
alter table public.game_region_party_control enable row level security;
create policy event_route_game_read on public.event_case_routing for select to authenticated using(private.is_game_member(game_id));
create policy regional_control_game_read on public.game_region_party_control for select to authenticated using(private.is_game_member(game_id));
revoke insert,update,delete on public.event_case_routing,public.game_region_party_control from authenticated,anon;
-- Regional allocations are immutable after publication. Deterministic mapping uses every region exactly once.
create or replace function private.freeze_region_party_control(p_rule uuid)
returns integer language plpgsql security definer set search_path='public','private','pg_temp' as $$
declare g uuid; n int; total int;
begin
 select game_id into g from public.regional_election_rules where id=p_rule and status='allocated';
 if g is null then raise exception 'Regional election has not been finalized';end if;
 perform pg_advisory_xact_lock(hashtext(g::text),309);
 select count(*) into n from public.game_region_party_control where game_id=g;
 if n=89 then return 89;end if;
 if n>0 then raise exception 'Incomplete region allocation; manual review required';end if;
 select coalesce(sum(regions),0) into total from public.regional_allocations where rule_id=p_rule;
 if total<>89 then raise exception 'Regional quotas do not total 89';end if;
 insert into public.game_region_party_control(game_id,region_code,party_id,election_rule_id)
 with ranked_regions as(
  select code,row_number() over(order by md5(p_rule::text||':'||code),code) rn
  from public.fiscal_region_reference
 ), party_spans as(
  select party_id,coalesce(sum(regions) over(order by party_id rows between unbounded preceding and 1 preceding),0)+1 first_rn,
         sum(regions) over(order by party_id) last_rn
  from public.regional_allocations where rule_id=p_rule and regions>0
 )
 select g,r.code,p.party_id,p_rule from ranked_regions r
 join party_spans p on r.rn between p.first_rn and p.last_rn;
 get diagnostics n=row_count;
 if n<>89 then raise exception 'Failed to assign all 89 regions';end if;
 return n;
end $$;
create or replace function private.sync_region_control_after_allocation()
returns trigger language plpgsql security definer set search_path='public','private','pg_temp' as $$
begin
 if new.status='allocated' and old.status is distinct from new.status then
  perform private.freeze_region_party_control(new.id);
 end if;
 return new;
end $$;
drop trigger if exists after_regional_election_allocation_freeze on public.regional_election_rules;
create trigger after_regional_election_allocation_freeze after update of status on public.regional_election_rules
for each row execute function private.sync_region_control_after_allocation();
