-- Candidate mathematical core, not a production migration.
-- The corresponding TypeScript implementation is components/game/economicModelV2.ts.
CREATE OR REPLACE FUNCTION private.economic_aux_v2(metrics jsonb, anchors jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $f$
 WITH d AS (
  SELECT k,coalesce((metrics->>k)::numeric-(anchors->>k)::numeric,0) AS delta
  FROM unnest(ARRAY['social_stability','security','elite_support','international_standing','legitimacy','media_climate']) k
 ), s AS (
  SELECT coalesce(sum(CASE k WHEN 'social_stability' THEN delta*.004 WHEN 'security' THEN delta*.004 WHEN 'elite_support' THEN delta*.002 WHEN 'international_standing' THEN delta*.004 ELSE 0 END),0) AS political,
   coalesce(sum(CASE k WHEN 'legitimacy' THEN delta*.0015 WHEN 'media_climate' THEN delta*.001 ELSE 0 END),0) AS collection FROM d
 )
 SELECT jsonb_build_object('activity_adjustment',greatest(-.25,least(.25,political))-greatest(0,least(.20,(coalesce((metrics->>'social_tension')::numeric,60)-60)*.005)),
 'collection_adjustment',greatest(-.08,least(.08,collection))) FROM s
$f$;

CREATE OR REPLACE FUNCTION private.economic_automatic_v2(key_rate numeric,base_fx numeric,economy_delta numeric,trust_delta numeric,aux numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $f$
 WITH rate AS (SELECT base_fx*greatest(.75,least(1.3,1-economy_delta*.001-trust_delta*.001-(key_rate-16)*.0015)) fx)
 SELECT jsonb_build_object('fx',fx,'automatic',greatest(.2,least(2,1-(key_rate-16)*.015+economy_delta*.010+trust_delta*.005-(fx/80-1)*.06+aux))) FROM rate
$f$;

CREATE OR REPLACE FUNCTION private.economic_manual_v2(automatic numeric,override_pct numeric,reference numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $f$
 SELECT CASE WHEN override_pct IS NULL THEN automatic ELSE greatest(0,least(10,override_pct/100*automatic/CASE WHEN reference>0 THEN reference ELSE automatic END)) END
$f$;

CREATE OR REPLACE FUNCTION private.economic_collection_v2(activity numeric,reference numeric,law_delta numeric,trust_delta numeric,aux numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $f$
 SELECT greatest(-.06,least(.015,(activity/greatest(.01,reference)-1)*.12))+law_delta*.002+trust_delta*.0015+aux
$f$;

CREATE OR REPLACE FUNCTION private.enterprise_factors_v2(count_firms numeric,weighted_firms numeric,baseline numeric,macro numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $f$
 WITH factors AS (SELECT count_firms/greatest(1,baseline) enterprise_factor, CASE WHEN count_firms>0 THEN weighted_firms/count_firms ELSE 0 END regional_activity)
 SELECT jsonb_build_object('enterprise_factor',enterprise_factor,'regional_activity',regional_activity,'activity',greatest(0,least(10,enterprise_factor*regional_activity*macro))) FROM factors
$f$;

REVOKE ALL ON FUNCTION private.economic_aux_v2(jsonb,jsonb),private.economic_automatic_v2(numeric,numeric,numeric,numeric,numeric),private.economic_manual_v2(numeric,numeric,numeric),private.economic_collection_v2(numeric,numeric,numeric,numeric,numeric),private.enterprise_factors_v2(numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
