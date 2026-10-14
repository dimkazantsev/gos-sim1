-- Stage 1 is writable only while the stage AND the game's global turn are open.
-- Invitations must be accepted before the chair election; only active students vote.
-- Keep historic results intact, including already elected chairs.
do $migration$
declare source text;old_text text;new_text text;
begin
 select pg_get_functiondef('public.found_game_party(uuid,text,text)'::regprocedure) into source;
 old_text:='if not found or v_m.kind not in (''student'',''teacher'') or v_m.roster_archived_at is not null then';
 new_text:='if not found or v_m.kind<>''student'' or v_m.roster_archived_at is not null then';
 if position(old_text in source)=0 then raise exception 'found_game_party actor guard changed';end if;
 source:=replace(source,old_text,new_text);
 old_text:='v_teacher:=v_m.kind=''teacher'' and private.is_game_teacher(p_game);';
 new_text:='v_teacher:=false;';
 if position(old_text in source)=0 then raise exception 'found_game_party branch changed';end if;
 source:=replace(source,old_text,new_text);
 old_text:='not exists(select 1 from public.game_stages s where s.game_id=p_game and s.stage_no=1 and s.status=''open''';
 new_text:='not exists(select 1 from public.games g join public.game_stages s on s.game_id=g.id where g.id=p_game and g.turn_open=true and s.stage_no=1 and s.status=''open''';
 if position(old_text in source)=0 then raise exception 'found_game_party stage anchor changed';end if;
 source:=replace(source,old_text,new_text);
 execute source;

 select pg_get_functiondef('public.invite_to_party(uuid,uuid)'::regprocedure) into source;
 old_text:='if actor.roster_archived_at is not null or not (private.is_game_teacher(p.game_id) or (actor.kind=''student'' and actor.team=p.name))';
 new_text:='if actor.roster_archived_at is not null or not (actor.kind=''student'' and actor.team=p.name)';
 if position(old_text in source)=0 then raise exception 'invite_to_party actor guard changed';end if;
 source:=replace(source,old_text,new_text);
 old_text:='if not private.is_game_teacher(p.game_id) and' || chr(10) ||
  '  not exists(select 1 from public.game_stages s where s.game_id=p.game_id and s.stage_no=1 and s.status=''open''';
 new_text:='if' || chr(10) ||
  '  not exists(select 1 from public.games g join public.game_stages s on s.game_id=g.id where g.id=p.game_id and g.turn_open=true and s.stage_no=1 and s.status=''open''';
 if position(old_text in source)=0 then raise exception 'invite_to_party stage anchor changed';end if;
 source:=replace(source,old_text,new_text);
 old_text:='select * into gm from public.game_members where game_id=p.game_id and user_id=p_user_id;';
 new_text:='if p.leader_user_id is not null or exists(select 1 from public.party_chair_ballots b where b.party_id=p.id) then raise exception ''Приглашения завершаются до начала выборов председателя.'' using errcode=''42501'';end if;' || chr(10) ||
  ' '||old_text;
 if position(old_text in source)=0 then raise exception 'invite_to_party voting anchor changed';end if;
 source:=replace(source,old_text,new_text);
 execute source;

 select pg_get_functiondef('public.vote_for_party_chair(uuid,uuid)'::regprocedure) into source;
 old_text:='if not exists(select 1 from public.game_stages where game_id=p.game_id and stage_no=1 and status=''open''';
 new_text:='if not exists(select 1 from public.games g join public.game_stages s on s.game_id=g.id where g.id=p.game_id and g.turn_open=true and s.stage_no=1 and s.status=''open''';
 if position(old_text in source)=0 then raise exception 'vote_for_party_chair stage anchor changed';end if;
 source:=replace(source,old_text,new_text);
 old_text:='if p.leader_user_id is not null then raise exception';
 new_text:='if (select count(*) from public.game_members gm where gm.game_id=p.game_id and gm.kind=''student'' and gm.team=p.name and gm.roster_archived_at is null)<2 then raise exception ''До выборов в партию должен вступить хотя бы один приглашённый участник.'' using errcode=''42501'';end if;' || chr(10) ||
  ' if exists(select 1 from public.party_invitations i where i.party_id=p.id and i.status=''pending'') then raise exception ''Дождитесь ответов на приглашения или отмените ожидающие.'' using errcode=''42501'';end if;' || chr(10) ||
  ' '||old_text;
 if position(old_text in source)=0 then raise exception 'vote_for_party_chair quorum anchor changed';end if;
 source:=replace(source,old_text,new_text);
 execute source;

 select pg_get_functiondef('public.respond_party_invitation(uuid,boolean)'::regprocedure) into source;
 old_text:='if gm.user_id is null then raise exception ''Game member not found'';end if;';
 new_text:='if gm.user_id is null or gm.kind<>''student'' or gm.roster_archived_at is not null then raise exception ''Только действующий участник может принять приглашение.'' using errcode=''42501'';end if;' || chr(10) ||
  ' if not exists(select 1 from public.games g join public.game_stages s on s.game_id=g.id where g.id=inv.game_id and g.turn_open=true and s.stage_no=1 and s.status=''open'' and (s.deadline is null or s.deadline>clock_timestamp())) then raise exception ''Первый этап сейчас закрыт.'' using errcode=''42501'';end if;' || chr(10) ||
  ' if p.leader_user_id is not null then raise exception ''Выборы председателя уже завершены.'' using errcode=''42501'';end if;';
 if position(old_text in source)=0 then raise exception 'respond_party_invitation actor anchor changed';end if;
 source:=replace(source,old_text,new_text);
 execute source;
end
$migration$;

-- The shared trigger already prevents student dossier upload before elections.
-- Add the global pause to the existing stage constraint for direct table writes.
create or replace function private.guard_stage_submission()
returns trigger language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $fn$
declare v_game uuid:=case when tg_op='DELETE' then old.game_id else new.game_id end;
v_stage integer;
begin
 if auth.uid() is null or private.is_game_teacher(v_game) then
  if tg_op='DELETE' then return old;end if;
  return new;
 end if;
 if tg_table_name in ('party_documents','party_invitations') then
  v_stage:=1;
 elsif tg_table_name='formal_documents' then
  v_stage:=case when tg_op='DELETE' then old.stage_no else new.stage_no end;
 else raise exception 'Unsupported stage guard' using errcode='22023';
 end if;
 if tg_table_name='party_documents' and tg_op='INSERT' and not exists(
  select 1 from public.game_parties p where p.id=new.party_id and p.game_id=v_game
   and p.leader_user_id is not null
 ) then raise exception 'Сначала изберите председателя партии.' using errcode='42501';end if;
 if not exists(select 1 from public.game_members gm where gm.game_id=v_game
  and gm.user_id=auth.uid() and gm.kind='student' and gm.roster_archived_at is null)
 then raise exception 'Student membership required' using errcode='42501';end if;
 if not exists(select 1 from public.games g join public.game_stages st on st.game_id=g.id
   where g.id=v_game and g.turn_open=true and st.stage_no=v_stage and st.status='open'
    and (st.deadline is null or st.deadline>clock_timestamp()))
 then raise exception 'Этап завершён, приостановлен или ещё не открыт.' using errcode='42501';end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $fn$;
