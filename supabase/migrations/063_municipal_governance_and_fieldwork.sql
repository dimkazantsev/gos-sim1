-- Stage 14: secret mayor election, five district administrations, district teams and fieldwork thresholds.
create table if not exists public.municipal_mayor_elections(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 status text not null default 'nomination' check(status in ('nomination','open','finished','tie')),
 winner_user_id uuid references auth.users(id) on delete set null,created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),opened_at timestamptz,closed_at timestamptz
);
create table if not exists public.municipal_mayor_candidates(
 id uuid primary key default gen_random_uuid(),election_id uuid not null references public.municipal_mayor_elections(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 nominated_by uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now(),unique(election_id,user_id)
);
create table if not exists public.municipal_mayor_ballots(
 id uuid primary key default gen_random_uuid(),election_id uuid not null references public.municipal_mayor_elections(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,voter_user_id uuid not null references auth.users(id) on delete cascade,
 candidate_id uuid not null references public.municipal_mayor_candidates(id) on delete cascade,created_at timestamptz not null default now(),unique(election_id,voter_user_id)
);
create table if not exists public.municipal_districts(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 district_key text not null,title text not null,head_user_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),unique(game_id,district_key)
);
create table if not exists public.municipal_district_members(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 district_id uuid not null references public.municipal_districts(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 assignment_role text not null default 'member' check(assignment_role in ('head','member')),
 created_by uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now(),
 unique(district_id,user_id),unique(game_id,user_id)
);
alter table public.municipal_projects add column if not exists district_key text;
create index if not exists municipal_mayor_elections_game_idx on public.municipal_mayor_elections(game_id,created_at desc);
create index if not exists municipal_mayor_candidates_election_idx on public.municipal_mayor_candidates(election_id);
create index if not exists municipal_mayor_ballots_election_idx on public.municipal_mayor_ballots(election_id);
create index if not exists municipal_districts_game_idx on public.municipal_districts(game_id,district_key);
create index if not exists municipal_district_members_district_idx on public.municipal_district_members(district_id);
alter table public.municipal_mayor_elections enable row level security;
alter table public.municipal_mayor_candidates enable row level security;
alter table public.municipal_mayor_ballots enable row level security;
alter table public.municipal_districts enable row level security;
alter table public.municipal_district_members enable row level security;
revoke all privileges on table public.municipal_mayor_elections from anon,authenticated;
revoke all privileges on table public.municipal_mayor_candidates from anon,authenticated;
revoke all privileges on table public.municipal_mayor_ballots from anon,authenticated;
revoke all privileges on table public.municipal_districts from anon,authenticated;
revoke all privileges on table public.municipal_district_members from anon,authenticated;
grant select on table public.municipal_mayor_elections to authenticated;
grant select on table public.municipal_mayor_candidates to authenticated;
grant select on table public.municipal_districts to authenticated;
grant select on table public.municipal_district_members to authenticated;
drop policy if exists municipal_mayor_elections_read on public.municipal_mayor_elections;
create policy municipal_mayor_elections_read on public.municipal_mayor_elections for select to authenticated using(private.is_game_member(game_id));
drop policy if exists municipal_mayor_candidates_read on public.municipal_mayor_candidates;
create policy municipal_mayor_candidates_read on public.municipal_mayor_candidates for select to authenticated using(private.is_game_member(game_id));
drop policy if exists municipal_districts_read on public.municipal_districts;
create policy municipal_districts_read on public.municipal_districts for select to authenticated using(private.is_game_member(game_id));
drop policy if exists municipal_district_members_read on public.municipal_district_members;
create policy municipal_district_members_read on public.municipal_district_members for select to authenticated using(private.is_game_member(game_id));
drop policy if exists municipal_mayor_ballots_teacher_read on public.municipal_mayor_ballots;
create policy municipal_mayor_ballots_teacher_read on public.municipal_mayor_ballots for select to authenticated using(private.is_game_teacher(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='municipal_mayor_elections') then alter publication supabase_realtime add table public.municipal_mayor_elections; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='municipal_mayor_candidates') then alter publication supabase_realtime add table public.municipal_mayor_candidates; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='municipal_districts') then alter publication supabase_realtime add table public.municipal_districts; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='municipal_district_members') then alter publication supabase_realtime add table public.municipal_district_members; end if;
end $$;
create or replace function public.ensure_municipal_districts(p_game_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if (select auth.uid()) is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 insert into public.municipal_districts(game_id,district_key,title) values
 (p_game_id,'zheleznodorozhny','Железнодорожный район'),(p_game_id,'industrialny','Индустриальный район'),
 (p_game_id,'leninsky','Ленинский район'),(p_game_id,'oktyabrsky','Октябрьский район'),(p_game_id,'centralny','Центральный район')
 on conflict(game_id,district_key) do nothing;
end;$$;
revoke all on function public.ensure_municipal_districts(uuid) from public,anon;
grant execute on function public.ensure_municipal_districts(uuid) to authenticated;
create or replace function public.create_municipal_mayor_election(p_game_id uuid) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
 if exists(select 1 from public.municipal_mayor_elections where game_id=p_game_id and status in ('nomination','open')) then raise exception 'An active mayor election already exists'; end if;
 insert into public.municipal_mayor_elections(game_id,created_by) values(p_game_id,v_uid) returning id into v_id;return v_id;
end;$$;
revoke all on function public.create_municipal_mayor_election(uuid) from public,anon;
grant execute on function public.create_municipal_mayor_election(uuid) to authenticated;
create or replace function public.nominate_municipal_mayor(p_election_id uuid,p_user_id uuid) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare e public.municipal_mayor_elections%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into e from public.municipal_mayor_elections where id=p_election_id for update;
 if e.id is null or e.status<>'nomination' then raise exception 'Mayor nomination is closed'; end if;
 if v_uid<>p_user_id and not private.is_game_teacher(e.game_id) then raise exception 'Students may nominate only themselves'; end if;
 if not exists(select 1 from public.game_members where game_id=e.game_id and user_id=p_user_id and kind='student') then raise exception 'Candidate must be a student member'; end if;
 insert into public.municipal_mayor_candidates(election_id,game_id,user_id,nominated_by) values(e.id,e.game_id,p_user_id,v_uid)
 on conflict(election_id,user_id) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.municipal_mayor_candidates where election_id=e.id and user_id=p_user_id; end if;
 return v_id;
end;$$;
revoke all on function public.nominate_municipal_mayor(uuid,uuid) from public,anon;
grant execute on function public.nominate_municipal_mayor(uuid,uuid) to authenticated;
create or replace function public.open_municipal_mayor_election(p_election_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare e public.municipal_mayor_elections%rowtype;
begin
 select * into e from public.municipal_mayor_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if not private.is_game_teacher(e.game_id) then raise exception 'Teacher access required'; end if;
 if e.status<>'nomination' then raise exception 'Election is not in nomination stage'; end if;
 if (select count(*) from public.municipal_mayor_candidates where election_id=e.id)<1 then raise exception 'Nominate at least one candidate'; end if;
 update public.municipal_mayor_elections set status='open',opened_at=now() where id=e.id;
end;$$;
revoke all on function public.open_municipal_mayor_election(uuid) from public,anon;
grant execute on function public.open_municipal_mayor_election(uuid) to authenticated;
create or replace function public.cast_municipal_mayor_ballot(p_election_id uuid,p_candidate_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare e public.municipal_mayor_elections%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into e from public.municipal_mayor_elections where id=p_election_id;
 if e.id is null or e.status<>'open' then raise exception 'Mayor election is not open'; end if;
 if not private.is_game_member(e.game_id) then raise exception 'Game access required'; end if;
 if not exists(select 1 from public.game_members where game_id=e.game_id and user_id=v_uid and kind='student') then raise exception 'Only students vote in this municipal election'; end if;
 if not exists(select 1 from public.municipal_mayor_candidates where id=p_candidate_id and election_id=e.id) then raise exception 'Candidate not found'; end if;
 insert into public.municipal_mayor_ballots(election_id,game_id,voter_user_id,candidate_id) values(e.id,e.game_id,v_uid,p_candidate_id)
 on conflict(election_id,voter_user_id) do update set candidate_id=excluded.candidate_id,created_at=now();
end;$$;
revoke all on function public.cast_municipal_mayor_ballot(uuid,uuid) from public,anon;
grant execute on function public.cast_municipal_mayor_ballot(uuid,uuid) to authenticated;
create or replace function public.close_municipal_mayor_election(p_election_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare e public.municipal_mayor_elections%rowtype;v_max integer;v_count integer;v_winner_candidate uuid;v_winner_user uuid;v_result jsonb;
begin
 select * into e from public.municipal_mayor_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if not private.is_game_teacher(e.game_id) then raise exception 'Teacher access required'; end if;
 if e.status<>'open' then raise exception 'Election is not open'; end if;
 select coalesce(max(votes),0) into v_max from (select c.id,count(b.id)::integer votes from public.municipal_mayor_candidates c left join public.municipal_mayor_ballots b on b.candidate_id=c.id where c.election_id=e.id group by c.id) q;
 select count(*)::integer,min(id) into v_count,v_winner_candidate from (select c.id,count(b.id)::integer votes from public.municipal_mayor_candidates c left join public.municipal_mayor_ballots b on b.candidate_id=c.id where c.election_id=e.id group by c.id) q where votes=v_max;
 if v_max=0 or v_count<>1 then update public.municipal_mayor_elections set status='tie',closed_at=now() where id=e.id;
 else
  select user_id into v_winner_user from public.municipal_mayor_candidates where id=v_winner_candidate;
  update public.municipal_mayor_elections set status='finished',winner_user_id=v_winner_user,closed_at=now() where id=e.id;
  update public.game_members set role_title='Глава города Барнаула' where game_id=e.game_id and user_id=v_winner_user;
 end if;
 select jsonb_build_object(
  'status',case when v_max=0 or v_count<>1 then 'tie' else 'finished' end,'winner_user_id',v_winner_user,
  'turnout',(select count(*) from public.municipal_mayor_ballots where election_id=e.id),
  'results',coalesce((select jsonb_agg(jsonb_build_object('candidate_id',c.id,'user_id',c.user_id,'votes',count(b.id)) order by count(b.id) desc)
    from public.municipal_mayor_candidates c left join public.municipal_mayor_ballots b on b.candidate_id=c.id where c.election_id=e.id group by c.election_id),'[]'::jsonb)
 ) into v_result;return v_result;
end;$$;
revoke all on function public.close_municipal_mayor_election(uuid) from public,anon;
grant execute on function public.close_municipal_mayor_election(uuid) to authenticated;
create or replace function public.get_municipal_mayor_results(p_election_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare e public.municipal_mayor_elections%rowtype;
begin
 select * into e from public.municipal_mayor_elections where id=p_election_id;
 if e.id is null then raise exception 'Election not found'; end if;
 if not private.is_game_member(e.game_id) then raise exception 'Game access required'; end if;
 if e.status='open' and not private.is_game_teacher(e.game_id) then return jsonb_build_object('status','open','turnout',(select count(*) from public.municipal_mayor_ballots where election_id=e.id)); end if;
 return jsonb_build_object('status',e.status,'winner_user_id',e.winner_user_id,
  'turnout',(select count(*) from public.municipal_mayor_ballots where election_id=e.id),
  'results',coalesce((select jsonb_agg(jsonb_build_object('candidate_id',c.id,'user_id',c.user_id,'votes',count(b.id)) order by count(b.id) desc)
    from public.municipal_mayor_candidates c left join public.municipal_mayor_ballots b on b.candidate_id=c.id where c.election_id=e.id group by c.election_id),'[]'::jsonb));
end;$$;
revoke all on function public.get_municipal_mayor_results(uuid) from public,anon;
grant execute on function public.get_municipal_mayor_results(uuid) to authenticated;
create or replace function public.appoint_municipal_district_head(p_district_id uuid,p_user_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.municipal_districts%rowtype;v_uid uuid:=(select auth.uid());v_mayor uuid;
begin
 select * into d from public.municipal_districts where id=p_district_id for update;if d.id is null then raise exception 'District not found'; end if;
 select winner_user_id into v_mayor from public.municipal_mayor_elections where game_id=d.game_id and status='finished' order by closed_at desc limit 1;
 if not private.is_game_teacher(d.game_id) and v_uid is distinct from v_mayor then raise exception 'Mayor / teacher access required'; end if;
 if not exists(select 1 from public.game_members where game_id=d.game_id and user_id=p_user_id and kind='student') then raise exception 'District head must be a student member'; end if;
 delete from public.municipal_district_members where game_id=d.game_id and user_id=p_user_id;
 update public.municipal_districts set head_user_id=p_user_id where id=d.id;
 insert into public.municipal_district_members(game_id,district_id,user_id,assignment_role,created_by) values(d.game_id,d.id,p_user_id,'head',v_uid);
 update public.game_members set role_title='Глава администрации · '||d.title where game_id=d.game_id and user_id=p_user_id;
end;$$;
revoke all on function public.appoint_municipal_district_head(uuid,uuid) from public,anon;
grant execute on function public.appoint_municipal_district_head(uuid,uuid) to authenticated;
create or replace function public.assign_municipal_district_member(p_district_id uuid,p_user_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.municipal_districts%rowtype;v_uid uuid:=(select auth.uid());v_mayor uuid;
begin
 select * into d from public.municipal_districts where id=p_district_id;if d.id is null then raise exception 'District not found'; end if;
 select winner_user_id into v_mayor from public.municipal_mayor_elections where game_id=d.game_id and status='finished' order by closed_at desc limit 1;
 if not private.is_game_teacher(d.game_id) and v_uid is distinct from v_mayor and v_uid is distinct from d.head_user_id then raise exception 'District head / mayor / teacher access required'; end if;
 if not exists(select 1 from public.game_members where game_id=d.game_id and user_id=p_user_id and kind='student') then raise exception 'Member must be a student'; end if;
 insert into public.municipal_district_members(game_id,district_id,user_id,assignment_role,created_by) values(d.game_id,d.id,p_user_id,'member',v_uid)
 on conflict(game_id,user_id) do update set district_id=excluded.district_id,assignment_role='member',created_by=v_uid,created_at=now();
end;$$;
revoke all on function public.assign_municipal_district_member(uuid,uuid) from public,anon;
grant execute on function public.assign_municipal_district_member(uuid,uuid) to authenticated;
create or replace function public.remove_municipal_district_member(p_assignment_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.municipal_district_members%rowtype;d public.municipal_districts%rowtype;v_uid uuid:=(select auth.uid());v_mayor uuid;
begin
 select * into a from public.municipal_district_members where id=p_assignment_id;if a.id is null then return; end if;
 select * into d from public.municipal_districts where id=a.district_id;
 select winner_user_id into v_mayor from public.municipal_mayor_elections where game_id=a.game_id and status='finished' order by closed_at desc limit 1;
 if not private.is_game_teacher(a.game_id) and v_uid is distinct from v_mayor and v_uid is distinct from d.head_user_id then raise exception 'District head / mayor / teacher access required'; end if;
 if a.assignment_role='head' then raise exception 'Replace the district head instead of removing them as an ordinary member'; end if;
 delete from public.municipal_district_members where id=a.id;
end;$$;
revoke all on function public.remove_municipal_district_member(uuid) from public,anon;
grant execute on function public.remove_municipal_district_member(uuid) to authenticated;
create or replace function public.set_municipal_project_district(p_project_id uuid,p_district_key text) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.municipal_projects%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into p from public.municipal_projects where id=p_project_id for update;if p.id is null then raise exception 'Project not found'; end if;
 if not private.can_edit_municipal_project(p.id,v_uid) then raise exception 'Project editing access required'; end if;
 if p.status not in ('fieldwork','draft') then raise exception 'Submitted project is locked'; end if;
 if not exists(select 1 from public.municipal_districts where game_id=p.game_id and district_key=p_district_key) then raise exception 'District not found'; end if;
 update public.municipal_projects set district_key=p_district_key,updated_at=now() where id=p.id;
end;$$;
revoke all on function public.set_municipal_project_district(uuid,text) from public,anon;
grant execute on function public.set_municipal_project_district(uuid,text) to authenticated;
create or replace function public.submit_municipal_project(p_project_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.municipal_projects%rowtype;v_uid uuid:=(select auth.uid());v_images integer;v_videos integer;v_members integer;
begin
 select * into p from public.municipal_projects where id=p_project_id for update;if p.id is null then raise exception 'Project not found'; end if;
 if not private.can_edit_municipal_project(p.id,v_uid) then raise exception 'Project editing access required'; end if;
 if p.status not in ('fieldwork','draft') then raise exception 'Project is already submitted'; end if;
 if p.district_key is null then raise exception 'Assign the project to one of the five Barnaul districts'; end if;
 select count(*) filter(where media_kind='image'),count(*) filter(where media_kind='video') into v_images,v_videos from public.municipal_project_evidence where project_id=p.id;
 if v_images<10 then raise exception 'Field research requires at least 10 photographs; current: %',v_images; end if;
 if v_videos<5 then raise exception 'Field research requires at least 5 videos; current: %',v_videos; end if;
 select count(*) into v_members from public.municipal_project_members where project_id=p.id;if v_members<1 then raise exception 'Project team is empty'; end if;
 if exists(select 1 from public.municipal_project_members pm left join public.municipal_district_members dm on dm.game_id=p.game_id and dm.user_id=pm.user_id
  left join public.municipal_districts d on d.id=dm.district_id where pm.project_id=p.id and (d.district_key is null or d.district_key<>p.district_key))
 then raise exception 'Every project member must belong to the selected district administration'; end if;
 update public.municipal_projects set status='submitted',submitted_at=now(),updated_at=now() where id=p.id;
end;$$;
revoke all on function public.submit_municipal_project(uuid) from public,anon;
grant execute on function public.submit_municipal_project(uuid) to authenticated;