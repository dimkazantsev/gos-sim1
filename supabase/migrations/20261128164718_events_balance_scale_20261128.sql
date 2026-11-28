-- Approved coefficient revision: catalog only; no recomputation of past outcomes.
SET LOCAL lock_timeout='4s';
LOCK TABLE public.event_cases IN SHARE ROW EXCLUSIVE MODE;
DO $migration$
DECLARE n int; d text; nd text; r record;
BEGIN
 IF (SELECT count(*) FROM private.authored_event_catalog)<>330 OR
 (SELECT sum(jsonb_array_length(content->'effect_plan'->'options')) FROM private.authored_event_catalog)<>1660 OR
 EXISTS(SELECT 1 FROM private.authored_event_catalog WHERE content->'effect_plan' ? 'balance_revision') THEN RAISE EXCEPTION 'Unexpected catalogue baseline'; END IF;
 CREATE TEMP TABLE event_scale(old numeric PRIMARY KEY,new numeric NOT NULL) ON COMMIT DROP;
 INSERT INTO event_scale VALUES (0,0),(.011236,.1),(.022472,.2),(.033708,.3),(.044944,.4),(.0625,.5),(.125,1),(.1875,1.5);
 IF EXISTS(SELECT 1 FROM private.authored_event_catalog c CROSS JOIN LATERAL jsonb_array_elements(c.content->'effect_plan'->'options') o CROSS JOIN LATERAL (SELECT (o->>'trust')::numeric v UNION ALL SELECT value::numeric FROM jsonb_each_text(coalesce(o->'metric_effects','{}'))) v WHERE c.content->>'audience'<>'single' AND NOT EXISTS(SELECT 1 FROM event_scale WHERE old=abs(v.v))) THEN RAISE EXCEPTION 'Unexpected collective coefficient'; END IF;
 IF EXISTS(SELECT 1 FROM private.authored_event_catalog c CROSS JOIN LATERAL jsonb_array_elements(c.content->'effect_plan'->'options') o WHERE c.content->>'audience'='single' AND (o->>'trust')::numeric IS DISTINCT FROM (CASE WHEN o->>'key'=c.content->'effect_plan'->>'best_option_key' THEN 2 ELSE 0 END)::numeric) THEN RAISE EXCEPTION 'Unexpected individual coefficient';END IF;
 CREATE TEMP TABLE event_new_plans ON COMMIT DROP AS
 SELECT c.case_key,c.content->'effect_plan' old_plan,
 jsonb_set(c.content->'effect_plan','{options}',(
 SELECT jsonb_agg(
 CASE WHEN c.content->>'audience'='single' THEN jsonb_set(o,'{trust}',to_jsonb(CASE WHEN (o->>'trust')::numeric=2 THEN .5::numeric ELSE 0::numeric END))
 ELSE jsonb_set(jsonb_set(o,'{trust}',to_jsonb(sign((o->>'trust')::numeric)*s.new)),'{metric_effects}',coalesce((SELECT jsonb_object_agg(k,to_jsonb(sign(v::numeric)*m.new)) FROM jsonb_each_text(o->'metric_effects') x(k,v) JOIN event_scale m ON m.old=abs(v::numeric)),'{}'::jsonb)) END ORDER BY ord)
 FROM jsonb_array_elements(c.content->'effect_plan'->'options') WITH ORDINALITY a(o,ord)
 LEFT JOIN event_scale s ON s.old=abs((o->>'trust')::numeric)
 ))||jsonb_build_object('balance_revision','2026-11-28-balance-1') AS new_plan
 FROM private.authored_event_catalog c;
 IF (SELECT count(*) FROM event_new_plans)<>330 THEN RAISE EXCEPTION 'Catalogue coverage'; END IF;
 IF EXISTS(SELECT 1 FROM event_new_plans c CROSS JOIN LATERAL jsonb_array_elements(c.old_plan->'options') WITH ORDINALITY a(o,i) WHERE (o-'trust'-'metric_effects') IS DISTINCT FROM ((c.new_plan->'options'->(i::int-1))-'trust'-'metric_effects') OR sign((o->>'trust')::numeric) IS DISTINCT FROM sign((c.new_plan->'options'->(i::int-1)->>'trust')::numeric)) THEN RAISE EXCEPTION 'Content or sign changed';END IF;
 FOR r IN SELECT c.content,n.new_plan FROM private.authored_event_catalog c JOIN event_new_plans n USING(case_key) WHERE c.content->>'audience'<>'single' LOOP
 PERFORM private.event_v2_validate_collective(r.new_plan,r.content->'decision_options',r.content->'comic_scene');
 END LOOP;
 CREATE TEMP TABLE event_balance_targets ON COMMIT DROP AS SELECT c.id,c.effect_plan old_plan,n.new_plan FROM public.event_cases c JOIN event_new_plans n USING(case_key) WHERE NOT EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=c.id);
 IF EXISTS(SELECT 1 FROM event_balance_targets t JOIN public.event_cases c ON c.id=t.id JOIN event_new_plans n USING(case_key) WHERE t.old_plan IS DISTINCT FROM n.old_plan) THEN RAISE EXCEPTION 'Unfinished instance differs from original catalogue';END IF;
 INSERT INTO private.event_content_revisions(revision,event_case_id,snapshot) SELECT '2026-11-28-balance-1',id,jsonb_build_object('effect_plan',old_plan) FROM event_balance_targets;
 SELECT pg_get_functiondef('private.record_event_authority()'::regprocedure) INTO d;
 nd:=replace(d,'v_authority_delta:=case when violations>0 then 0 else 1 end;','v_authority_delta:=case when violations>0 then 0 when c.audience=''single'' AND c.effect_plan->>''balance_revision''=''2026-11-28-balance-1'' then 0.1 else 1 end;');
 IF nd=d THEN RAISE EXCEPTION 'Authority function changed';END IF;
 d:=nd;nd:=replace(d,'legal_delta:=case when violations>0 then -3 else 2 end;','legal_delta:=case when c.audience=''single'' AND c.effect_plan->>''balance_revision''=''2026-11-28-balance-1'' then case when violations>0 then -1 else 0.5 end else case when violations>0 then -3 else 2 end end;');
 IF nd=d THEN RAISE EXCEPTION 'Legal function changed';END IF;
 EXECUTE nd;
 UPDATE private.authored_event_catalog c SET content=jsonb_set(c.content,'{effect_plan}',n.new_plan) FROM event_new_plans n WHERE c.case_key=n.case_key;
 GET DIAGNOSTICS n=ROW_COUNT;IF n<>330 THEN RAISE EXCEPTION 'Catalogue update count %',n;END IF;
 UPDATE public.event_cases c SET effect_plan=t.new_plan FROM event_balance_targets t WHERE c.id=t.id;
 GET DIAGNOSTICS n=ROW_COUNT;IF n<>(SELECT count(*) FROM event_balance_targets) THEN RAISE EXCEPTION 'Instance update count %',n;END IF;
 IF EXISTS(SELECT 1 FROM event_balance_targets t JOIN public.event_cases c ON c.id=t.id WHERE c.effect_plan IS DISTINCT FROM t.new_plan) THEN RAISE EXCEPTION 'Instance update mismatch';END IF;
END $migration$;
