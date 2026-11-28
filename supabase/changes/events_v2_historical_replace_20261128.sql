-- Applied production migration 20261128141732. Do not replay.
DO $release$
DECLARE
  gids uuid[];
  n int;
  finished int;
  changed int;
  rel text;
  digest text;
  before_hashes jsonb := '{}'::jsonb;
  after_hashes jsonb := '{}'::jsonb;
  rev constant text := 'events-v2-historical-replace-2026-11-28';
  protected_tables constant text[] := ARRAY['game_members','game_achievements','state_metrics','state_metric_history','event_assignments','event_decisions','event_case_outcomes','event_collaboration_invites','event_authority_evidence','stage_assessments','stage_assessment_runs','event_trust_ledger','impact_ledger','political_posts','game_stages','event_case_routing'];
BEGIN
 PERFORM set_config('lock_timeout','2s',true);
 PERFORM set_config('statement_timeout','25s',true);
 LOCK TABLE public.game_members,public.game_stages,private.authored_event_catalog,public.event_cases,
 public.event_assignments,public.event_decisions,public.event_case_outcomes,public.event_collaboration_invites,
 public.event_authority_evidence,public.game_achievements,public.state_metrics,public.state_metric_history,
 public.stage_assessments,public.stage_assessment_runs,public.event_trust_ledger,public.impact_ledger,
 public.political_posts,public.event_case_routing,private.event_content_revisions IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM private.event_content_revisions WHERE revision=rev) THEN RAISE EXCEPTION 'Already applied'; END IF;
 SELECT count(*),array_agg(DISTINCT c.game_id),count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=c.id AND o.game_id=c.game_id))
 INTO n,gids,finished FROM public.event_cases c JOIN private.event_content_revisions r ON r.event_case_id=c.id
 WHERE r.revision='events-v2-historical-editorial-2026-11-28';
 IF n<>68 OR finished<>54 OR cardinality(gids)<>1 THEN RAISE EXCEPTION 'Unexpected scope: % cases, % completed',n,finished; END IF;
 IF EXISTS(
 SELECT 1 FROM public.event_cases c JOIN private.event_content_revisions r ON r.event_case_id=c.id
 LEFT JOIN private.authored_event_catalog a ON a.case_key=c.case_key
 WHERE r.revision='events-v2-historical-editorial-2026-11-28'
 AND (a.case_key IS NULL OR a.content->>'verified' IS DISTINCT FROM 'true'
 OR a.content->'effect_plan'->>'rules_version' IS DISTINCT FROM '2'
 OR a.content->'comic_scene'->>'event_rules_version' IS DISTINCT FROM '2'
 OR a.content->>'title' IS DISTINCT FROM c.title OR a.content->>'category' IS DISTINCT FROM c.category
 OR a.content->>'audience' IS DISTINCT FROM c.audience
 OR nullif(btrim(a.content->>'situation'),'') IS NULL
 OR jsonb_typeof(a.content->'decision_options') IS DISTINCT FROM 'array'
 OR jsonb_array_length(a.content->'decision_options')<>jsonb_array_length(c.decision_options)
 OR (SELECT jsonb_agg(z.o->>'key' ORDER BY z.i) FROM jsonb_array_elements(c.effect_plan->'options') WITH ORDINALITY z(o,i))
 IS DISTINCT FROM (SELECT jsonb_agg(z.o->>'key' ORDER BY z.i) FROM jsonb_array_elements(a.content->'effect_plan'->'options') WITH ORDINALITY z(o,i))
 OR c.effect_plan->>'rules_version'='2'
 OR (to_jsonb(c)-'situation') IS DISTINCT FROM (r.snapshot-'situation')
 )) THEN RAISE EXCEPTION 'Historical source or option compatibility changed'; END IF;
 IF EXISTS(
 SELECT 1 FROM public.event_cases c JOIN private.event_content_revisions r ON r.event_case_id=c.id
 WHERE r.revision='events-v2-historical-editorial-2026-11-28'
 AND NOT EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=c.id)
 AND (
 EXISTS(SELECT 1 FROM public.event_collaboration_invites i WHERE i.case_id=c.id AND i.status='pending')
 OR EXISTS(SELECT 1 FROM public.event_authority_evidence e WHERE e.case_id=c.id)
 OR EXISTS(SELECT 1 FROM public.event_decisions d WHERE d.case_id=c.id AND
 (d.vote_round<>1 OR d.choice !~ '^option_[1-6]$' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.effect_plan->'options') x WHERE x->>'key'=d.choice)))
 )
 ) THEN RAISE EXCEPTION 'Open-case transition prerequisites failed'; END IF;
 FOREACH rel IN ARRAY protected_tables LOOP
 EXECUTE format('SELECT count(*)::text || '':'' || coalesce(md5(string_agg(h, '''' ORDER BY h)), '''') FROM (SELECT md5(to_jsonb(t)::text) h FROM public.%I t WHERE game_id=ANY($1)) s',rel)
 INTO digest USING gids;
 before_hashes:=before_hashes||jsonb_build_object(rel,digest);
 END LOOP;
 INSERT INTO private.event_content_revisions(revision,event_case_id,snapshot)
 SELECT rev,c.id,to_jsonb(c) FROM public.event_cases c JOIN private.event_content_revisions r ON r.event_case_id=c.id
 WHERE r.revision='events-v2-historical-editorial-2026-11-28';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>n THEN RAISE EXCEPTION 'Snapshot count mismatch'; END IF;
 WITH target AS MATERIALIZED (
 SELECT c.id,a.content,EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=c.id AND o.game_id=c.game_id) done
 FROM public.event_cases c JOIN private.event_content_revisions r ON r.event_case_id=c.id AND r.revision=rev
 JOIN private.authored_event_catalog a ON a.case_key=c.case_key
 )
 UPDATE public.event_cases c SET
 situation=t.content->>'situation',decision_options=t.content->'decision_options',
 source_url=t.content->>'source_url',source_note=t.content->>'source_note',verified=true,
 effect_plan=CASE WHEN t.done THEN c.effect_plan ELSE t.content->'effect_plan' END,
 comic_scene=CASE WHEN t.done THEN c.comic_scene ELSE
 (coalesce(c.comic_scene,'{}'::jsonb)-ARRAY['vote_round','runoff_options','first_round_tallies']::text[])||jsonb_build_object('event_rules_version',2) END
 FROM target t WHERE c.id=t.id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>n THEN RAISE EXCEPTION 'Incomplete update'; END IF;
 IF EXISTS(SELECT 1 FROM private.event_content_revisions r JOIN public.event_cases c ON c.id=r.event_case_id
 JOIN private.authored_event_catalog a ON a.case_key=c.case_key
 WHERE r.revision=rev AND (
 c.situation IS DISTINCT FROM a.content->>'situation' OR c.decision_options IS DISTINCT FROM a.content->'decision_options'
 OR c.verified IS DISTINCT FROM true
 OR (to_jsonb(c)-ARRAY['situation','decision_options','source_url','source_note','verified','effect_plan','comic_scene']::text[])
 IS DISTINCT FROM (r.snapshot-ARRAY['situation','decision_options','source_url','source_note','verified','effect_plan','comic_scene']::text[])
 OR (EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=c.id) AND
 (c.effect_plan IS DISTINCT FROM r.snapshot->'effect_plan' OR c.comic_scene IS DISTINCT FROM r.snapshot->'comic_scene'))
 OR (NOT EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=c.id) AND
 (c.effect_plan IS DISTINCT FROM a.content->'effect_plan' OR c.comic_scene->>'event_rules_version' IS DISTINCT FROM '2'))
 )) THEN RAISE EXCEPTION 'Editorial or historical invariant failed'; END IF;
 PERFORM private.event_v2_validate_collective(c.effect_plan,c.decision_options,c.comic_scene)
 FROM public.event_cases c JOIN private.event_content_revisions r ON r.event_case_id=c.id AND r.revision=rev
 WHERE c.audience IN ('all','group') AND NOT EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=c.id);
 FOREACH rel IN ARRAY protected_tables LOOP
 EXECUTE format('SELECT count(*)::text || '':'' || coalesce(md5(string_agg(h, '''' ORDER BY h)), '''') FROM (SELECT md5(to_jsonb(t)::text) h FROM public.%I t WHERE game_id=ANY($1)) s',rel)
 INTO digest USING gids;
 after_hashes:=after_hashes||jsonb_build_object(rel,digest);
 END LOOP;
 IF before_hashes IS DISTINCT FROM after_hashes THEN RAISE EXCEPTION 'Protected results or scores changed: rollback'; END IF;
 RAISE NOTICE 'Updated % cases; % completed historical plans unchanged; protected data unchanged',changed,finished;
END $release$;
