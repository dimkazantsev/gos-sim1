-- Owner-requested activation of Stage 9 after the five-ministry structure was approved.
-- Do not unlock Stages 10-16 or waive individual final-document holds.
-- Keep the Stage 8 deadline; no arbitrary new deadline or score extension.
-- Guard the exact active game and approved prerequisites. Idempotent for one rollout.
DO $open$
DECLARE
 v_game CONSTANT uuid:='52297def-d24d-4ba9-8049-5078b1b3bd45';
 v_eight public.game_stages%ROWTYPE;
 v_nine public.game_stages%ROWTYPE;
 v_min timestamptz;
 v_open_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('stage-control:'||v_game,0));
 SELECT * INTO v_eight FROM public.game_stages
 WHERE game_id=v_game AND stage_no=8 FOR UPDATE;
 SELECT * INTO v_nine FROM public.game_stages
 WHERE game_id=v_game AND stage_no=9 FOR UPDATE;
 IF v_eight.id IS NULL OR v_nine.id IS NULL THEN
  RAISE EXCEPTION 'Stage 8 or 9 missing: no changes made';
 END IF;
 IF v_nine.status='open' THEN RETURN; END IF;
 IF v_nine.status<>'locked' OR v_eight.status<>'open'
    OR v_eight.deadline IS NULL OR v_eight.deadline<=clock_timestamp() THEN
  RAISE EXCEPTION 'Unsafe Stage 9 activation: check stage state/deadline';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.government_structures s
    WHERE s.game_id=v_game AND s.status='approved'
      AND s.formal_document_id IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM public.government_nominations n
    WHERE n.game_id=v_game AND n.stage_no=8
      AND n.office_kind='prime_minister' AND n.status='appointed') THEN
  RAISE EXCEPTION 'Prime Minister and approved formal structure required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.games g
    WHERE g.id=v_game AND g.status='running' AND g.turn_open) THEN
  RAISE EXCEPTION 'Game must already be running';
 END IF;

 UPDATE public.game_stages SET status='open',
   opened_at=clock_timestamp(),completed_at=NULL,
   deadline=v_eight.deadline
 WHERE id=v_nine.id AND status='locked';

 UPDATE public.stage_deadline_rules
 SET deadline_at=v_eight.deadline,updated_at=clock_timestamp()
 WHERE game_id=v_game AND stage_no=9;

 SELECT count(*), min(deadline) INTO v_open_count,v_min
 FROM public.game_stages WHERE game_id=v_game AND status='open';
 UPDATE public.games SET current_round=greatest(current_round,9),
   turn_open=(v_open_count>0),turn_ends_at=v_min,
   status=CASE WHEN v_open_count>0 THEN 'running' ELSE 'paused' END
 WHERE id=v_game;

 INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,payload)
 VALUES(v_game,NULL,'owner_requested_stage9_activation','game_stages',
  jsonb_build_object('stage_no',9,'operation','open',
   'reason','Approved government structure; students require Stage 9 access',
   'deadline_inherited_from_stage',8,
   'deadline',v_eight.deadline,'preserves_student_document_holds',true));
END $open$;
