drop table if exists public.presidential_teacher_jury_votes cascade;

create table public.presidential_teacher_jury_scores(
 game_id uuid not null references public.games(id) on delete cascade,
 candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
 slot_no integer not null check(slot_no between 1 and 8),
 criterion text not null check(criterion in ('program','campaign')),
 score numeric(5,2) not null check(score between 0 and 100),
 updated_by uuid,
 updated_at timestamptz not null default now(),
 primary key(game_id,candidate_id,slot_no,criterion)
);

create index presidential_teacher_jury_scores_game_idx
on public.presidential_teacher_jury_scores(game_id,criterion,candidate_id);

alter table public.presidential_teacher_jury_scores enable row level security;
create policy presidential_teacher_jury_scores_read
on public.presidential_teacher_jury_scores for select to authenticated
using(private.is_game_teacher(game_id));

revoke all on public.presidential_teacher_jury_scores from public,anon,authenticated;
grant select on public.presidential_teacher_jury_scores to authenticated;

create or replace function private.recompute_presidential_jury_scores(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 s public.presidential_election_settings%rowtype;
 c record;
 v_program_pct numeric;
 v_campaign_pct numeric;
 v_rating numeric;
 v_poll numeric;
 v_score numeric;
 v_den numeric;
 v_modifier numeric;
begin
 select * into s from public.presidential_election_settings where game_id=p_game_id;

 for c in
  select id,party_id,rating_penalty
  from public.presidential_candidates
  where game_id=p_game_id and archived_at is null and registration_status='registered'
 loop
  select round(avg(score),2) into v_program_pct
  from public.presidential_teacher_jury_scores
  where game_id=p_game_id and candidate_id=c.id and criterion='program';

  select round(avg(score),2) into v_campaign_pct
  from public.presidential_teacher_jury_scores
  where game_id=p_game_id and candidate_id=c.id and criterion='campaign';

  insert into public.presidential_scorecards(
   game_id,candidate_id,round_no,teacher_program_pct,teacher_campaign_pct,updated_by
  )
  values(p_game_id,c.id,1,v_program_pct,v_campaign_pct,auth.uid())
  on conflict(candidate_id,round_no) do update
  set teacher_program_pct=excluded.teacher_program_pct,
      teacher_campaign_pct=excluded.teacher_campaign_pct,
      updated_at=now(),
      updated_by=auth.uid();

  select game_rating_pct,poll_pct into v_rating,v_poll
  from public.presidential_scorecards
  where candidate_id=c.id and round_no=1;

  if s.game_id is not null
     and v_program_pct is not null
     and v_campaign_pct is not null
     and v_rating is not null
     and (not s.poll_enabled or v_poll is not null)
  then
   v_den:=case when s.poll_enabled then 4 else 3 end;
   select coalesce(presidential_rating_modifier,0) into v_modifier
   from public.game_parties where id=c.party_id and game_id=p_game_id;
   v_score:=(v_program_pct+v_campaign_pct+v_rating+
     case when s.poll_enabled then v_poll else 0 end)/v_den;
   v_score:=greatest(0,least(100,v_score-coalesce(c.rating_penalty,0)+coalesce(v_modifier,0)));
   update public.presidential_scorecards
   set computed_pct=round(v_score,2),updated_at=now()
   where candidate_id=c.id and round_no=1;
  else
   update public.presidential_scorecards
   set computed_pct=null,updated_at=now()
   where candidate_id=c.id and round_no=1;
  end if;
 end loop;
end;
$$;

create or replace function public.set_presidential_teacher_jury_score(
 p_game_id uuid,
 p_candidate_id uuid,
 p_slot_no integer,
 p_criterion text,
 p_score numeric default null
)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 v_uid uuid:=(select auth.uid());
 v_candidate public.presidential_candidates%rowtype;
begin
 if v_uid is null or not private.is_game_teacher(p_game_id)
 then raise exception 'Teacher access required'; end if;
 if p_slot_no not between 1 and 8 then raise exception 'Teacher slot must be 1-8'; end if;
 if p_criterion not in ('program','campaign') then raise exception 'Unsupported jury criterion'; end if;

 select * into v_candidate from public.presidential_candidates where id=p_candidate_id;
 if v_candidate.id is null or v_candidate.game_id<>p_game_id then raise exception 'Candidate not found in this game'; end if;
 if v_candidate.registration_status<>'registered' then raise exception 'Only registered candidates can be scored'; end if;

 if p_score is null then
  delete from public.presidential_teacher_jury_scores
  where game_id=p_game_id and candidate_id=p_candidate_id and slot_no=p_slot_no and criterion=p_criterion;
 else
  if p_score<0 or p_score>100 then raise exception 'Score must be between 0 and 100'; end if;
  insert into public.presidential_teacher_jury_scores(game_id,candidate_id,slot_no,criterion,score,updated_by)
  values(p_game_id,p_candidate_id,p_slot_no,p_criterion,round(p_score,2),v_uid)
  on conflict(game_id,candidate_id,slot_no,criterion) do update
  set score=excluded.score,updated_by=v_uid,updated_at=now();
 end if;

 perform private.recompute_presidential_jury_scores(p_game_id);
end;
$$;

revoke all on function public.set_presidential_teacher_jury_score(uuid,uuid,integer,text,numeric) from public,anon;
grant execute on function public.set_presidential_teacher_jury_score(uuid,uuid,integer,text,numeric) to authenticated;
