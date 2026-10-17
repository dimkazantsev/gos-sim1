-- Stage 4: block duplicate mandates for filled offices. The checked office
-- winner is immutable to these RPCs. Existing legitimate results are preserved.
CREATE OR REPLACE FUNCTION private.office_has_confirmed_winner(p_game uuid,p_office text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $guard$
 SELECT EXISTS(
  SELECT 1 FROM public.office_elections e
  WHERE e.game_id=p_game AND e.office_key=p_office AND e.status='finished' AND e.winner_candidate_id IS NOT NULL
 ) OR EXISTS(
  SELECT 1 FROM public.institution_units u
  WHERE u.game_id=p_game AND p_office='committee:'||u.id::text
  AND u.unit_kind='committee' AND u.head_user_id IS NOT NULL
 );
$guard$;
REVOKE ALL ON FUNCTION private.office_has_confirmed_winner(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.create_office_election(p_game_id uuid, p_office_key text, p_vote_mode text DEFAULT 'open'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_title text;
begin
 if not private.gd_stage4_can_manage(p_game_id,v_uid,p_office_key) then
  raise exception 'Создание выборов доступно уполномоченному руководителю заседания при открытом этапе';end if;
 -- Avoid duplicate elections under concurrent chair requests.
 PERFORM 1 FROM public.games WHERE id=p_game_id FOR UPDATE;
 if p_office_key not in ('gd_chair','gd_deputy_1','gd_deputy_2') then raise exception 'Unsupported office'; end if;
 if private.office_has_confirmed_winner(p_game_id,p_office_key)
 then raise exception 'Должность уже занята: повторные выборы после избрания запрещены';end if;
 if p_vote_mode not in ('open','secret') then raise exception 'Unsupported vote mode'; end if;
 if not exists(select 1 from public.game_votes where game_id=p_game_id and stage_no=4 and procedure_key='gd_leadership_procedure' and status='closed' and result_code='passed') then raise exception 'Сначала утвердите процедуру голосованием депутатов';end if;
 if exists(select 1 from public.office_elections where game_id=p_game_id and office_key=p_office_key and status in ('nomination','open'))
 then raise exception 'An active election for this office already exists'; end if;
 v_title:=case p_office_key when 'gd_chair' then 'Председатель Государственной Думы'
   when 'gd_deputy_1' then 'Заместитель Председателя ГД №1'
   else 'Заместитель Председателя ГД №2' end;
 insert into public.office_elections(game_id,stage_no,office_key,office_title,vote_mode,created_by,ballot_mode)
 values(p_game_id,4,p_office_key,v_title,p_vote_mode,v_uid,'personal') returning id into v_id;
 return v_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.create_committee_chair_election(p_unit_id uuid, p_vote_mode text DEFAULT 'open'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;v_key text;
begin
 select * into u from public.institution_units where id=p_unit_id for update;
 if u.id is null or u.unit_kind<>'committee' then raise exception 'Committee not found';end if;
 if not private.gd_stage4_can_manage(u.game_id,v_uid,'committee:'||u.id::text)
 then raise exception 'Выборы комитета доступны руководству Думы при открытом этапе и утверждённой повестке';end if;
 if not exists(select 1 from public.office_elections where game_id=u.game_id and office_key='gd_chair' and status='finished') then raise exception 'Сначала изберите Председателя Государственной Думы';end if;
 if not private.is_game_teacher(u.game_id) then perform private.require_game_meeting_registration(u.game_id,v_uid,4,'gd');end if;
 if p_vote_mode is null or p_vote_mode not in ('open','secret') then raise exception 'Unsupported vote mode';end if;
 v_key:='committee:'||u.id::text;
 if u.head_user_id IS NOT NULL OR private.office_has_confirmed_winner(u.game_id,v_key)
 then raise exception 'Председатель комитета уже избран: новые выборы не допускаются';end if;
 if exists(select 1 from public.office_elections where game_id=u.game_id and office_key=v_key and status in ('nomination','open'))
 then raise exception 'An active chair election already exists for this committee';end if;
 insert into public.office_elections(game_id,stage_no,office_key,office_title,round_no,vote_mode,status,created_by,ballot_mode)
 values(u.game_id,4,v_key,'Председатель · '||u.title,1,p_vote_mode,'nomination',v_uid,'personal') returning id into v_id;
 return v_id;
end;$function$;
CREATE OR REPLACE FUNCTION public.open_office_election(p_election_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare e public.office_elections%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if e.stage_no=4 THEN
  IF NOT private.gd_stage4_can_manage(e.game_id,v_uid,e.office_key) THEN
   raise exception 'Открыть голосование вправе председатель заседания или преподаватель';END IF;
 ELSIF NOT private.is_game_teacher(e.game_id) THEN
  raise exception 'Teacher access required';
 END IF;
 if private.office_has_confirmed_winner(e.game_id,e.office_key)
 then raise exception 'Должность уже занята: повторное голосование запрещено';end if;
 if e.status<>'nomination' then raise exception 'Election cannot be opened'; end if;
 if (select count(*) from public.office_candidates where election_id=e.id)<1 then raise exception 'Nominate at least one candidate'; end if;
 update public.office_elections set status='open',opened_at=now() where id=e.id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.nominate_office_candidate(p_election_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare e public.office_elections%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_id uuid;v_unit uuid;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if e.status<>'nomination' then raise exception 'Nomination is closed'; end if;
 if private.office_has_confirmed_winner(e.game_id,e.office_key)
 then raise exception 'Должность уже занята: повторное выдвижение невозможно';end if;
 if e.stage_no=4 AND NOT private.gd_stage4_meeting_active(e.game_id) then
  raise exception 'Этап Государственной Думы закрыт или повестка не утверждена';end if;

 -- Nomination of a committee chair belongs to the chair of a registered party,
 -- not necessarily a personally registered deputy. Deputies still elect the chair.
 if e.stage_no=4 and e.office_key like 'committee:%' then
  select p.id into v_party from public.game_parties p
  join public.game_members gm on gm.game_id=p.game_id and gm.user_id=v_uid
  where p.game_id=e.game_id and p.leader_user_id=v_uid
    and p.registration_status='registered'
    and gm.kind='student' and gm.roster_archived_at is null
  limit 1;
  if v_party is null and not private.is_game_teacher(e.game_id) then
   raise exception 'Кандидатуру председателя комитета может выдвинуть председатель зарегистрированной партии';
  end if;
 else
  if not private.is_game_teacher(e.game_id) then
   perform private.require_game_meeting_registration(e.game_id,v_uid,e.stage_no,'gd');
  end if;
  v_party:=private.party_led_by(e.game_id,v_uid);
 end if;
 -- A registered GD deputy may propose a candidate from their own
 -- registered faction. The chair retains management of the election.
 if v_party IS NULL AND e.stage_no=4
   AND e.office_key IN ('gd_chair','gd_deputy_1','gd_deputy_2')
   AND private.gd_stage4_deputy_can_propose(e.game_id,v_uid) THEN
  SELECT p.id INTO v_party FROM public.game_members gm
   JOIN public.game_parties p ON p.game_id=gm.game_id AND p.name=gm.team
  WHERE gm.game_id=e.game_id AND gm.user_id=v_uid
    AND gm.kind='student' AND gm.roster_archived_at IS NULL
    AND p.registration_status='registered' LIMIT 1;
 END IF;
 if v_party is null and not private.is_game_teacher(e.game_id)
 then raise exception 'Кандидатуру может предложить зарегистрированный депутат своей фракции'; end if;
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

 if e.office_key like 'committee:%' then
   v_unit:=substring(e.office_key from 11)::uuid;
   if private.gd_member_capacity(e.game_id,p_user_id)<=0
   then raise exception 'Кандидат должен представлять действующие депутатские мандаты Государственной Думы'; end if;
 end if;

 insert into public.office_candidates(election_id,game_id,user_id,party_id,nominated_by)
 values(e.id,e.game_id,p_user_id,v_party,v_uid)
 on conflict(election_id,user_id) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.office_candidates where election_id=e.id and user_id=p_user_id; end if;
 return v_id;
end;$function$;

-- Defence in depth: obsolete live ballots and manual close cannot elect a second holder.
CREATE OR REPLACE FUNCTION public.cast_personal_office_ballot(p_election_id uuid, p_candidate_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 e public.office_elections%rowtype;
 uid uuid:=(select auth.uid());
 party uuid;
 capacity integer;
begin
 if uid is null then raise exception 'Необходимо войти в игру';end if;
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null or e.status<>'open' or e.ballot_mode<>'personal' then
  raise exception 'Персональное голосование сейчас не открыто';
 end if;
 if private.office_has_confirmed_winner(e.game_id,e.office_key)
 then raise exception 'Должность уже занята; голосование прекращено';end if;
 perform private.require_game_meeting_registration(e.game_id,uid,e.stage_no,'gd');
 select gp.id,private.gd_effective_present(e.game_id,uid,r.present_mandates)
 into party,capacity
 from public.game_members gm
 join public.game_parties gp on gp.game_id=gm.game_id and gp.name=gm.team
 join public.institution_session_registrations r on r.game_id=gm.game_id and r.user_id=gm.user_id
  and r.stage_no=e.stage_no and r.institution_key='gd'
 where gm.game_id=e.game_id and gm.user_id=uid and gm.kind='student'
  and gm.roster_archived_at is null
 limit 1;
 if party is null or capacity<=0 then raise exception 'У вас нет действующих депутатских мандатов';end if;
 if not exists(select 1 from public.office_candidates c where c.id=p_candidate_id and c.election_id=e.id and c.game_id=e.game_id)
 then raise exception 'Кандидат не относится к этому голосованию';end if;
 insert into public.office_personal_ballots(election_id,game_id,voter_id,party_id,candidate_id)
 values(e.id,e.game_id,uid,party,p_candidate_id)
 on conflict(election_id,voter_id) do update set
   party_id=excluded.party_id,candidate_id=excluded.candidate_id,updated_at=now();
 -- The election row is already locked; the final eligible ballot
 -- closes this one election atomically and cannot race another ballot.
 perform private.auto_finish_personal_office_election_locked(e.id);
end $function$;

CREATE OR REPLACE FUNCTION public.set_office_ballot(p_election_id uuid, p_candidate_id uuid, p_votes integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare e public.office_elections%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_capacity integer;v_other integer;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if e.status<>'open' then raise exception 'Election is not open'; end if;
 if private.office_has_confirmed_winner(e.game_id,e.office_key)
 then raise exception 'Должность уже занята; голосование прекращено';end if;
 if e.ballot_mode<>'faction' then raise exception 'Используйте персональный бюллетень депутата';end if;
 if p_votes<0 then raise exception 'Votes cannot be negative'; end if;
 if not exists(select 1 from public.office_candidates where id=p_candidate_id and election_id=e.id)
 then raise exception 'Candidate not found in this election'; end if;

 v_party:=private.party_led_by(e.game_id,v_uid);
 if v_party is null then raise exception 'Only faction leaders submit faction ballots'; end if;
 if e.stage_no=4 then
  -- Match the live mandate electorate rather than counting outsiders.
  perform private.require_game_meeting_registration(e.game_id,v_uid,e.stage_no,'gd');
  if not exists(
    select 1 from public.game_parties gp
    join public.game_members gm on gm.game_id=gp.game_id
      and gm.user_id=gp.leader_user_id and gm.team=gp.name
      and gm.kind='student' and gm.roster_archived_at is null
    where gp.id=v_party and gp.game_id=e.game_id
      and gp.registration_status='registered'
  ) then raise exception 'Голосовать мандатами вправе руководитель зарегистрированной фракции';end if;
 end if;
 select coalesce(sum(effective_mandates),0)::integer into v_capacity
 from public.party_member_mandates where game_id=e.game_id and party_id=v_party;
 select coalesce(sum(votes),0)::integer into v_other
 from public.office_ballots where election_id=e.id and party_id=v_party and candidate_id<>p_candidate_id;
 if v_other+p_votes>v_capacity then raise exception 'Faction ballot exceeds current effective mandates'; end if;

 insert into public.office_ballots(election_id,game_id,party_id,candidate_id,votes,submitted_by)
 values(e.id,e.game_id,v_party,p_candidate_id,p_votes,v_uid)
 on conflict(election_id,party_id,candidate_id)
 do update set votes=excluded.votes,submitted_by=v_uid,updated_at=now();
 if e.stage_no=4 then
  perform private.auto_finish_faction_office_election_locked(e.id);
 end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_office_election(p_election_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare e public.office_elections%rowtype;winner record;c_count integer;v_runoff uuid;out_json jsonb;v_uid uuid:=(select auth.uid());v_cast integer;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if e.stage_no=4 THEN
  IF NOT private.gd_stage4_can_manage(e.game_id,v_uid,e.office_key) THEN
   raise exception 'Закрыть голосование вправе председатель заседания или преподаватель';END IF;
  IF NOT private.is_game_teacher(e.game_id) AND e.ballot_mode='personal' THEN
   SELECT coalesce(sum(private.gd_effective_present(e.game_id,b.voter_id,r.present_mandates)),0)::int
   INTO v_cast FROM public.office_personal_ballots b
    JOIN public.institution_session_registrations r ON r.game_id=e.game_id
     AND r.user_id=b.voter_id AND r.stage_no=4 AND r.institution_key='gd'
   WHERE b.election_id=e.id;
   IF v_cast<226 THEN raise exception
    'Для завершения голосования необходимо не менее 226 голосов депутатов';END IF;
  END IF;
 ELSIF NOT private.is_game_teacher(e.game_id) THEN
  raise exception 'Teacher access required';
 END IF;
 if e.status<>'open' then raise exception 'Election is not open'; end if;
 if private.office_has_confirmed_winner(e.game_id,e.office_key)
 then raise exception 'Должность уже занята; голосование прекращено';end if;

 return private.finish_office_election_locked(p_election_id);
end;
$function$;

CREATE OR REPLACE FUNCTION private.finish_office_election_locked(p_election_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 e public.office_elections%rowtype;
 winner record;
 c_count integer;
 v_runoff uuid;
 out_json jsonb;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null or e.status<>'open' then
  raise exception 'Election is not open';
 end if;
 if private.office_has_confirmed_winner(e.game_id,e.office_key)
 then raise exception 'Должность уже занята; повторный результат запрещён';end if;
 select c.id,c.user_id,private.office_candidate_vote_weight(e.id,c.id) votes
 into winner
 from public.office_candidates c
 where c.election_id=e.id
 
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
  insert into public.office_elections(game_id,stage_no,office_key,office_title,round_no,vote_mode,status,parent_election_id,created_by,ballot_mode)
  values(e.game_id,e.stage_no,e.office_key,e.office_title,2,e.vote_mode,'nomination',e.id,(select auth.uid()),e.ballot_mode)
  returning id into v_runoff;

  insert into public.office_candidates(election_id,game_id,user_id,party_id,nominated_by)
  select v_runoff,e.game_id,c.user_id,c.party_id,(select auth.uid())
  from public.office_candidates c
  
  where c.election_id=e.id
  
  order by private.office_candidate_vote_weight(e.id,c.id) desc,c.created_at
  limit 2;

  update public.office_elections set status='open',opened_at=now() where id=v_runoff;
  out_json:=jsonb_build_object('status','runoff','runoff_election_id',v_runoff);
 else
  out_json:=jsonb_build_object('status','no_winner','leader_candidate_id',winner.id,'leader_votes',coalesce(winner.votes,0));
 end if;
 return out_json;
end;
$function$;