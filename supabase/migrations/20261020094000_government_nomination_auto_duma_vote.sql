-- ГОС.ID. Думское голосование создаётся автоматически в той же транзакции,
-- в которой уполномоченное лицо вносит кандидатуру (этапы 8 и 9).
-- Права выдвижения, требования регистрации депутатов, кворум, RLS и итоги не меняются.
CREATE OR REPLACE FUNCTION private.ensure_government_nomination_vote(p_nomination_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $auto$
DECLARE
 n public.government_nominations%rowtype;
 v_vote uuid;
BEGIN
 SELECT * INTO n FROM public.government_nominations
 WHERE id=p_nomination_id FOR UPDATE;
 IF n.id IS NULL THEN RAISE EXCEPTION 'Кандидатура не найдена'; END IF;
 IF n.vote_id IS NOT NULL THEN RETURN n.vote_id; END IF;
 IF n.route NOT IN ('president_to_duma','pm_to_duma')
    OR n.status<>'submitted' THEN
  RAISE EXCEPTION 'Голосование допускается только по внесённой кандидатуре для Государственной Думы';
 END IF;
 IF n.stage_no NOT IN (8,9)
   OR NOT EXISTS (
    SELECT 1 FROM public.game_stages s
    WHERE s.game_id=n.game_id AND s.stage_no=n.stage_no AND s.status='open'
      AND (s.deadline IS NULL OR s.deadline>clock_timestamp())
   ) THEN
   RAISE EXCEPTION 'Этап внесения кандидатуры не открыт';
 END IF;
 -- row lock не позволяет двум параллельным запросам создать второй голос.
 INSERT INTO public.game_votes(
  game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,
  pass_transition,fail_transition,formal_document_id,formal_step_code
 ) VALUES(
  n.game_id,n.stage_no,'Утверждение кандидатуры · '||n.office_title,
  n.candidate_name||'. Для принятия решения требуется большинство от общего числа депутатов Государственной Думы.',
  'mandate','open',n.nominated_by,'gd','government_nomination',
  'fraction',0.5,'eligible_majority',0.5,true,false,'none','none',
  n.formal_document_id,'agenda'
 ) RETURNING id INTO v_vote;
 UPDATE public.government_nominations
 SET status='vote_open',vote_id=v_vote,updated_at=now()
 WHERE id=n.id;
 RETURN v_vote;
END;
$auto$;
REVOKE ALL ON FUNCTION private.ensure_government_nomination_vote(uuid) FROM PUBLIC,anon,authenticated;

-- Совместимость с прежней преподавательской процедурой: только административное
-- восстановление, при этом она не требуется для запуска нового голосования.
CREATE OR REPLACE FUNCTION public.open_government_nomination_vote(p_nomination_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $manual$
DECLARE n public.government_nominations%rowtype;
BEGIN
 SELECT * INTO n FROM public.government_nominations WHERE id=p_nomination_id;
 IF n.id IS NULL THEN RAISE EXCEPTION 'Кандидатура не найдена'; END IF;
 IF NOT private.is_game_teacher(n.game_id) THEN
   RAISE EXCEPTION 'Недостаточно полномочий'; END IF;
 RETURN private.ensure_government_nomination_vote(p_nomination_id);
END;
$manual$;

-- Модифицируется исключительно финал действующей процедуры, с защитой
-- от неожиданных изменений разрешений, документов и ограничений выдвижения.
DO $patch$
DECLARE v_body text;
BEGIN
 v_body:=pg_get_functiondef('public.submit_government_nomination(uuid,text,text,text,uuid,text)'::regprocedure);
 IF position('private.ensure_government_nomination_vote(v_id)' IN v_body)>0 THEN RETURN; END IF;
 IF position('v_route:=''president_to_duma''' IN v_body)=0
   OR position('v_route:=''pm_to_duma''' IN v_body)=0
   OR position('private.stage8_create_formal_document' IN v_body)=0
   OR position('v_stage integer:=case when p_office_kind' IN lower(v_body))=0
   OR position('return v_id;' IN lower(v_body))=0
 THEN RAISE EXCEPTION 'Механизм выдвижения изменился: автоматический выпуск голосования требует сверки'; END IF;
 v_body:=replace(v_body,
   E' return v_id;\nend;',
   E' -- После внесения Думской кандидатуры в той же транзакции открывается голосование.\n'
    ||E' if v_route in (''president_to_duma'',''pm_to_duma'') then\n'
    ||E'  perform private.ensure_government_nomination_vote(v_id);\n'
    ||E' end if;\n'
    ||E' return v_id;\nend;');
 IF position('private.ensure_government_nomination_vote(v_id)' IN v_body)=0
 THEN RAISE EXCEPTION 'Место автоматического выпуска голосования не найдено'; END IF;
 EXECUTE v_body;
END;
$patch$;

-- Исправить уже внесённые кандидатуры активных этапов. Никаких повторных
-- внесений, изменений результатов или автоматического голосования за депутатов.
DO $backfill$
DECLARE r record;
BEGIN
 FOR r IN
 SELECT n.id FROM public.government_nominations n
 JOIN public.game_stages s ON s.game_id=n.game_id AND s.stage_no=n.stage_no
 WHERE n.route IN ('president_to_duma','pm_to_duma')
   AND n.stage_no IN (8,9) AND n.status='submitted' AND n.vote_id IS NULL
   AND s.status='open' AND (s.deadline IS NULL OR s.deadline>clock_timestamp())
 ORDER BY n.created_at
 LOOP
  PERFORM private.ensure_government_nomination_vote(r.id);
 END LOOP;
END;
$backfill$;
