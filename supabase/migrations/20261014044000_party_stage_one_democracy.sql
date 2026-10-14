-- Stage 1: self-organised parties, member invitations and democratic chair elections.
-- All mutations validate active game membership; observers receive no privileges.
create table if not exists public.party_chair_ballots(
 game_id uuid not null references public.games(id) on delete cascade,
 party_id uuid not null references public.game_parties(id) on delete cascade,
 voter_id uuid not null references auth.users(id) on delete cascade,
 candidate_id uuid not null references auth.users(id) on delete cascade,
 voted_at timestamptz not null default clock_timestamp(),
 primary key (party_id,voter_id)
);
create index if not exists party_chair_ballots_game_idx on public.party_chair_ballots(game_id,party_id);
alter table public.party_chair_ballots enable row level security;
revoke all on public.party_chair_ballots from anon,authenticated;
grant select on public.party_chair_ballots to authenticated;
drop policy if exists party_chair_ballots_member_read on public.party_chair_ballots;
create policy party_chair_ballots_member_read on public.party_chair_ballots
 for select to authenticated using (
  private.is_game_teacher(game_id) or
  exists(select 1 from public.game_members m join public.game_parties p on p.game_id=m.game_id
   where p.id=party_id and m.game_id=party_chair_ballots.game_id
     and m.user_id=(select auth.uid()) and m.kind='student' and m.team=p.name)
 );

create or replace function public.found_game_party(p_game uuid,p_name text,p_ideology text)
returns uuid language plpgsql security definer set search_path to 'public','private','pg_temp'
as $fn$
declare v_uid uuid:=auth.uid();v_m public.game_members%rowtype;v_name text:=btrim(p_name);v_id uuid;v_teacher boolean;
begin
 if v_uid is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into v_m from public.game_members where game_id=p_game and user_id=v_uid for update;
 if not found or v_m.kind not in ('student','teacher') then raise exception 'Forbidden' using errcode='42501';end if;
 v_teacher:=v_m.kind='teacher' and private.is_game_teacher(p_game);
 if not v_teacher and (
  v_m.kind<>'student' or v_m.team is not null or
  not exists(select 1 from public.game_stages s where s.game_id=p_game and s.stage_no=1 and s.status='open'
   and (s.deadline is null or s.deadline>clock_timestamp()))
 ) then raise exception 'Party founding is available to unassigned students during open stage 1' using errcode='42501'; end if;
 if length(v_name)<3 or length(v_name)>120 or length(btrim(coalesce(p_ideology,'')))<3 then
  raise exception 'Enter a party name and ideology (at least 3 characters)' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('game-parties:'||p_game,0));
 if exists(select 1 from public.game_parties where game_id=p_game and lower(name)=lower(v_name)) then
  raise exception 'A party with this name already exists' using errcode='23505';end if;
 insert into public.game_parties(game_id,name,ideology,color,created_by)
 values(p_game,v_name,btrim(p_ideology),(array['#6f7cff','#4dc9ff','#55d99b','#ff8d72','#c77dff'])[1+((select count(*) from public.game_parties where game_id=p_game)::integer%5)],v_uid) returning id into v_id;
 insert into public.chat_channels(game_id,name,kind,created_by)
 values(p_game,'Фракция · '||v_name,'team',v_uid);
 if not v_teacher then
  update public.game_members set team=v_name,party_joined_at=clock_timestamp() where game_id=p_game and user_id=v_uid;
  insert into public.channel_members(channel_id,user_id)
   select c.id,v_uid from public.chat_channels c
   where c.game_id=p_game and c.name='Фракция · '||v_name and c.kind='team'
   on conflict do nothing;
 end if;
 return v_id;
end $fn$;
revoke all on function public.found_game_party(uuid,text,text) from public,anon;
grant execute on function public.found_game_party(uuid,text,text) to authenticated;

