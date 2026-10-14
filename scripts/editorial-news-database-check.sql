-- Run in a test database AFTER applying 20261015060000_verified_editorial_automatic_news.sql.
-- Read-only assertions: no production state changes.
DO $test$
DECLARE
 s record;
 bulletin jsonb;
 committee_total integer;
 official_chair_total integer;
BEGIN
 IF to_regprocedure('private.gos_verified_stage_news(uuid,integer)') IS NULL THEN
  RAISE EXCEPTION 'Editorial function is missing';
 END IF;
 IF has_function_privilege('authenticated','private.gos_verified_stage_news(uuid,integer)','EXECUTE') THEN
  RAISE EXCEPTION 'Protected editorial function is exposed to authenticated clients';
 END IF;
 IF private.gos_verified_stage_news('00000000-0000-0000-0000-000000000000',4) IS NOT NULL THEN
  RAISE EXCEPTION 'News generated for a nonexistent game';
 END IF;
 FOR s IN SELECT game_id,stage_no,summary FROM public.game_stages WHERE status='completed'
 LOOP
  bulletin := private.gos_verified_stage_news(s.game_id,s.stage_no);
  IF bulletin IS NULL OR (bulletin->>'body') IS NULL
     OR (bulletin->>'title') IS NULL THEN
   RAISE EXCEPTION 'Missing complete bulletin for stage %',s.stage_no;
  END IF;
  IF bulletin->>'body'=s.summary THEN
   RAISE EXCEPTION 'Stage task has been published as news for stage %',s.stage_no;
  END IF;
  IF s.stage_no=4 THEN
   SELECT count(*) INTO committee_total FROM public.institution_units
   WHERE game_id=s.game_id AND unit_kind='committee';
   IF committee_total=0 AND bulletin->>'body' LIKE '%оформлены пять комитетов%' THEN
    RAISE EXCEPTION 'Unverified Duma committees asserted';
   END IF;
   SELECT count(*) INTO official_chair_total FROM public.office_elections
   WHERE game_id=s.game_id AND stage_no=4 AND office_key='gd_chair'
    AND status='finished' AND winner_candidate_id IS NOT NULL;
   IF official_chair_total=0 AND bulletin->>'body' LIKE '%руководство палаты сформировано следующим образом%' THEN
    RAISE EXCEPTION 'Unverified Duma leadership asserted';
   END IF;
  END IF;
 END LOOP;
END
$test$;
