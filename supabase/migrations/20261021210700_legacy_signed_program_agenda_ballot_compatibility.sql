-- Compatibility for an unsigned new workflow and a historically signed programme with an empty open ballot.
-- No existing signature, ballot, post, vote or programme row is modified by this migration.
CREATE OR REPLACE FUNCTION public.add_program_to_government_agenda(p_session_id uuid, p_program_id uuid, p_report_minutes integer DEFAULT 7)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype;p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Government session not found'; end if;
 if not private.can_manage_government_session(s.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'draft' then raise exception 'Agenda is locked after the session opens'; end if;
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null or p.game_id<>s.game_id then
  raise exception 'Государственная программа не принадлежит этому заседанию'; end if;
 if not (
  (p.status='ready' and p.signed_at is null)
  or (
    p.status='government_vote' and p.signed_at is not null and p.government_vote_id is not null
    and exists(select 1 from public.game_votes v where v.id=p.government_vote_id
       and v.game_id=p.game_id and v.status='open' and v.stage_no=11
       and v.procedure_key='state_program' and v.institution_key='government')
    and not exists(select 1 from public.game_ballots b where b.vote_id=p.government_vote_id)
    and not exists(select 1 from public.government_program_agenda a where a.program_id=p.id)
  )
 ) then raise exception 'Для включения необходима согласованная программа без незавершённых или повторных голосований'; end if;
 select coalesce(max(agenda_no),0)+1 into v_no from public.government_program_agenda where session_id=s.id;
 insert into public.government_program_agenda(session_id,game_id,program_id,agenda_no,report_minutes)
 values(s.id,s.game_id,p.id,v_no,greatest(1,least(60,p_report_minutes))) returning id into v_id;
 return v_id;
end;$function$
;

CREATE OR REPLACE FUNCTION public.open_program_vote_from_agenda(p_item_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare i public.government_program_agenda%rowtype;s public.government_sessions%rowtype;p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;
begin
 select * into i from public.government_program_agenda where id=p_item_id for update;
 if i.id is null then raise exception 'Agenda item not found'; end if;
 select * into s from public.government_sessions where id=i.session_id;
 if not private.can_manage_government_session(i.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'open' or i.status<>'presenting' then raise exception 'Complete presentation before opening the decision'; end if;
 select * into p from public.state_programs where id=i.program_id and game_id=i.game_id for update;
 if p.status='government_vote' and p.signed_at is not null and p.government_vote_id is not null then
  -- Legacy signature/post must remain untouched. Reuse ONE still-empty official ballot.
  select v.id into v_vote from public.game_votes v
  where v.id=p.government_vote_id and v.game_id=i.game_id
    and v.stage_no=11 and v.institution_key='government'
    and v.procedure_key='state_program' and v.status='open'
    and not exists(select 1 from public.game_ballots b where b.vote_id=v.id)
  for update;
  if v_vote is null then raise exception 'Ранее открытое голосование уже использовано или закрыто'; end if;
 else
  perform set_config('app.gos_program_agenda_item',i.id::text,true);
  v_vote:=public.open_state_program_government_vote(i.program_id);
  perform set_config('app.gos_program_agenda_item','',true);
 end if;
 update public.government_program_agenda set status='decision',vote_id=v_vote where id=i.id;
 return v_vote;
end;$function$
;

CREATE OR REPLACE FUNCTION public.cast_vote_allocation(p_vote_id uuid, p_yes numeric, p_no numeric, p_abstain numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v public.game_votes%rowtype;uid uuid:=auth.uid();allowed numeric;total numeric;choice text;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if uid is null or v.id is null or not private.is_game_member(v.game_id) then raise exception 'Нет доступа к голосованию';end if;
 if v.status<>'open' then raise exception 'Голосование завершено';end if;
 if v.procedure_key='state_program' and not exists(
   select 1 from public.government_program_agenda a
   join public.government_sessions s on s.id=a.session_id and s.game_id=a.game_id
   where a.game_id=v.game_id and a.vote_id=v.id and a.status='decision'
     and s.status='open' and s.stage_no=11
 ) then raise exception 'Голосование по программе доступно после доклада на заседании Правительства';end if;
 allowed:=private.vote_eligible_weight(v,uid);
 total:=p_yes+p_no+p_abstain;
 if p_yes is null or p_no is null or p_abstain is null or p_yes<0 or p_no<0 or p_abstain<0 or total<=0
 or p_yes<>trunc(p_yes) or p_no<>trunc(p_no) or p_abstain<>trunc(p_abstain) or total>allowed then raise exception 'Число голосов должно быть целым и не превышать ваш доступный пакет: %',allowed;end if;
 if v.voting_mode<>'mandate' and (total<>1 or greatest(p_yes,p_no,p_abstain)<>1) then raise exception 'В этой процедуре у участника один неделимый голос';end if;
 if not v.allow_abstain and p_abstain>0 then raise exception 'Воздержание в этой процедуре не предусмотрено';end if;
 choice:=case when p_yes>=p_no and p_yes>=p_abstain then 'yes' when p_no>=p_abstain then 'no' else 'abstain' end;
 insert into public.game_ballots(vote_id,voter_id,choice,weight,yes_weight,no_weight,abstain_weight)
 values(v.id,uid,choice,total,p_yes,p_no,p_abstain) on conflict(vote_id,voter_id) do update set choice=excluded.choice,weight=excluded.weight,yes_weight=excluded.yes_weight,no_weight=excluded.no_weight,abstain_weight=excluded.abstain_weight;
end;$function$
;