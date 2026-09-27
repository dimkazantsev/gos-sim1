-- Binding inter-faction agreements for the pre-parliamentary game phase.
-- Author game rule: before Parliament is formed, faction agreements cannot be broken.

create table if not exists public.party_agreements(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  proposer_party_id uuid not null references public.game_parties(id) on delete cascade,
  counterparty_party_id uuid not null references public.game_parties(id) on delete cascade,
  title text not null,
  terms text not null,
  target_vote_id uuid references public.game_votes(id) on delete set null,
  proposer_choice text check(proposer_choice in ('yes','no') or proposer_choice is null),
  counterparty_choice text check(counterparty_choice in ('yes','no') or counterparty_choice is null),
  status text not null default 'proposed'
    check(status in ('proposed','accepted','rejected','fulfilled','expired')),
  created_by uuid not null references auth.users(id) on delete cascade,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  resolved_at timestamptz,
  check(proposer_party_id<>counterparty_party_id),
  check(length(trim(title))>=3),
  check(length(trim(terms))>=10)
);

create index if not exists party_agreements_game_status_idx
  on public.party_agreements(game_id,status,created_at desc);
create index if not exists party_agreements_vote_idx
  on public.party_agreements(target_vote_id,status);

alter table public.party_agreements enable row level security;
revoke all privileges on table public.party_agreements from anon,authenticated;
grant select on table public.party_agreements to authenticated;

drop policy if exists party_agreements_read on public.party_agreements;
create policy party_agreements_read on public.party_agreements
for select to authenticated
using(private.is_game_member(game_id));

do $$
begin
 if not exists(
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='party_agreements'
 ) then
   alter publication supabase_realtime add table public.party_agreements;
 end if;
end $$;

create or replace function private.party_led_by(p_game uuid,p_user uuid)
returns uuid
language sql stable security definer
set search_path=public,private,pg_temp
as $$
 select id from public.game_parties
 where game_id=p_game and leader_user_id=p_user
 limit 1;
$$;
revoke execute on function private.party_led_by(uuid,uuid) from public,anon,authenticated;

create or replace function public.propose_party_agreement(
 p_game_id uuid,
 p_counterparty_party_id uuid,
 p_title text,
 p_terms text,
 p_target_vote_id uuid default null,
 p_proposer_choice text default null,
 p_counterparty_choice text default null
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
 v_uid uuid:=(select auth.uid());
 v_party uuid;
 v_stage integer;
 v_id uuid;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 v_party:=private.party_led_by(p_game_id,v_uid);
 if v_party is null and not private.is_game_teacher(p_game_id) then raise exception 'Party leader access required'; end if;

 if private.is_game_teacher(p_game_id) then
   raise exception 'Teacher does not propose agreements on behalf of factions';
 end if;

 select stage_no into v_stage
 from public.game_stages
 where game_id=p_game_id and status='open'
 order by stage_no desc limit 1;

 if coalesce(v_stage,1)>=4 then
   raise exception 'Binding faction agreements apply only before Parliament is formed';
 end if;

 if p_counterparty_party_id=v_party or not exists(
   select 1 from public.game_parties where id=p_counterparty_party_id and game_id=p_game_id
 ) then raise exception 'Counterparty party not found'; end if;

 if length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_terms,'')))<10 then
   raise exception 'Agreement title and terms are required';
 end if;
 if p_proposer_choice is not null and p_proposer_choice not in ('yes','no') then raise exception 'Unsupported proposer choice'; end if;
 if p_counterparty_choice is not null and p_counterparty_choice not in ('yes','no') then raise exception 'Unsupported counterparty choice'; end if;

 if p_target_vote_id is not null and not exists(
   select 1 from public.game_votes
   where id=p_target_vote_id and game_id=p_game_id and stage_no<4 and voting_mode='faction'
 ) then raise exception 'Binding agreement can target only a pre-parliamentary faction vote'; end if;

 insert into public.party_agreements(
   game_id,proposer_party_id,counterparty_party_id,title,terms,target_vote_id,
   proposer_choice,counterparty_choice,created_by
 ) values(
   p_game_id,v_party,p_counterparty_party_id,trim(p_title),trim(p_terms),p_target_vote_id,
   p_proposer_choice,p_counterparty_choice,v_uid
 ) returning id into v_id;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,coalesce(v_stage,1),'Переговоры','notice','Предложено межфракционное соглашение',trim(p_title),v_uid);

 return v_id;
