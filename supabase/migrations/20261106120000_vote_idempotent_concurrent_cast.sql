-- ГОС.ID: one physical write for an unchanged ballot, even under duplicate requests.
-- Existing unique key (vote_id,voter_id), role/weight rules, vote-row lock,
-- closing triggers and Realtime private pulses remain intact.
-- Different choices remain permissible only while the vote is open.
-- No new index, table, timer or network channel.
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
 if v.status<>'open' then
  -- Exact retry of an already recorded choice: no new write and no new result.
  -- A different choice after closure remains forbidden.
  if exists(select 1 from public.game_ballots b
    where b.vote_id=v.id and b.voter_id=uid
     and b.yes_weight is not distinct from p_yes
     and b.no_weight is not distinct from p_no
     and b.abstain_weight is not distinct from p_abstain
     and b.weight is not distinct from (p_yes+p_no+p_abstain)
  ) then return; end if;
  raise exception 'Голосование завершено';
 end if;
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
 values(v.id,uid,choice,total,p_yes,p_no,p_abstain)
 on conflict(vote_id,voter_id) do update set
  choice=excluded.choice,weight=excluded.weight,
  yes_weight=excluded.yes_weight,no_weight=excluded.no_weight,
  abstain_weight=excluded.abstain_weight
 where (game_ballots.choice,game_ballots.weight,
        game_ballots.yes_weight,game_ballots.no_weight,game_ballots.abstain_weight)
    is distinct from
       (excluded.choice,excluded.weight,
        excluded.yes_weight,excluded.no_weight,excluded.abstain_weight);
end;$function$;
