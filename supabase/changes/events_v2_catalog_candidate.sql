-- Step 5 candidate only. Do not install or invoke on production before release approval.
-- Run in a single controlled transaction after both V2 handler candidates.
-- This is an invoker-only migration helper; drop it in the same release transaction.
CREATE OR REPLACE FUNCTION private.events_v2_apply_catalog_candidate(p_payload jsonb,p_open_case_ids uuid[] DEFAULT '{}'::uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $f$
DECLARE n int;changed int;catalog_changed int;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload)<>330
 OR p_open_case_ids IS NULL OR cardinality(p_open_case_ids)>7 OR array_position(p_open_case_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Invalid V2 release payload';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload) x
  WHERE x->>'case_key' IS NULL OR x->>'title' IS NULL OR x->>'category' IS NULL
  OR x->>'audience' NOT IN ('single','group','all') OR x->>'audience' IS NULL
  OR nullif(btrim(x->>'situation'),'') IS NULL
  OR x->'verified' IS DISTINCT FROM 'true'::jsonb
  OR x->>'editorial_status' IS DISTINCT FROM 'approved'
  OR x->>'legal_status' IS DISTINCT FROM 'verified_current'
  OR x->'activation_allowed' IS DISTINCT FROM 'true'::jsonb
  OR x->'competence_allowed' IS DISTINCT FROM 'true'::jsonb
  OR x->'effect_plan'->'rules_version' IS DISTINCT FROM '2'::jsonb
  OR jsonb_typeof(x->'decision_options') IS DISTINCT FROM 'array'
  OR jsonb_typeof(x->'effect_plan'->'options') IS DISTINCT FROM 'array') THEN
  RAISE EXCEPTION 'V2 release blocked: legal, editorial or competence gate';
 END IF;
 IF (SELECT count(DISTINCT x->>'case_key') FROM jsonb_array_elements(p_payload) x)<>330
 OR (SELECT count(*) FROM jsonb_array_elements(p_payload) x WHERE x->>'audience'='single')<>141
 OR (SELECT count(*) FROM jsonb_array_elements(p_payload) x WHERE x->>'audience'='group')<>30
 OR (SELECT count(*) FROM jsonb_array_elements(p_payload) x WHERE x->>'audience'='single' AND x->'effect_plan'->'competence'->'committee_before_9'='true'::jsonb)<>20
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload) x WHERE x->>'audience'='single' AND (
  jsonb_typeof(x->'effect_plan'->'competence'->'portfolio_keys') IS DISTINCT FROM 'array'
  OR jsonb_typeof(x->'effect_plan'->'competence'->'committee_before_9') IS DISTINCT FROM 'boolean'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload) x WHERE x->>'audience'='single' AND (
  jsonb_array_length(x->'effect_plan'->'competence'->'portfolio_keys') NOT BETWEEN 1 AND 5
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(x->'effect_plan'->'competence'->'portfolio_keys') k WHERE k NOT IN ('social','economic','defence','foreign','internal'))))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload) x WHERE x->>'audience'<>'single' AND x->'effect_plan' ? 'competence')
 OR (SELECT sum(jsonb_array_length(x->'decision_options')) FROM jsonb_array_elements(p_payload) x)<>1660
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload) x
  WHERE jsonb_array_length(x->'decision_options') NOT BETWEEN 4 AND 6
  OR jsonb_array_length(x->'decision_options')<>jsonb_array_length(x->'effect_plan'->'options')
  OR (x->>'audience'='single' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(x->'effect_plan'->'options') o WHERE o->>'key'=x->'effect_plan'->>'best_option_key' AND o->'lawful'='true'::jsonb))
  OR (x->>'audience'<>'single' AND (x->'effect_plan' ? 'best_option_key' OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'effect_plan'->'options') o WHERE o->'lawful' IS DISTINCT FROM 'true'::jsonb)))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'effect_plan'->'options') WITH ORDINALITY o(value,i) WHERE o.value->>'key' IS DISTINCT FROM 'option_'||o.i OR jsonb_typeof(o.value->'lawful') IS DISTINCT FROM 'boolean')) THEN
  RAISE EXCEPTION 'V2 catalogue shape mismatch';
 END IF;
 -- Bound lock waiting; never use this operation as a polling task.
 PERFORM set_config('lock_timeout','2s',true);
 LOCK TABLE public.game_members,public.game_stages,public.game_member_access_blocks,private.authored_event_catalog,public.event_cases,public.event_assignments,public.event_decisions,public.event_case_outcomes,public.event_collaboration_invites,public.event_authority_evidence IN SHARE ROW EXCLUSIVE MODE;
 IF (SELECT count(*) FROM private.authored_event_catalog)<>330 OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(p_payload) x LEFT JOIN private.authored_event_catalog c ON c.case_key=x->>'case_key'
  WHERE c.case_key IS NULL OR c.content->>'title' IS DISTINCT FROM x->>'title'
  OR c.content->>'category' IS DISTINCT FROM x->>'category' OR c.content->>'audience' IS DISTINCT FROM x->>'audience'
  OR c.content->'effect_plan'->>'rules_version'='2' OR c.content->'comic_scene'->>'event_rules_version'='2') THEN
  RAISE EXCEPTION 'Live source catalogue differs or has already been migrated';
 END IF;
 -- Select eligible rows under the same lock. Do not update voted, resolved,
 -- invited or evaluated cases; no inferred permission for newly opened cases.
 WITH input AS MATERIALIZED (SELECT value AS doc FROM jsonb_array_elements(p_payload)),
 eligible AS MATERIALIZED (
  SELECT c.id,to_jsonb(c) snapshot,i.doc FROM public.event_cases c JOIN input i ON c.case_key=i.doc->>'case_key'
  WHERE c.status='ready' AND c.title=i.doc->>'title' AND c.audience=i.doc->>'audience' AND c.category=i.doc->>'category'
   AND c.effect_plan->>'rules_version' IS DISTINCT FROM '2' AND c.comic_scene->>'event_rules_version' IS DISTINCT FROM '2'
   AND NOT EXISTS(SELECT 1 FROM public.event_decisions d WHERE d.case_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM public.event_collaboration_invites v WHERE v.case_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM public.event_authority_evidence e WHERE e.case_id=c.id)
   AND (NOT EXISTS(SELECT 1 FROM public.event_assignments a WHERE a.case_id=c.id)
    OR (c.id=ANY(p_open_case_ids)
      AND (c.audience<>'single' OR (SELECT count(*) FROM public.event_assignments a WHERE a.case_id=c.id)=1)
      AND NOT EXISTS(SELECT 1 FROM public.event_assignments a
       LEFT JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.recipient_id
       LEFT JOIN public.game_stages s ON s.game_id=a.game_id AND s.stage_no=a.stage_no
       WHERE a.case_id=c.id AND (a.game_id IS DISTINCT FROM c.game_id OR a.status IS DISTINCT FROM 'pending'
        OR EXISTS(SELECT 1 FROM public.game_member_access_blocks b WHERE b.game_id=a.game_id AND b.user_id=a.recipient_id)
        OR a.stage_no IS NULL OR m.kind::text IS DISTINCT FROM 'student' OR m.roster_archived_at IS NOT NULL OR s.status::text IS DISTINCT FROM 'open'))))
 ),
 saved AS (INSERT INTO private.event_content_revisions(revision,event_case_id,snapshot)
  SELECT 'events-v2-2026-11-28',id,snapshot FROM eligible
  ON CONFLICT(revision,event_case_id) DO NOTHING RETURNING event_case_id)
 UPDATE public.event_cases c SET situation=e.doc->>'situation',decision_options=e.doc->'decision_options',
  effect_plan=e.doc->'effect_plan',source_url=e.doc->>'source_url',source_note=e.doc->>'source_note',verified=true,
  comic_scene=(c.comic_scene - ARRAY['vote_round','runoff_options','first_round_tallies']::text[])||jsonb_build_object('event_rules_version',2)
 FROM eligible e JOIN saved s ON s.event_case_id=e.id WHERE c.id=e.id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 UPDATE private.authored_event_catalog c SET content=c.content||jsonb_build_object(
  'situation',x->>'situation','decision_options',x->'decision_options','effect_plan',x->'effect_plan',
  'source_url',x->>'source_url','source_note',x->>'source_note','verified',true,
  'comic_scene',((c.content->'comic_scene') - ARRAY['vote_round','runoff_options','first_round_tallies']::text[])||jsonb_build_object('event_rules_version',2))
 FROM jsonb_array_elements(p_payload) x WHERE c.case_key=x->>'case_key';
 GET DIAGNOSTICS catalog_changed=ROW_COUNT;
 IF catalog_changed<>330 THEN RAISE EXCEPTION 'Incomplete V2 catalogue migration';END IF;
 RETURN jsonb_build_object('catalogue',catalog_changed,'updated_instances',changed);
END $f$;
REVOKE ALL ON FUNCTION private.events_v2_apply_catalog_candidate(jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
-- Deployment must separately finish and test the seed verified flag and exact
-- runtime competence routing; this candidate does not grant authority or open the release gate.
