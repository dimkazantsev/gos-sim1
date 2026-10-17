-- Meeting agenda and attendance precede KSRF stage 2/3 work.
-- Existing votes and decisions are untouched; teacher retains administrative access.
CREATE OR REPLACE FUNCTION private.require_game_meeting_registration(p_game uuid, p_user uuid, p_stage integer, p_institution text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
 -- The old games may contain attendance records created without any agenda.
 -- Attendance alone must never unlock KSRF proceedings on stages 2 or 3.
 if p_institution='ksrf' and p_stage in (2,3) and not exists(
   select 1 from public.institution_meeting_records m
   join public.formal_documents d on d.game_id=m.game_id and d.id=m.agenda_document_id
   where m.game_id=p_game and m.stage_no=p_stage and m.institution_key='ksrf'
     and m.agenda_approved_at is not null and d.status_code='published'
     and length(btrim(coalesce(m.agenda_body,'')))>=30
 ) then
   raise exception 'Сначала составьте и утвердите повестку заседания КСРФ';
 end if;
 if not exists (
  select 1 from public.institution_session_registrations r
  where r.game_id=p_game and r.user_id=p_user and r.stage_no=p_stage and r.institution_key=p_institution
 ) then
   raise exception 'Сначала зарегистрируйтесь на заседание органа: %',p_institution;
 end if;
end $function$;

CREATE OR REPLACE FUNCTION public.propose_parliamentary_election_rule(p_game_id uuid, p_system_type text, p_allocation_method text DEFAULT NULL::text, p_majoritarian_method text DEFAULT NULL::text, p_proportional_share integer DEFAULT NULL::integer, p_rationale text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_id uuid;
begin
 if v_uid is null or not private.can_propose_ksrf(p_game_id,v_uid) then raise exception 'Faction leader / teacher access required'; end if;
 if not private.is_game_teacher(p_game_id) then
  perform private.require_game_meeting_registration(p_game_id,v_uid,2,'ksrf');
 end if;
 if p_system_type not in ('proportional','majoritarian','mixed') then raise exception 'Unsupported electoral system'; end if;
 if p_system_type in ('proportional','mixed') and p_allocation_method not in ('hare','droop','dhondt','sainte_lague','imperiali') then raise exception 'Choose a quota or divisor allocation method'; end if;
 if p_system_type in ('majoritarian','mixed') and p_majoritarian_method not in ('plurality','absolute_two_round') then raise exception 'Choose a majoritarian rule'; end if;
 if p_system_type='mixed' and (p_proportional_share is null or p_proportional_share<=0 or p_proportional_share>=100) then raise exception 'Mixed system requires a proportional share from 1 to 99'; end if;
 insert into public.parliamentary_election_rules(game_id,system_type,allocation_method,majoritarian_method,proportional_share,rationale,proposed_by)
 values(p_game_id,p_system_type,p_allocation_method,p_majoritarian_method,p_proportional_share,nullif(trim(coalesce(p_rationale,'')),''),v_uid)
 returning id into v_id;
 return v_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.propose_regional_election_rule(p_game_id uuid, p_method text, p_rationale text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_id uuid;
begin
 if v_uid is null or not private.can_propose_ksrf(p_game_id,v_uid) then raise exception 'Faction leader / teacher access required'; end if;
 if not private.is_game_teacher(p_game_id) then
  perform private.require_game_meeting_registration(p_game_id,v_uid,3,'ksrf');
 end if;
 if p_method not in ('random','proportional','agreement') then raise exception 'Unsupported regional allocation method'; end if;
 insert into public.regional_election_rules(game_id,method,rationale,proposed_by)
 values(p_game_id,p_method,nullif(trim(coalesce(p_rationale,'')),''),v_uid) returning id into v_id;
 return v_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.open_parliamentary_rule_vote(p_rule_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.parliamentary_election_rules%rowtype;v_uid uuid:=auth.uid();
begin
 select * into p from public.parliamentary_election_rules where id=p_rule_id;
 if p.id is null then raise exception 'Проект не найден';end if;
 if v_uid is null or not private.can_propose_ksrf(p.game_id,v_uid) then raise exception 'Нет полномочий КСРФ';end if;
 if not private.is_game_teacher(p.game_id) then
  perform private.require_game_meeting_registration(p.game_id,v_uid,2,'ksrf');
 end if;
 perform 1 from public.games where id=p.game_id for update;
 select * into p from public.parliamentary_election_rules where id=p_rule_id for update;
 if p.status='vote_open' then return p.vote_id;end if;
 if p.status<>'draft' then raise exception 'Проект уже рассмотрен';end if;
 if exists(select 1 from public.parliamentary_election_rules where game_id=p.game_id and status='adopted') then
  raise exception 'Решение уже принято; вернуть вопрос вправе преподаватель';end if;
 if p.queued_at is not null then return null;end if;
 if exists(select 1 from public.game_votes where game_id=p.game_id and status='open' and procedure_key='electoral_system')
 or exists(select 1 from public.parliamentary_election_rules where game_id=p.game_id and status='draft' and queued_at is not null) then
  update public.parliamentary_election_rules set queued_at=now(),updated_at=now() where id=p.id;
  if not exists(select 1 from public.game_votes where game_id=p.game_id and status='open' and procedure_key='electoral_system') then
   perform private.activate_next_ksrf_proposal(p.game_id,'electoral_system');
  end if;
  return null;
 end if;
 return private.activate_ksrf_proposal(p.game_id,'electoral_system',p.id);
end;$function$;

CREATE OR REPLACE FUNCTION public.open_regional_rule_vote(p_rule_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.regional_election_rules%rowtype;v_uid uuid:=auth.uid();
begin
 select * into p from public.regional_election_rules where id=p_rule_id;
 if p.id is null then raise exception 'Проект не найден';end if;
 if v_uid is null or not private.can_propose_ksrf(p.game_id,v_uid) then raise exception 'Нет полномочий КСРФ';end if;
 if not private.is_game_teacher(p.game_id) then
  perform private.require_game_meeting_registration(p.game_id,v_uid,3,'ksrf');
 end if;
 perform 1 from public.games where id=p.game_id for update;
 select * into p from public.regional_election_rules where id=p_rule_id for update;
 if p.status='vote_open' then return p.vote_id;end if;
 if p.status<>'draft' then raise exception 'Проект уже рассмотрен';end if;
 if exists(select 1 from public.regional_election_rules where game_id=p.game_id and status in ('adopted','allocated')) then
  raise exception 'Решение уже принято; вернуть вопрос вправе преподаватель';end if;
 if p.queued_at is not null then return null;end if;
 if exists(select 1 from public.game_votes where game_id=p.game_id and status='open' and procedure_key='regional_system')
 or exists(select 1 from public.regional_election_rules where game_id=p.game_id and status='draft' and queued_at is not null) then
  update public.regional_election_rules set queued_at=now(),updated_at=now() where id=p.id;
  if not exists(select 1 from public.game_votes where game_id=p.game_id and status='open' and procedure_key='regional_system') then
   perform private.activate_next_ksrf_proposal(p.game_id,'regional_system');
  end if;
  return null;
 end if;
 return private.activate_ksrf_proposal(p.game_id,'regional_system',p.id);
end;$function$;

