-- Applied production migration 20261128143039. Do not replay.
DO $cleanup$
DECLARE
 sep constant text := E'\n\nОбязательные условия рассмотрения. ';
 rev constant text := 'events-v2-hide-legal-boundary-2026-11-28';
 n integer;
 changed integer;
 gids uuid[];
 rel text;
 digest text;
 before_hashes jsonb := '{}'::jsonb;
 after_hashes jsonb := '{}'::jsonb;
 protected_tables constant text[] := ARRAY['game_members','game_achievements','state_metrics','state_metric_history','event_assignments','event_decisions','event_case_outcomes','event_collaboration_invites','event_authority_evidence','stage_assessments','stage_assessment_runs','event_trust_ledger','impact_ledger','political_posts','game_stages','event_case_routing'];
BEGIN
 PERFORM set_config('lock_timeout','2s',true);
 PERFORM set_config('statement_timeout','25s',true);
 LOCK TABLE public.game_members,public.game_stages,private.authored_event_catalog,public.event_cases,public.event_assignments,public.event_decisions,public.event_case_outcomes,public.event_collaboration_invites,public.event_authority_evidence,public.game_achievements,public.state_metrics,public.state_metric_history,public.stage_assessments,public.stage_assessment_runs,public.event_trust_ledger,public.impact_ledger,public.political_posts,public.event_case_routing,private.event_content_revisions IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM private.event_content_revisions WHERE revision=rev) THEN RAISE EXCEPTION 'Already applied'; END IF;
 IF (SELECT count(*) FROM private.authored_event_catalog WHERE strpos(content->>'situation',sep)>0)<>189 OR EXISTS(SELECT 1 FROM private.authored_event_catalog WHERE strpos(content->>'situation',sep)>0 AND (content->>'audience' NOT IN ('group','all') OR content ? 'mandatory_boundary' OR cardinality(string_to_array(content->>'situation',sep))<>2 OR nullif(btrim(split_part(content->>'situation',sep,1)),'') IS NULL OR nullif(btrim(split_part(content->>'situation',sep,2)),'') IS NULL)) THEN RAISE EXCEPTION 'Unexpected catalogue'; END IF;
 SELECT count(*),array_agg(DISTINCT game_id) INTO n,gids FROM public.event_cases WHERE strpos(situation,sep)>0;
 IF n<>189 OR cardinality(gids)<>1 OR EXISTS(SELECT 1 FROM public.event_cases c LEFT JOIN private.authored_event_catalog a USING(case_key) WHERE strpos(c.situation,sep)>0 AND c.situation IS DISTINCT FROM a.content->>'situation') THEN RAISE EXCEPTION 'Unexpected instance scope'; END IF;
 FOREACH rel IN ARRAY protected_tables LOOP
 EXECUTE format('SELECT count(*)::text || '':'' || coalesce(md5(string_agg(h, '''' ORDER BY h)), '''') FROM (SELECT md5(to_jsonb(t)::text) h FROM public.%I t WHERE game_id=ANY($1)) s',rel) INTO digest USING gids;
 before_hashes:=before_hashes||jsonb_build_object(rel,digest);
 END LOOP;
 INSERT INTO private.event_content_revisions(revision,event_case_id,snapshot) SELECT rev,id,to_jsonb(c) FROM public.event_cases c WHERE strpos(situation,sep)>0;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>n THEN RAISE EXCEPTION 'Snapshot count mismatch'; END IF;
 UPDATE private.authored_event_catalog SET content=content||jsonb_build_object('situation',split_part(content->>'situation',sep,1),'mandatory_boundary',split_part(content->>'situation',sep,2)) WHERE strpos(content->>'situation',sep)>0;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>189 THEN RAISE EXCEPTION 'Catalogue update incomplete'; END IF;
 UPDATE public.event_cases c SET situation=a.content->>'situation' FROM private.authored_event_catalog a, private.event_content_revisions r WHERE r.revision=rev AND r.event_case_id=c.id AND a.case_key=c.case_key;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>n THEN RAISE EXCEPTION 'Instance update incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM private.event_content_revisions r JOIN public.event_cases c ON c.id=r.event_case_id JOIN private.authored_event_catalog a ON a.case_key=c.case_key WHERE r.revision=rev AND ((to_jsonb(c)-'situation') IS DISTINCT FROM (r.snapshot-'situation') OR c.situation IS DISTINCT FROM a.content->>'situation' OR (c.situation||sep||(a.content->>'mandatory_boundary')) IS DISTINCT FROM r.snapshot->>'situation')) OR EXISTS(SELECT 1 FROM public.event_cases WHERE situation LIKE '%Обязательные условия рассмотрения%') THEN RAISE EXCEPTION 'Editorial invariant failed'; END IF;
 FOREACH rel IN ARRAY protected_tables LOOP
 EXECUTE format('SELECT count(*)::text || '':'' || coalesce(md5(string_agg(h, '''' ORDER BY h)), '''') FROM (SELECT md5(to_jsonb(t)::text) h FROM public.%I t WHERE game_id=ANY($1)) s',rel) INTO digest USING gids;
 after_hashes:=after_hashes||jsonb_build_object(rel,digest);
 END LOOP;
 IF before_hashes IS DISTINCT FROM after_hashes THEN RAISE EXCEPTION 'Protected data changed'; END IF;
END $cleanup$;
