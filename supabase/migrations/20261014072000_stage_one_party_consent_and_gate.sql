-- Stage 1 consent-first chair election, independent of teacher or guest bypass.
-- Same server-side definition as client stageWorkStatus.ts.
create or replace function private.stage_one_party_active(p_game uuid)
returns boolean language sql stable security definer
set search_path to ''
as $active$
 select exists (
  select 1 from public.games g join public.game_stages st on st.game_id=g.id
  where g.id=p_game and g.status='running' and g.turn_open
   and (g.turn_ends_at is null or g.turn_ends_at>clock_timestamp())
   and st.stage_no=1 and st.status='open'
   and (st.deadline is null or st.deadline>clock_timestamp())
 )
$active$;
revoke all on function private.stage_one_party_active(uuid) from public,anon,authenticated;

-- Repair only the contradictory lobby state, without removing any game
-- records, participants, party applications or approved scores.
update public.game_stages st set status='locked',opened_at=null,deadline=null
from public.games g where st.game_id=g.id and st.stage_no=1
 and st.status='open' and g.status='lobby' and g.turn_open=false;

CREATE OR REPLACE FUNCTION public.found_game_party(p_game uuid, p_name text, p_ideology text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=auth.uid();v_m public.game_members%rowtype;v_name text:=btrim(p_name);v_id uuid;v_teacher boolean;
begin
 if v_uid is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into v_m from public.game_members where game_id=p_game and user_id=v_uid for update;
 if not found or v_m.kind not in ('student','teacher') or v_m.roster_archived_at is not null then raise exception 'Forbidden' using errcode='42501';end if;
 v_teacher:=v_m.kind='teacher' and private.is_game_teacher(p_game);
 if private.has_open_duma_mandate_vote(p_game) then raise exception 'Party founding is frozen during a Duma mandate vote' using errcode='42501';end if;
 if not private.stage_one_party_active(p_game) then raise exception 'Первый этап ещё не открыт.' using errcode='42501';end if;
 if not v_teacher and (v_m.kind<>'student' or v_m.team is not null) then raise exception 'Партию создаёт участник без партии.' using errcode='42501';end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.invite_to_party(p_party_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.game_parties%rowtype;gm public.game_members%rowtype;actor public.game_members%rowtype;v_uid uuid:=auth.uid();v_id uuid;
begin
 select * into p from public.game_parties where id=p_party_id;
 if not found then raise exception 'Party not found';end if;
 select * into actor from public.game_members where game_id=p.game_id and user_id=v_uid;
 if actor.roster_archived_at is not null or not (private.is_game_teacher(p.game_id) or (actor.kind='student' and actor.team=p.name))
 then raise exception 'Party member access required' using errcode='42501';end if;
 if not private.stage_one_party_active(p.game_id) then raise exception 'Первый этап ещё не открыт.' using errcode='42501';end if;
 if p.leader_user_id is not null then raise exception 'Приём приглашений завершён: председатель избран.' using errcode='42501';end if;
 select * into gm from public.game_members where game_id=p.game_id and user_id=p_user_id;
 if gm.user_id is null or gm.kind<>'student' or gm.roster_archived_at is not null then raise exception 'Student not found';end if;
 if gm.team is not null then raise exception 'Student already belongs to a party';end if;
 insert into public.party_invitations(game_id,party_id,invited_user_id,invited_by)
 values(p.game_id,p.id,p_user_id,v_uid) on conflict do nothing returning id into v_id;
 if v_id is null then
  select id into v_id from public.party_invitations
  where party_id=p.id and invited_user_id=p_user_id and status='pending'
  order by created_at desc limit 1;
 end if;
 return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.respond_party_invitation(p_invitation_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare inv public.party_invitations%rowtype;p public.game_parties%rowtype;gm public.game_members%rowtype;v_uid uuid:=(select auth.uid());ch uuid;
begin
 select * into inv from public.party_invitations where id=p_invitation_id for update;
 if inv.id is null or inv.status<>'pending' then raise exception 'Invitation is not active';end if;
 if inv.invited_user_id<>v_uid then raise exception 'Invitation belongs to another user';end if;
 select * into p from public.game_parties where id=inv.party_id;
 if not private.stage_one_party_active(inv.game_id) then raise exception 'Первый этап ещё не открыт.' using errcode='42501';end if;
 if p.leader_user_id is not null then raise exception 'Председатель уже избран.' using errcode='42501';end if;
 select * into gm from public.game_members where game_id=inv.game_id and user_id=v_uid for update;
 if gm.user_id is null or gm.kind<>'student' or gm.roster_archived_at is not null then raise exception 'Вступление доступно только действующему участнику.' using errcode='42501';end if;

 if p_accept then
  if private.has_open_duma_mandate_vote(inv.game_id) then
   raise exception 'Party membership is frozen while a State Duma mandate vote is open';
  end if;
  if gm.team is not null and gm.team<>p.name then raise exception 'You already belong to another party';end if;
  update public.game_members set team=p.name,party_joined_at=coalesce(party_joined_at,now())
   where game_id=inv.game_id and user_id=v_uid;
  update public.party_invitations set status='accepted',responded_at=now() where id=inv.id;
  update public.party_invitations set status='cancelled',responded_at=now()
   where game_id=inv.game_id and invited_user_id=v_uid and id<>inv.id and status='pending';
  select id into ch from public.chat_channels where game_id=inv.game_id and kind='team' and name='Фракция · '||p.name limit 1;
  if ch is not null then insert into public.channel_members(channel_id,user_id) values(ch,v_uid) on conflict do nothing;end if;
 else
  update public.party_invitations set status='declined',responded_at=now() where id=inv.id;
 end if;
 perform private.rebalance_party_mandates(p.id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.vote_for_party_chair(p_party_id uuid, p_candidate_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.game_parties%rowtype;v_uid uuid:=auth.uid();v_votes integer;v_members integer;v_max integer;v_winner uuid;v_tied integer;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if not found then raise exception 'Party not found';end if;
 if not private.stage_one_party_active(p.game_id) then raise exception 'Первый этап ещё не открыт.' using errcode='42501';end if;

 if p.leader_user_id is not null then raise exception 'Chair election already completed' using errcode='23505';end if;
 if private.has_open_duma_mandate_vote(p.game_id) then raise exception 'Chair election is frozen during a Duma mandate vote' using errcode='42501';end if;
 if not exists(select 1 from public.game_members where game_id=p.game_id and user_id=v_uid and kind='student' and team=p.name and roster_archived_at is null)
 or not exists(select 1 from public.game_members where game_id=p.game_id and user_id=p_candidate_id and kind='student' and team=p.name and roster_archived_at is null)
 then raise exception 'Both voter and candidate must be party members' using errcode='42501';end if;
 if (select count(*) from public.game_members gm where gm.game_id=p.game_id and gm.kind='student' and gm.team=p.name and gm.roster_archived_at is null)<2 then
  raise exception 'Сначала подтвердите вступление хотя бы одного приглашённого участника.' using errcode='42501';end if;
 if exists(select 1 from public.party_invitations pi where pi.party_id=p.id and pi.status='pending') then
  raise exception 'Дождитесь согласия или отказа по всем приглашениям до выборов.' using errcode='42501';end if;
 insert into public.party_chair_ballots(game_id,party_id,voter_id,candidate_id)
 values(p.game_id,p.id,v_uid,p_candidate_id)
 on conflict(party_id,voter_id) do update set candidate_id=excluded.candidate_id,voted_at=clock_timestamp();
 select count(*) into v_members from public.game_members where game_id=p.game_id and kind='student' and team=p.name and roster_archived_at is null;
 select count(*) into v_votes from public.party_chair_ballots b
  join public.game_members voter on voter.game_id=p.game_id and voter.user_id=b.voter_id
   and voter.kind='student' and voter.team=p.name and voter.roster_archived_at is null
  join public.game_members candidate on candidate.game_id=p.game_id and candidate.user_id=b.candidate_id
   and candidate.kind='student' and candidate.team=p.name and candidate.roster_archived_at is null
  where b.party_id=p.id;
 if v_votes>=v_members then
  select max(n) into v_max from (select b.candidate_id,count(*) n from public.party_chair_ballots b
    join public.game_members voter on voter.game_id=p.game_id and voter.user_id=b.voter_id
     and voter.kind='student' and voter.team=p.name and voter.roster_archived_at is null
    join public.game_members candidate on candidate.game_id=p.game_id and candidate.user_id=b.candidate_id
     and candidate.kind='student' and candidate.team=p.name and candidate.roster_archived_at is null
    where b.party_id=p.id group by b.candidate_id) c;
  select count(*),(array_agg(candidate_id order by candidate_id))[1] into v_tied,v_winner
   from (select b.candidate_id,count(*) n from public.party_chair_ballots b
    join public.game_members voter on voter.game_id=p.game_id and voter.user_id=b.voter_id
     and voter.kind='student' and voter.team=p.name and voter.roster_archived_at is null
    join public.game_members candidate on candidate.game_id=p.game_id and candidate.user_id=b.candidate_id
     and candidate.kind='student' and candidate.team=p.name and candidate.roster_archived_at is null
    where b.party_id=p.id group by b.candidate_id) c
   where c.n=v_max;
  if v_tied=1 then
   update public.game_parties set leader_user_id=v_winner where id=p.id;
  end if;
 end if;
 return jsonb_build_object('votes',v_votes,'members',v_members,'leader_id',case when v_tied=1 then v_winner else null end,
 'tied',coalesce(v_tied,0)>1);
end $function$
;
-- Reject new party dossiers before stage 1 opens, including teacher uploads.
create or replace function private.enforce_party_dossier_stage()
returns trigger language plpgsql security definer
set search_path to ''
as $guard$
begin
 if auth.uid() is not null and not private.stage_one_party_active(new.game_id) then
  raise exception 'Первый этап ещё не открыт.' using errcode='42501';
 end if;
 return new;
end $guard$;
revoke all on function private.enforce_party_dossier_stage() from public,anon,authenticated;
drop trigger if exists enforce_party_dossier_stage on public.party_documents;
create trigger enforce_party_dossier_stage before insert on public.party_documents
 for each row execute function private.enforce_party_dossier_stage();
