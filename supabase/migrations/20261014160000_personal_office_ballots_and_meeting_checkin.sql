-- Parliamentary deputies cast exactly one weighted ballot each. Existing faction ballots stay readable.
-- Stage-specific meeting proposals require registration before they are submitted.
-- All rights are checked in PostgreSQL; the UI is not the security boundary.

alter table public.office_elections
 add column if not exists ballot_mode text not null default 'faction';
do $guard$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.office_elections'::regclass and conname='office_elections_ballot_mode_check') then
  alter table public.office_elections add constraint office_elections_ballot_mode_check check (ballot_mode in ('faction','personal'));
 end if;
end $guard$;

create table if not exists public.office_personal_ballots (
 election_id uuid not null references public.office_elections(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 voter_id uuid not null references auth.users(id) on delete cascade,
 party_id uuid not null references public.game_parties(id) on delete cascade,
 candidate_id uuid not null references public.office_candidates(id) on delete cascade,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(election_id,voter_id)
);
create index if not exists office_personal_ballots_game_election_idx on public.office_personal_ballots(game_id,election_id);
alter table public.office_personal_ballots enable row level security;
revoke all on public.office_personal_ballots from anon,authenticated;
grant select on public.office_personal_ballots to authenticated;
drop policy if exists office_personal_ballots_read on public.office_personal_ballots;
create policy office_personal_ballots_read on public.office_personal_ballots
 for select to authenticated using (
  private.is_game_member(game_id) and
  (voter_id=(select auth.uid()) or private.is_game_teacher(game_id)
   or exists(select 1 from public.office_elections e
    where e.id=election_id and e.game_id=game_id
    and (e.vote_mode='open' or e.status in ('closed','finished'))))
 );

create or replace function private.require_game_meeting_registration(p_game uuid,p_user uuid,p_stage integer,p_institution text)
returns void language plpgsql stable security definer
set search_path to 'public','private','pg_temp'
as $function$
begin
 if p_user is null or not exists (
  select 1 from public.game_members m where m.game_id=p_game and m.user_id=p_user
    and m.kind='student' and m.roster_archived_at is null
 ) then
  if p_user=(select auth.uid()) and private.is_game_teacher(p_game) then return;end if;
  raise exception 'Требуются полномочия действующего участника';
 end if;
 if not private.vote_member_has_office(p_game,p_user,p_institution) then
   raise exception 'Для этого органа отсутствуют полномочия';
 end if;
 if not exists (
  select 1 from public.institution_session_registrations r
  where r.game_id=p_game and r.user_id=p_user and r.stage_no=p_stage and r.institution_key=p_institution
 ) then
   raise exception 'Сначала зарегистрируйтесь на заседание органа: %',p_institution;
 end if;
end $function$;
revoke all on function private.require_game_meeting_registration(uuid,uuid,integer,text) from public,anon,authenticated;

-- No proxy voting: an authenticated deputy owns exactly one ballot per election.
create or replace function public.cast_personal_office_ballot(p_election_id uuid,p_candidate_id uuid)
returns void language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $function$
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
 perform private.require_game_meeting_registration(e.game_id,uid,e.stage_no,'gd');
 select pm.party_id,pm.effective_mandates into party,capacity
 from public.party_member_mandates pm join public.game_members gm
   on gm.game_id=pm.game_id and gm.user_id=pm.user_id
 join public.game_parties gp on gp.id=pm.party_id and gp.game_id=pm.game_id and gp.name=gm.team
 where pm.game_id=e.game_id and pm.user_id=uid and gm.kind='student'
   and gm.roster_archived_at is null and pm.effective_mandates>0
 for share of pm;
 if party is null or capacity<=0 then raise exception 'У вас нет действующих депутатских мандатов';end if;
 if not exists(select 1 from public.office_candidates c where c.id=p_candidate_id and c.election_id=e.id and c.game_id=e.game_id)
 then raise exception 'Кандидат не относится к этому голосованию';end if;
 insert into public.office_personal_ballots(election_id,game_id,voter_id,party_id,candidate_id)
 values(e.id,e.game_id,uid,party,p_candidate_id)
 on conflict(election_id,voter_id) do update set
   party_id=excluded.party_id,candidate_id=excluded.candidate_id,updated_at=now();
end $function$;
revoke execute on function public.cast_personal_office_ballot(uuid,uuid) from public,anon;
grant execute on function public.cast_personal_office_ballot(uuid,uuid) to authenticated;

-- Current effective mandates include all existing GV and representation deductions.
-- A vote is counted once even if several requests race; mandates are not duplicated.
create or replace function private.office_candidate_vote_weight(p_election uuid,p_candidate uuid)
returns integer language plpgsql stable security definer
set search_path to 'public','private','pg_temp'
as $function$
declare e public.office_elections%rowtype;v_result integer;
begin
 select * into e from public.office_elections where id=p_election;
 if e.id is null then return 0;end if;
 if e.ballot_mode='personal' then
  select coalesce(sum(pm.effective_mandates),0)::integer into v_result
  from public.office_personal_ballots b
  join public.party_member_mandates pm on pm.game_id=b.game_id and pm.party_id=b.party_id and pm.user_id=b.voter_id
  join public.game_members gm on gm.game_id=b.game_id and gm.user_id=b.voter_id and gm.kind='student'
    and gm.roster_archived_at is null
  join public.game_parties gp on gp.game_id=b.game_id and gp.id=b.party_id and gp.name=gm.team
  where b.election_id=p_election and b.candidate_id=p_candidate
   and exists(select 1 from public.institution_session_registrations r
       where r.game_id=e.game_id and r.stage_no=e.stage_no and r.user_id=b.voter_id and r.institution_key='gd');
 else
  select coalesce(sum(b.votes),0)::integer into v_result from public.office_ballots b
  where b.election_id=p_election and b.candidate_id=p_candidate;
 end if;
 return greatest(0,coalesce(v_result,0));
end $function$;
revoke all on function private.office_candidate_vote_weight(uuid,uuid) from public,anon,authenticated;

-- Prior to nominees, deputies decide whether to approve the leadership procedure.
create or replace function public.open_duma_leadership_procedure_vote(p_game_id uuid)
returns uuid language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $function$
declare v_id uuid;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Только преподаватель открывает процедуру';end if;
 perform 1 from public.games where id=p_game_id for update; -- serialize concurrent requests for the same preliminary vote
 select id into v_id from public.game_votes where game_id=p_game_id
  and stage_no=4 and procedure_key='gd_leadership_procedure'
  and status='open' order by opened_at desc limit 1;
 if v_id is not null then return v_id;end if;
 select id into v_id from public.game_votes where game_id=p_game_id
  and stage_no=4 and procedure_key='gd_leadership_procedure'
  and status='closed' and result_code='passed' order by opened_at desc limit 1;
 if v_id is not null then return v_id;end if;
 v_id:=public.create_procedural_vote(
 p_game_id,'Утверждение процедуры выборов руководства Государственной Думы',
 'Зарегистрированные депутаты голосуют о начале процедуры выдвижения и избрания руководства Государственной Думы.',
 'mandate','gd','gd_leadership_procedure','fraction',0.5,
 'eligible_majority',0.5,false,false,null,'none','none');
 return v_id;
end $function$;
revoke execute on function public.open_duma_leadership_procedure_vote(uuid) from public,anon;
grant execute on function public.open_duma_leadership_procedure_vote(uuid) to authenticated;

-- Preserve earlier SQL/RPC signatures and legacy ballots, patching only known definitions.
do $migration$
declare v_sql text;v_old text;
begin
 v_sql:=pg_get_functiondef('public.create_office_election(uuid,text,text)'::regprocedure);
 v_old:='if exists(select 1 from public.office_elections where game_id=p_game_id and office_key=p_office_key';
 if position(v_old in v_sql)=0 then raise exception 'Office creation procedure changed';end if;
 v_sql:=replace(v_sql,v_old,
  'if not exists(select 1 from public.game_votes where game_id=p_game_id and stage_no=4 and procedure_key=''gd_leadership_procedure'' and status=''closed'' and result_code=''passed'') then raise exception ''Сначала утвердите процедуру голосованием депутатов'';end if;'||chr(10)||' '||v_old);
 v_old:='(game_id,office_key,office_title,vote_mode,created_by)';
 if position(v_old in v_sql)=0 then raise exception 'Office insert changed';end if;
 v_sql:=replace(v_sql,v_old,'(game_id,office_key,office_title,vote_mode,created_by,ballot_mode)');
 v_old:='values(p_game_id,p_office_key,v_title,p_vote_mode,v_uid)';
 if position(v_old in v_sql)=0 then raise exception 'Office values changed';end if;
 v_sql:=replace(v_sql,v_old,'values(p_game_id,p_office_key,v_title,p_vote_mode,v_uid,''personal'')');
 execute v_sql;

 v_sql:=pg_get_functiondef('public.create_committee_chair_election(uuid,text)'::regprocedure);
 v_old:='(game_id,stage_no,office_key,office_title,round_no,vote_mode,status,created_by)';
 if position(v_old in v_sql)=0 then raise exception 'Committee election insert changed';end if;
 v_sql:=replace(v_sql,v_old,'(game_id,stage_no,office_key,office_title,round_no,vote_mode,status,created_by,ballot_mode)');
 v_old:='values(u.game_id,4,v_key,''Председатель · ''||u.title,1,p_vote_mode,''nomination'',v_uid)';
 if position(v_old in v_sql)=0 then raise exception 'Committee election values changed';end if;
 v_sql:=replace(v_sql,v_old,'values(u.game_id,4,v_key,''Председатель · ''||u.title,1,p_vote_mode,''nomination'',v_uid,''personal'')');
 v_old:='if p_vote_mode is null or p_vote_mode not in (''open'',''secret'')';
 if position(v_old in v_sql)=0 then raise exception 'Committee mode gate changed';end if;
 v_sql:=replace(v_sql,v_old,
  'if not private.is_game_teacher(u.game_id) then perform private.require_game_meeting_registration(u.game_id,v_uid,4,''gd'');end if;'||chr(10)||' '||v_old);
 execute v_sql;

 v_sql:=pg_get_functiondef('public.nominate_office_candidate(uuid,uuid)'::regprocedure);
 v_old:='v_party:=private.party_led_by(e.game_id,v_uid);';
 if position(v_old in v_sql)=0 then raise exception 'Nomination access changed';end if;
 v_sql:=replace(v_sql,v_old,
  'if not private.is_game_teacher(e.game_id) then perform private.require_game_meeting_registration(e.game_id,v_uid,e.stage_no,''gd'');end if;'||chr(10)||' '||v_old);
 execute v_sql;

 v_sql:=pg_get_functiondef('public.set_office_ballot(uuid,uuid,integer)'::regprocedure);
 v_old:='if e.status<>''open'' then raise exception ''Election is not open''; end if;';
 if position(v_old in v_sql)=0 then raise exception 'Legacy faction ballot function changed';end if;
 v_sql:=replace(v_sql,v_old,v_old||chr(10)||
 ' if e.ballot_mode<>''faction'' then raise exception ''Используйте персональный бюллетень депутата'';end if;');
 execute v_sql;

 v_sql:=pg_get_functiondef('public.close_office_election(uuid)'::regprocedure);
 v_old:='select c.id,c.user_id,coalesce(sum(b.votes),0)::integer votes';
 if position(v_old in v_sql)=0 then raise exception 'Office count changed';end if;
 v_sql:=replace(v_sql,v_old,'select c.id,c.user_id,private.office_candidate_vote_weight(e.id,c.id) votes');
 v_old:='from public.office_candidates c left join public.office_ballots b on b.candidate_id=c.id and b.election_id=e.id';
 if position(v_old in v_sql)=0 then raise exception 'Office winner query changed';end if;
 v_sql:=replace(v_sql,v_old,'from public.office_candidates c');
 v_old:='group by c.id,c.user_id,c.party_id';
 if position(v_old in v_sql)=0 then raise exception 'Office runoff grouping changed';end if;
 v_sql:=replace(v_sql,v_old,'');
  v_old:='group by c.id,c.user_id';
 if position(v_old in v_sql)=0 then raise exception 'Office winner grouping changed';end if;
 v_sql:=replace(v_sql,v_old,'');
 v_old:='values(e.game_id,e.stage_no,e.office_key,e.office_title,2,e.vote_mode,''nomination'',e.id,(select auth.uid()))';
 if position(v_old in v_sql)=0 then raise exception 'Office runoff values changed';end if;
 v_sql:=replace(v_sql,v_old,'values(e.game_id,e.stage_no,e.office_key,e.office_title,2,e.vote_mode,''nomination'',e.id,(select auth.uid()),e.ballot_mode)');
 v_old:='(game_id,stage_no,office_key,office_title,round_no,vote_mode,status,parent_election_id,created_by)';
 if position(v_old in v_sql)=0 then raise exception 'Office runoff insert changed';end if;
 v_sql:=replace(v_sql,v_old,'(game_id,stage_no,office_key,office_title,round_no,vote_mode,status,parent_election_id,created_by,ballot_mode)');
 v_old:='left join public.office_ballots b on b.candidate_id=c.id and b.election_id=e.id';
 if position(v_old in v_sql)=0 then raise exception 'Office runoff join changed';end if;
 v_sql:=replace(v_sql,v_old,'');
 v_old:='order by coalesce(sum(b.votes),0) desc,c.created_at';
 if position(v_old in v_sql)=0 then raise exception 'Office runoff sorting changed';end if;
 v_sql:=replace(v_sql,v_old,'order by private.office_candidate_vote_weight(e.id,c.id) desc,c.created_at');
 execute v_sql;

 v_sql:=pg_get_functiondef('public.add_duma_agenda_item(uuid,uuid)'::regprocedure);
 v_old:='if s.status<>''draft'' then raise exception ''Agenda can be changed only before the session opens''; end if;';
 if position(v_old in v_sql)=0 then raise exception 'Duma agenda permissions changed';end if;
 v_sql:=replace(v_sql,v_old,
 'if not private.is_game_teacher(s.game_id) then perform private.require_game_meeting_registration(s.game_id,v_uid,s.stage_no,''gd'');end if;'||chr(10)||' '||v_old);
 execute v_sql;

 v_sql:=pg_get_functiondef('public.set_duma_agenda_item_status(uuid,text,text)'::regprocedure);
 v_old:='if s.status<>''open'' then raise exception ''Заседание не открыто'';end if;';
 if position(v_old in v_sql)=0 then raise exception 'Duma discussion permissions changed';end if;
 v_sql:=replace(v_sql,v_old,
 'if not private.is_game_teacher(i.game_id) then perform private.require_game_meeting_registration(i.game_id,v_uid,s.stage_no,''gd'');end if;'||chr(10)||' '||v_old);
 execute v_sql;

 v_sql:=pg_get_functiondef('public.open_process_vote(uuid,text,text)'::regprocedure);
 v_old:='q:=case when p_institution_key in (''all'',''vs'',''accounts'')';
 if position(v_old in v_sql)=0 then raise exception 'Political process voting route changed';end if;
 v_sql:=replace(v_sql,v_old,
 'if p_institution_key not in (''all'',''factions'') and not private.is_game_teacher(p.game_id) then perform private.require_game_meeting_registration(p.game_id,(select auth.uid()),(select current_round from public.games where id=p.game_id),p_institution_key);end if;'||chr(10)||' '||v_old);
 execute v_sql;

 -- A Government agenda is also a meeting proposal, never an unregistered action.
 v_sql:=pg_get_functiondef('public.add_government_session_question(uuid,text,text,integer,uuid)'::regprocedure);
 v_old:='if s.status<>''draft'' then raise exception ''Повестка закрыта для редактирования''; end if;';
 if position(v_old in v_sql)=0 then raise exception 'Government agenda procedure changed';end if;
 v_sql:=replace(v_sql,v_old,
  'if not private.is_game_teacher(s.game_id) then perform private.require_game_meeting_registration(s.game_id,v_uid,s.stage_no,''government'');end if;'||chr(10)||' '||v_old);
 execute v_sql;

 v_sql:=pg_get_functiondef('public.update_government_session_question(uuid,text,text,integer)'::regprocedure);
 v_old:='if length(btrim(coalesce(p_title,';
 if position(v_old in v_sql)=0 then raise exception 'Government agenda update changed';end if;
 v_sql:=replace(v_sql,v_old,
  'if not private.is_game_teacher(q.game_id) then perform private.require_game_meeting_registration(q.game_id,(select auth.uid()),s.stage_no,''government'');end if;'||chr(10)||' '||v_old);
 execute v_sql;

 v_sql:=pg_get_functiondef('public.set_government_session_question_discussed(uuid)'::regprocedure);
 v_old:='if q.program_agenda_id is not null then';
 if position(v_old in v_sql)=0 then raise exception 'Government discussion changed';end if;
 v_sql:=replace(v_sql,v_old,
  'if not private.is_game_teacher(q.game_id) then perform private.require_game_meeting_registration(q.game_id,(select auth.uid()),s.stage_no,''government'');end if;'||chr(10)||' '||v_old);
 execute v_sql;
end $migration$;

-- Assign additional office powers to elected leaders without changing their existing office.
create or replace function private.capture_parliament_office_winner()
returns trigger language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $function$
declare v_user uuid;v_title text;
begin
 if new.status='finished' and new.winner_candidate_id is not null
   and (old.status is distinct from new.status or old.winner_candidate_id is distinct from new.winner_candidate_id)
 then
  select user_id into v_user from public.office_candidates where id=new.winner_candidate_id and election_id=new.id;
  if v_user is null then return new;end if;
  v_title:=case new.office_key
   when 'gd_chair' then 'Председатель Государственной Думы'
   when 'gd_deputy_1' then 'Заместитель Председателя Государственной Думы №1'
   when 'gd_deputy_2' then 'Заместитель Председателя Государственной Думы №2'
   else new.office_title end;
  insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
  values(new.game_id,v_user,v_title,'active',new.created_by,new.created_by,'Избран решением Государственной Думы',false)
  on conflict(game_id,user_id,role_title) where status<>'ended'
   do update set status='active',legal_basis=excluded.legal_basis,educational_exception=false;
 end if;
 return new;
end $function$;
drop trigger if exists trg_capture_parliament_office_winner on public.office_elections;
create trigger trg_capture_parliament_office_winner
 after update of status,winner_candidate_id on public.office_elections
 for each row execute function private.capture_parliament_office_winner();

-- These tables previously were not in the Realtime publication: keep all
-- 30 participants' parliamentary choices and current mandate weights in sync.
do $realtime$
declare v_name text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach v_name in array array[
   'office_elections','office_candidates','office_ballots','office_personal_ballots',
   'party_member_mandates','institution_session_registrations'
  ] loop
   if not exists(select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename=v_name) then
    execute format('alter publication supabase_realtime add table public.%I',v_name);
   end if;
  end loop;
 end if;
end $realtime$;
