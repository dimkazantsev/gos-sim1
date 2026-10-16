-- Only localize newly generated KSRF voting descriptions.
-- Preserve proposer identity, registration gates, queueing, voting weights,
-- transitions, decision thresholds and every pre-existing vote record.
-- Source: production definition of private.activate_ksrf_proposal (17.10.2026).
CREATE OR REPLACE FUNCTION private.activate_ksrf_proposal(p_game uuid, p_question text, p_proposal uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.parliamentary_election_rules%rowtype;
 r public.regional_election_rules%rowtype;
 v_id uuid;v_body text;v_author uuid;v_stage integer;
begin
 if p_question not in ('electoral_system','regional_system') then raise exception 'Неизвестный вопрос КСРФ';end if;
 if exists(select 1 from public.game_votes where game_id=p_game and procedure_key=p_question and status='open') then
  raise exception 'По вопросу уже идёт голосование';
 end if;
 v_stage:=case when p_question='electoral_system' then 2 else 3 end;
 if p_question='electoral_system' then
  if exists(select 1 from public.parliamentary_election_rules where game_id=p_game and status='adopted') then
   raise exception 'Решение по вопросу уже принято';end if;
  select * into p from public.parliamentary_election_rules where id=p_proposal and game_id=p_game and status='draft' for update;
  if p.id is null then raise exception 'Проект недоступен';end if;
  v_author:=p.proposed_by;
  v_body:='Система: '||(case p.system_type
   when 'proportional' then 'Пропорциональная'
   when 'majoritarian' then 'Мажоритарная'
   when 'mixed' then 'Смешанная' else p.system_type end)
   ||coalesce('. Метод распределения мандатов: '||(case p.allocation_method
     when 'hare' then 'Квота Хэйра (наибольшие остатки)'
     when 'droop' then 'Квота Друпа (наибольшие остатки)'
     when 'dhondt' then 'Метод Д’Ондта'
     when 'sainte_lague' then 'Метод Сент-Лагю'
     when 'imperiali' then 'Метод Империали'
     else p.allocation_method end),'')
   ||coalesce('. Правило определения победителя: '||(case p.majoritarian_method
     when 'plurality' then 'Относительное большинство'
     when 'absolute_two_round' then 'Абсолютное большинство, два тура'
     else p.majoritarian_method end),'')
   ||coalesce('. Доля пропорционального распределения: '||p.proportional_share||'%','')
   ||coalesce('. Обоснование: '||upper(left(btrim(p.rationale),1))||substr(btrim(p.rationale),2),'');
 else
  if exists(select 1 from public.regional_election_rules where game_id=p_game and status in ('adopted','allocated')) then
   raise exception 'Решение по вопросу уже принято';end if;
  select * into r from public.regional_election_rules where id=p_proposal and game_id=p_game and status='draft' for update;
  if r.id is null then raise exception 'Проект недоступен';end if;
  v_author:=r.proposed_by;
  v_body:='Способ распределения субъектов Российской Федерации: '||(case r.method
   when 'random' then 'Жеребьёвка'
   when 'proportional' then 'Пропорционально числу мандатов Государственной Думы'
   when 'agreement' then 'По соглашению фракций'
   else r.method end)
   ||coalesce('. Обоснование: '||upper(left(btrim(r.rationale),1))||substr(btrim(r.rationale),2),'');
 end if;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,
   institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,
   allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(p_game,v_stage,
  case when p_question='electoral_system' then 'КСРФ · избирательная система'
       else 'КСРФ · метод распределения субъектов РФ' end,
  v_body,'faction','open',v_author,'ksrf',p_question,'fraction',0.5,'eligible_majority',0.5,
  true,false,'none','none') returning id into v_id;
 if p_question='electoral_system' then
  update public.parliamentary_election_rules set vote_id=v_id,status='vote_open',queued_at=null,
   rejection_reason=null,updated_at=now() where id=p_proposal;
 else
  update public.regional_election_rules set vote_id=v_id,status='vote_open',queued_at=null,
   rejection_reason=null,updated_at=now() where id=p_proposal;
 end if;
 return v_id;
end;$function$