-- No outsider and no observer can invite participants into someone else's party.
create or replace function public.invite_to_party(p_party_id uuid,p_user_id uuid)
returns uuid language plpgsql security definer set search_path to 'public','private','pg_temp'
as $fn$
declare p public.game_parties%rowtype;gm public.game_members%rowtype;actor public.game_members%rowtype;v_uid uuid:=auth.uid();v_id uuid;
begin
 select * into p from public.game_parties where id=p_party_id;
 if not found then raise exception 'Party not found';end if;
 select * into actor from public.game_members where game_id=p.game_id and user_id=v_uid;
 if not (private.is_game_teacher(p.game_id) or (actor.kind='student' and actor.team=p.name))
 then raise exception 'Party member access required' using errcode='42501';end if;
 if not private.is_game_teacher(p.game_id) and
  not exists(select 1 from public.game_stages s where s.game_id=p.game_id and s.stage_no=1 and s.status='open'
   and (s.deadline is null or s.deadline>clock_timestamp()))
 then raise exception 'Stage 1 has ended' using errcode='42501'; end if;
 select * into gm from public.game_members where game_id=p.game_id and user_id=p_user_id;
 if gm.user_id is null or gm.kind<>'student' then raise exception 'Student not found';end if;
 if gm.team is not null then raise exception 'Student already belongs to a party';end if;
 insert into public.party_invitations(game_id,party_id,invited_user_id,invited_by)
 values(p.game_id,p.id,p_user_id,v_uid) on conflict do nothing returning id into v_id;
 if v_id is null then
  select id into v_id from public.party_invitations
  where party_id=p.id and invited_user_id=p_user_id and status='pending'
  order by created_at desc limit 1;
 end if;
 return v_id;
end $fn$;
revoke all on function public.invite_to_party(uuid,uuid) from public,anon;
grant execute on function public.invite_to_party(uuid,uuid) to authenticated;

create or replace function public.vote_for_party_chair(p_party_id uuid,p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','private','pg_temp'
as $fn$
declare p public.game_parties%rowtype;v_uid uuid:=auth.uid();v_votes integer;v_members integer;v_max integer;v_winner uuid;v_tied integer;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if not found then raise exception 'Party not found';end if;
 if not exists(select 1 from public.game_stages where game_id=p.game_id and stage_no=1 and status='open'
  and (deadline is null or deadline>clock_timestamp())) then
  raise exception 'Chair election stage has ended' using errcode='42501';end if;
 if p.leader_user_id is not null then raise exception 'Chair election already completed' using errcode='23505';end if;
 if not exists(select 1 from public.game_members where game_id=p.game_id and user_id=v_uid and kind='student' and team=p.name)
 or not exists(select 1 from public.game_members where game_id=p.game_id and user_id=p_candidate_id and kind='student' and team=p.name)
 then raise exception 'Both voter and candidate must be party members' using errcode='42501';end if;
 insert into public.party_chair_ballots(game_id,party_id,voter_id,candidate_id)
 values(p.game_id,p.id,v_uid,p_candidate_id)
 on conflict(party_id,voter_id) do update set candidate_id=excluded.candidate_id,voted_at=clock_timestamp();
 select count(*) into v_members from public.game_members where game_id=p.game_id and kind='student' and team=p.name;
 select count(*) into v_votes from public.party_chair_ballots where party_id=p.id;
 if v_votes>=v_members then
  select max(n) into v_max from (select count(*) n from public.party_chair_ballots where party_id=p.id group by candidate_id) c;
  select count(*),min(candidate_id) into v_tied,v_winner
   from (select candidate_id,count(*) n from public.party_chair_ballots where party_id=p.id group by candidate_id) c
   where c.n=v_max;
  if v_tied=1 then
   update public.game_parties set leader_user_id=v_winner where id=p.id;
  end if;
 end if;
 return jsonb_build_object('votes',v_votes,'members',v_members,'leader_id',case when v_tied=1 then v_winner else null end,
 'tied',coalesce(v_tied,0)>1);
end $fn$;
revoke all on function public.vote_for_party_chair(uuid,uuid) from public,anon;
grant execute on function public.vote_for_party_chair(uuid,uuid) to authenticated;

do $migration$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='party_chair_ballots') then
  alter publication supabase_realtime add table public.party_chair_ballots;
 end if;
end $migration$;

-- The older permissive guest filters did not constrain writes by party.
-- Keep teacher INSERT/UPDATE policy; student founding goes through secure RPC.
drop policy if exists guests_cannot_insert on public.game_parties;
drop policy if exists guests_cannot_update on public.game_parties;

-- Party members may upload files; only Minjust/teacher may approve/revise.
drop policy if exists guests_cannot_insert on public.party_documents;
drop policy if exists guests_cannot_update on public.party_documents;
drop policy if exists party_documents_update on public.party_documents;
create policy party_documents_update on public.party_documents
 for update to authenticated using (private.is_game_teacher(game_id))
 with check (private.is_game_teacher(game_id));