end;
$$;
revoke all on function public.propose_party_agreement(uuid,uuid,text,text,uuid,text,text) from public,anon;
grant execute on function public.propose_party_agreement(uuid,uuid,text,text,uuid,text,text) to authenticated;

create or replace function public.respond_party_agreement(
 p_agreement_id uuid,
 p_accept boolean
) returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
 v_uid uuid:=(select auth.uid());
 a public.party_agreements%rowtype;
begin
 select * into a from public.party_agreements where id=p_agreement_id for update;
 if a.id is null then raise exception 'Agreement not found'; end if;
 if a.status<>'proposed' then raise exception 'Agreement is already resolved'; end if;
 if not exists(
   select 1 from public.game_parties
   where id=a.counterparty_party_id and leader_user_id=v_uid
 ) then raise exception 'Counterparty leader access required'; end if;

 if p_accept then
   update public.party_agreements
      set status='accepted',accepted_by=v_uid,accepted_at=now()
    where id=a.id;
   insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
   select a.game_id,coalesce((select max(stage_no) from public.game_stages where game_id=a.game_id and status='open'),1),
     'Переговоры','notice','Межфракционное соглашение принято',a.title,v_uid;
 else
   update public.party_agreements
      set status='rejected',accepted_by=v_uid,resolved_at=now()
    where id=a.id;
 end if;
end;
$$;
revoke all on function public.respond_party_agreement(uuid,boolean) from public,anon;
grant execute on function public.respond_party_agreement(uuid,boolean) to authenticated;

-- Enforce accepted promises on faction ballots in stages 1-3.
create or replace function public.cast_procedural_vote(p_vote_id uuid,p_choice text)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_uid uuid:=(select auth.uid());
  v public.game_votes%rowtype;
  v_weight numeric;
  v_party uuid;
  v_expected text;
  v_choices integer;
begin
  select * into v from public.game_votes where id=p_vote_id for update;
  if v.id is null then raise exception 'Vote not found'; end if;
  if v.status<>'open' then raise exception 'Vote is closed'; end if;
  if p_choice not in ('yes','no','abstain') then raise exception 'Unsupported choice'; end if;
  if p_choice='abstain' and not v.allow_abstain then raise exception 'Abstention is not allowed'; end if;
  if v_uid is null or not private.is_game_member(v.game_id) then raise exception 'Game access required'; end if;

  v_weight:=private.vote_eligible_weight(v,v_uid);
  if v_weight<=0 then raise exception 'You are not eligible to vote in this procedure'; end if;

  if v.voting_mode='faction' and v.stage_no<4 then
    v_party:=private.party_led_by(v.game_id,v_uid);
    if v_party is not null then
      with obligations as (
        select case
          when proposer_party_id=v_party then proposer_choice
          when counterparty_party_id=v_party then counterparty_choice
        end as choice
        from public.party_agreements
        where game_id=v.game_id
          and target_vote_id=v.id
          and status='accepted'
          and (proposer_party_id=v_party or counterparty_party_id=v_party)
      )
      select min(choice),count(distinct choice)
        into v_expected,v_choices
      from obligations
      where choice is not null;

      if v_choices>1 then
        raise exception 'Faction has conflicting binding agreements for this vote; teacher intervention required';
      end if;
      if v_expected is not null and p_choice<>v_expected then
        raise exception 'This vote contradicts an accepted binding faction agreement';
      end if;
    end if;
  end if;

  insert into public.game_ballots(vote_id,voter_id,choice,weight)
  values(v.id,v_uid,p_choice,v_weight)
  on conflict(vote_id,voter_id)
  do update set choice=excluded.choice,weight=excluded.weight,created_at=now();
end;
$$;
revoke all on function public.cast_procedural_vote(uuid,text) from public,anon;
grant execute on function public.cast_procedural_vote(uuid,text) to authenticated;

create or replace function private.resolve_party_agreements_for_vote(p_vote uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
 update public.party_agreements a
 set status='fulfilled',resolved_at=now()
 where a.target_vote_id=p_vote
   and a.status='accepted'
   and not exists(
     select 1
     from (
       select a.proposer_party_id party_id,a.proposer_choice expected
       union all
       select a.counterparty_party_id,a.counterparty_choice
     ) x
     where x.expected is not null
       and not exists(
         select 1
         from public.game_parties p
         join public.game_ballots b on b.voter_id=p.leader_user_id and b.vote_id=p_vote
         where p.id=x.party_id and b.choice=x.expected
       )
   );
end;
$$;
revoke execute on function private.resolve_party_agreements_for_vote(uuid) from public,anon,authenticated;
