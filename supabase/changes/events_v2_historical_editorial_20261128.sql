-- Applied production migration 20261128141007. Do not replay.
-- Editorial update only. Keep V1 answer keys, scoring and results intact.
-- Prior approved V2 catalogue is the sole source of the new wording.
-- Do not replay once the historical snapshots have been recorded.
DO $historical_editorial$
DECLARE
  gids uuid[];
  n integer;
  changed integer;
  rel text;
  digest text;
  before_hashes jsonb := '{}'::jsonb;
  after_hashes jsonb := '{}'::jsonb;
  revision_key constant text := 'events-v2-historical-editorial-2026-11-28';
  protected_tables constant text[] := ARRAY['game_members','game_achievements','state_metrics','state_metric_history','event_assignments','event_decisions','event_case_outcomes','event_collaboration_invites','event_authority_evidence'];
BEGIN
  PERFORM set_config('lock_timeout','2s',true);
  PERFORM set_config('statement_timeout','20s',true);
  LOCK TABLE public.game_members, private.authored_event_catalog, public.event_cases,
    public.event_assignments, public.event_decisions, public.event_case_outcomes,
    public.event_collaboration_invites, public.event_authority_evidence,
    public.game_achievements, public.state_metrics, public.state_metric_history,
    private.event_content_revisions IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM private.event_content_revisions WHERE revision=revision_key) THEN
    RAISE EXCEPTION 'Historical editorial migration already recorded; no replay';
  END IF;
  SELECT array_agg(DISTINCT c.game_id),count(*) INTO gids,n
  FROM public.event_cases c WHERE c.effect_plan->>'rules_version' IS DISTINCT FROM '2';
  IF n<>68 OR cardinality(gids)<>1 THEN
    RAISE EXCEPTION 'Historical case scope changed: %',n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_cases c LEFT JOIN private.authored_event_catalog a USING(case_key)
    WHERE c.game_id=ANY(gids) AND c.effect_plan->>'rules_version' IS DISTINCT FROM '2'
      AND (a.case_key IS NULL OR a.content->'effect_plan'->>'rules_version' IS DISTINCT FROM '2'
        OR a.content->>'verified' IS DISTINCT FROM 'true'
        OR a.content->>'title' IS DISTINCT FROM c.title
        OR a.content->>'category' IS DISTINCT FROM c.category
        OR a.content->>'audience' IS DISTINCT FROM c.audience
        OR nullif(btrim(a.content->>'situation'),'') IS NULL
        OR jsonb_typeof(a.content->'decision_options') IS DISTINCT FROM 'array'
        OR jsonb_array_length(a.content->'decision_options')<>jsonb_array_length(c.decision_options)
        OR NOT EXISTS (SELECT 1 FROM public.event_assignments a0 WHERE a0.case_id=c.id AND a0.game_id=c.game_id))
  ) THEN RAISE EXCEPTION 'Historical catalogue compatibility check failed'; END IF;
  FOREACH rel IN ARRAY protected_tables LOOP
    EXECUTE format('SELECT count(*)::text || '':'' || coalesce(md5(string_agg(h, '''' ORDER BY h)), '''') FROM (SELECT md5(to_jsonb(t)::text) h FROM public.%I t WHERE game_id=ANY($1)) s',rel)
      INTO digest USING gids;
    before_hashes := before_hashes || jsonb_build_object(rel,digest);
  END LOOP;
  INSERT INTO private.event_content_revisions(revision,event_case_id,snapshot)
    SELECT revision_key,c.id,to_jsonb(c) FROM public.event_cases c
    WHERE c.game_id=ANY(gids) AND c.effect_plan->>'rules_version' IS DISTINCT FROM '2';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>n THEN RAISE EXCEPTION 'Historical snapshots incomplete'; END IF;
  UPDATE public.event_cases c SET situation =
    CASE WHEN EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=c.id AND o.game_id=c.game_id)
      THEN 'Актуальная учебная редакция V2. Ранее принятые решения и начисленные баллы относятся к прежней редакции.'
        || E'\n\n' || (a.content->>'situation')
        || E'\n\nВарианты актуальной редакции (для ознакомления):\n' || opts.text
        || CASE WHEN c.situation IS DISTINCT FROM a.content->>'situation'
           THEN E'\n\nУсловие на момент принятия решения:\n' || c.situation ELSE '' END
      ELSE 'Условие назначенной ситуации (для действующего голосования):'
        || E'\n\n' || c.situation
        || E'\n\nАктуальная учебная редакция V2 (для ознакомления; не изменяет уже назначенные правила и варианты голосования):\n'
        || CASE WHEN c.situation IS DISTINCT FROM a.content->>'situation' THEN (a.content->>'situation') || E'\n\n' ELSE '' END
        || 'Варианты актуальной редакции:' || E'\n' || opts.text
    END
  FROM private.event_content_revisions r
    JOIN private.authored_event_catalog a ON a.case_key=r.snapshot->>'case_key'
    CROSS JOIN LATERAL (
      SELECT string_agg(i::text || '. ' || option_text,E'\n' ORDER BY i) AS text
      FROM jsonb_array_elements_text(a.content->'decision_options') WITH ORDINALITY AS z(option_text,i)
    ) opts
  WHERE r.revision=revision_key AND c.id=r.event_case_id AND c.game_id=ANY(gids);
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>n THEN RAISE EXCEPTION 'Historical editorial update incomplete'; END IF;
  IF EXISTS (
    SELECT 1 FROM private.event_content_revisions r JOIN public.event_cases c ON c.id=r.event_case_id
    WHERE r.revision=revision_key AND ((to_jsonb(c)-'situation') IS DISTINCT FROM (r.snapshot-'situation')
      OR c.situation IS NOT DISTINCT FROM r.snapshot->>'situation')
  ) THEN RAISE EXCEPTION 'Non-editorial case fields changed'; END IF;
  FOREACH rel IN ARRAY protected_tables LOOP
    EXECUTE format('SELECT count(*)::text || '':'' || coalesce(md5(string_agg(h, '''' ORDER BY h)), '''') FROM (SELECT md5(to_jsonb(t)::text) h FROM public.%I t WHERE game_id=ANY($1)) s',rel)
      INTO digest USING gids;
    after_hashes := after_hashes || jsonb_build_object(rel,digest);
  END LOOP;
  IF before_hashes IS DISTINCT FROM after_hashes THEN
    RAISE EXCEPTION 'Protected game data changed; rollback editorial migration';
  END IF;
  RAISE NOTICE 'Editorial update: % historical cases; all protected data unchanged',changed;
END
$historical_editorial$;
