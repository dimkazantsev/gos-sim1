-- Presidential election laboratory for stages 6-7.
-- The score formula follows the author's game rules and keeps every input auditable.

create table if not exists public.presidential_election_settings(
  game_id uuid primary key references public.games(id) on delete cascade,
  system_type text not null default 'absolute'
    check(system_type in ('relative','absolute','qualified','preferential')),
  threshold_pct numeric not null default 50 check(threshold_pct>=0 and threshold_pct<=100),
  poll_enabled boolean not null default true,
  status text not null default 'setup'
    check(status in ('setup','round1','runoff','finished','manual_required')),
  result jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.presidential_candidates(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  party_id uuid references public.game_parties(id) on delete set null,
  display_name text not null,
  nomination_type text not null default 'party' check(nomination_type in ('party','self','fictional')),
  registration_status text not null default 'submitted'
    check(registration_status in ('submitted','registered','revision','rejected','withdrawn')),
  program_summary text,
  registration_attempts integer not null default 1 check(registration_attempts>=1),
  legal_error_count integer not null default 0 check(legal_error_count>=0),
  rating_penalty numeric not null default 0 check(rating_penalty>=0 and rating_penalty<=100),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.presidential_scorecards(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
  round_no integer not null check(round_no in (1,2)),
  teacher_program_pct numeric,
  teacher_campaign_pct numeric,
  game_rating_pct numeric,
  poll_pct numeric,
  teacher_runoff_pct numeric,
  computed_pct numeric,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(candidate_id,round_no),
  check(teacher_program_pct is null or teacher_program_pct between 0 and 100),
  check(teacher_campaign_pct is null or teacher_campaign_pct between 0 and 100),
  check(game_rating_pct is null or game_rating_pct between 0 and 100),
  check(poll_pct is null or poll_pct between 0 and 100),
  check(teacher_runoff_pct is null or teacher_runoff_pct between 0 and 100),
  check(computed_pct is null or computed_pct between 0 and 100)
);

create index if not exists presidential_candidates_game_idx on public.presidential_candidates(game_id,created_at);
create index if not exists presidential_scorecards_game_round_idx on public.presidential_scorecards(game_id,round_no,computed_pct desc);

alter table public.presidential_election_settings enable row level security;
alter table public.presidential_candidates enable row level security;
alter table public.presidential_scorecards enable row level security;
revoke all privileges on table public.presidential_election_settings from anon,authenticated;
revoke all privileges on table public.presidential_candidates from anon,authenticated;
revoke all privileges on table public.presidential_scorecards from anon,authenticated;
grant select on table public.presidential_election_settings to authenticated;
grant select on table public.presidential_candidates to authenticated;
grant select on table public.presidential_scorecards to authenticated;

drop policy if exists presidential_settings_read on public.presidential_election_settings;
create policy presidential_settings_read on public.presidential_election_settings for select to authenticated
using(private.is_game_member(game_id));
drop policy if exists presidential_candidates_read on public.presidential_candidates;
create policy presidential_candidates_read on public.presidential_candidates for select to authenticated
using(private.is_game_member(game_id));
drop policy if exists presidential_scorecards_read on public.presidential_scorecards;
create policy presidential_scorecards_read on public.presidential_scorecards for select to authenticated
using(private.is_game_member(game_id));

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_election_settings')
 then alter publication supabase_realtime add table public.presidential_election_settings; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_candidates')
 then alter publication supabase_realtime add table public.presidential_candidates; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_scorecards')
 then alter publication supabase_realtime add table public.presidential_scorecards; end if;
end $$;

create or replace function public.configure_presidential_election(
 p_game_id uuid,p_system_type text,p_threshold_pct numeric,p_poll_enabled boolean
) returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
 if p_system_type not in ('relative','absolute','qualified','preferential') then raise exception 'Unsupported election system'; end if;
 if p_threshold_pct<0 or p_threshold_pct>100 then raise exception 'Threshold must be 0-100'; end if;
 insert into public.presidential_election_settings(game_id,system_type,threshold_pct,poll_enabled,updated_by)
 values(p_game_id,p_system_type,p_threshold_pct,p_poll_enabled,v_uid)
 on conflict(game_id) do update set system_type=excluded.system_type,threshold_pct=excluded.threshold_pct,
   poll_enabled=excluded.poll_enabled,updated_at=now(),updated_by=v_uid,
   status=case when presidential_election_settings.status='finished' then 'setup' else presidential_election_settings.status end,
   result='{}'::jsonb;
end;
$$;
revoke all on function public.configure_presidential_election(uuid,text,numeric,boolean) from public,anon;
grant execute on function public.configure_presidential_election(uuid,text,numeric,boolean) to authenticated;

create or replace function public.save_presidential_candidate(
 p_game_id uuid,p_candidate_id uuid,p_user_id uuid,p_party_id uuid,p_display_name text,
 p_nomination_type text,p_program_summary text
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_is_teacher boolean:=private.is_game_teacher(p_game_id);
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_nomination_type not in ('party','self','fictional') then raise exception 'Unsupported nomination type'; end if;
 if length(trim(coalesce(p_display_name,'')))<3 then raise exception 'Candidate name is required'; end if;

 if not v_is_teacher then
  if p_nomination_type='self' then
   if p_user_id<>v_uid then raise exception 'Self-nomination is available only for yourself'; end if;
  elsif p_nomination_type='party' then
   if p_party_id is null or not exists(select 1 from public.game_parties where id=p_party_id and game_id=p_game_id and leader_user_id=v_uid)
     then raise exception 'Party leader access required'; end if;
   if p_user_id is null or not exists(select 1 from public.game_members m join public.game_parties p on p.game_id=m.game_id and p.name=m.team
       where m.game_id=p_game_id and m.user_id=p_user_id and p.id=p_party_id)
     then raise exception 'Party candidate must be a member of that party'; end if;
  else
   raise exception 'Only teacher can create a fictional candidate';
  end if;
 end if;

 if p_candidate_id is null then
  if p_nomination_type='party' and exists(
    select 1 from public.presidential_candidates
    where game_id=p_game_id and party_id=p_party_id and nomination_type='party'
      and registration_status not in ('rejected','withdrawn')
  ) then raise exception 'A party can have only one active presidential candidate'; end if;

  insert into public.presidential_candidates(game_id,user_id,party_id,display_name,nomination_type,program_summary,created_by)
  values(p_game_id,p_user_id,p_party_id,trim(p_display_name),p_nomination_type,nullif(trim(coalesce(p_program_summary,'')),''),v_uid)
  returning id into v_id;
 else
  if not v_is_teacher and not exists(select 1 from public.presidential_candidates where id=p_candidate_id and game_id=p_game_id and created_by=v_uid)
    then raise exception 'Candidate editing is not available'; end if;
  update public.presidential_candidates set display_name=trim(p_display_name),program_summary=nullif(trim(coalesce(p_program_summary,'')),''),
    updated_at=now() where id=p_candidate_id and game_id=p_game_id returning id into v_id;
 end if;
 return v_id;
end;
$$;
revoke all on function public.save_presidential_candidate(uuid,uuid,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.save_presidential_candidate(uuid,uuid,uuid,uuid,text,text,text) to authenticated;

create or replace function public.review_presidential_candidate(
 p_candidate_id uuid,p_status text,p_legal_errors integer,p_rating_penalty numeric
) returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare c public.presidential_candidates%rowtype;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id for update;
 if c.id is null then raise exception 'Candidate not found'; end if;
 if not private.is_game_teacher(c.game_id) then raise exception 'Teacher access required'; end if;
 if p_status not in ('submitted','registered','revision','rejected','withdrawn') then raise exception 'Unsupported registration status'; end if;
 if p_legal_errors<0 then raise exception 'Legal error count cannot be negative'; end if;
 if p_rating_penalty<0 or p_rating_penalty>100 then raise exception 'Penalty must be 0-100'; end if;
 update public.presidential_candidates
 set registration_status=p_status,legal_error_count=p_legal_errors,rating_penalty=p_rating_penalty,
     registration_attempts=registration_attempts+case when p_status='revision' then 1 else 0 end,updated_at=now()
 where id=c.id;
end;
$$;
revoke all on function public.review_presidential_candidate(uuid,text,integer,numeric) from public,anon;
grant execute on function public.review_presidential_candidate(uuid,text,integer,numeric) to authenticated;

create or replace function public.set_presidential_scorecard(
 p_candidate_id uuid,p_round_no integer,p_teacher_program_pct numeric,p_teacher_campaign_pct numeric,
 p_game_rating_pct numeric,p_poll_pct numeric,p_teacher_runoff_pct numeric
) returns numeric
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare c public.presidential_candidates%rowtype;s public.presidential_election_settings%rowtype;
 v_uid uuid:=(select auth.uid());v_score numeric;v_den numeric;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;
 if c.id is null then raise exception 'Candidate not found'; end if;
 if not private.is_game_teacher(c.game_id) then raise exception 'Teacher access required'; end if;
 if c.registration_status<>'registered' then raise exception 'Only registered candidates can be scored'; end if;
 if p_round_no not in (1,2) then raise exception 'Round must be 1 or 2'; end if;
 insert into public.presidential_election_settings(game_id,updated_by) values(c.game_id,v_uid)
 on conflict(game_id) do nothing;
 select * into s from public.presidential_election_settings where game_id=c.game_id;

 if p_round_no=1 then
  if p_teacher_program_pct is null or p_teacher_campaign_pct is null or p_game_rating_pct is null then
   raise exception 'Program, campaign and game rating percentages are required';
  end if;
  if s.poll_enabled and p_poll_pct is null then raise exception 'Poll percentage is required while poll component is enabled'; end if;
  v_den:=case when s.poll_enabled then 4 else 3 end;
  v_score:=(p_teacher_program_pct+p_teacher_campaign_pct+p_game_rating_pct+
    case when s.poll_enabled then p_poll_pct else 0 end)/v_den;
  v_score:=greatest(0,least(100,v_score-c.rating_penalty));
 else
  if p_teacher_runoff_pct is null then raise exception 'Runoff teacher vote percentage is required'; end if;
  select computed_pct into v_score from public.presidential_scorecards where candidate_id=c.id and round_no=1;
  if v_score is null then raise exception 'Round 1 score is required'; end if;
  v_score:=(v_score+p_teacher_runoff_pct)/2;
 end if;

 insert into public.presidential_scorecards(
  game_id,candidate_id,round_no,teacher_program_pct,teacher_campaign_pct,game_rating_pct,poll_pct,teacher_runoff_pct,computed_pct,updated_by
 ) values(c.game_id,c.id,p_round_no,p_teacher_program_pct,p_teacher_campaign_pct,p_game_rating_pct,p_poll_pct,p_teacher_runoff_pct,round(v_score,2),v_uid)
 on conflict(candidate_id,round_no) do update set teacher_program_pct=excluded.teacher_program_pct,
  teacher_campaign_pct=excluded.teacher_campaign_pct,game_rating_pct=excluded.game_rating_pct,poll_pct=excluded.poll_pct,
  teacher_runoff_pct=excluded.teacher_runoff_pct,computed_pct=excluded.computed_pct,updated_at=now(),updated_by=v_uid;

 return round(v_score,2);
end;
$$;
revoke all on function public.set_presidential_scorecard(uuid,integer,numeric,numeric,numeric,numeric,numeric) from public,anon;
grant execute on function public.set_presidential_scorecard(uuid,integer,numeric,numeric,numeric,numeric,numeric) to authenticated;

create or replace function public.finalize_presidential_round(p_game_id uuid,p_round_no integer)
returns jsonb
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare s public.presidential_election_settings%rowtype;top1 record;top2 record;out_json jsonb;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
 select * into s from public.presidential_election_settings where game_id=p_game_id for update;
 if s.game_id is null then raise exception 'Election settings are not configured'; end if;

 if p_round_no=1 then
  select c.id,c.display_name,sc.computed_pct into top1
   from public.presidential_candidates c join public.presidential_scorecards sc on sc.candidate_id=c.id and sc.round_no=1
   where c.game_id=p_game_id and c.registration_status='registered'
   order by sc.computed_pct desc,c.display_name limit 1;
  select c.id,c.display_name,sc.computed_pct into top2
   from public.presidential_candidates c join public.presidential_scorecards sc on sc.candidate_id=c.id and sc.round_no=1
   where c.game_id=p_game_id and c.registration_status='registered' and c.id<>top1.id
   order by sc.computed_pct desc,c.display_name limit 1;
  if top1.id is null then raise exception 'No scored registered candidates'; end if;

  if s.system_type='preferential' then
   out_json:=jsonb_build_object('round',1,'status','manual_required','reason','Preferential counting is not defined by the game formula','leader_id',top1.id,'leader',top1.display_name,'score',top1.computed_pct);
   update public.presidential_election_settings set status='manual_required',result=out_json,updated_at=now() where game_id=p_game_id;
  elsif s.system_type='relative' or
        (s.system_type='absolute' and top1.computed_pct>50) or
        (s.system_type='qualified' and top1.computed_pct>=s.threshold_pct) then
   out_json:=jsonb_build_object('round',1,'status','finished','winner_id',top1.id,'winner',top1.display_name,'score',top1.computed_pct);
   update public.presidential_election_settings set status='finished',result=out_json,updated_at=now() where game_id=p_game_id;
  else
   if top2.id is null then raise exception 'At least two scored candidates are required for runoff'; end if;
   out_json:=jsonb_build_object('round',1,'status','runoff','candidate_ids',jsonb_build_array(top1.id,top2.id),
      'leaders',jsonb_build_array(jsonb_build_object('id',top1.id,'name',top1.display_name,'score',top1.computed_pct),
                                  jsonb_build_object('id',top2.id,'name',top2.display_name,'score',top2.computed_pct)));
   update public.presidential_election_settings set status='runoff',result=out_json,updated_at=now() where game_id=p_game_id;
  end if;
 else
  if s.status<>'runoff' then raise exception 'Election is not in runoff state'; end if;
  select c.id,c.display_name,sc.computed_pct into top1
   from public.presidential_candidates c join public.presidential_scorecards sc on sc.candidate_id=c.id and sc.round_no=2
   where c.game_id=p_game_id and c.registration_status='registered'
     and c.id in (select jsonb_array_elements_text(s.result->'candidate_ids')::uuid)
   order by sc.computed_pct desc,c.display_name limit 1;
  if top1.id is null then raise exception 'Runoff scorecards are incomplete'; end if;
  out_json:=jsonb_build_object('round',2,'status','finished','winner_id',top1.id,'winner',top1.display_name,'score',top1.computed_pct);
  update public.presidential_election_settings set status='finished',result=out_json,updated_at=now() where game_id=p_game_id;
 end if;

 return out_json;
end;
$$;
revoke all on function public.finalize_presidential_round(uuid,integer) from public,anon;
grant execute on function public.finalize_presidential_round(uuid,integer) to authenticated;
