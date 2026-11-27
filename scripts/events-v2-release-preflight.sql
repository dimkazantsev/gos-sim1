-- ГОС.ID Events V2: read-only release preflight. Run before/after a release
-- in the same transaction when testing a migration. Never write live data.
WITH protected AS MATERIALIZED (
 SELECT c.id,c.game_id,c.case_key,c.audience,c.decision_options,c.effect_plan,
 c.title,c.situation,c.allowed_roles,c.category,c.seriousness,c.source_url,c.source_note,c.verified,
 EXISTS(SELECT 1 FROM public.event_assignments a WHERE a.case_id=c.id) assigned,
 EXISTS(SELECT 1 FROM public.event_decisions d WHERE d.case_id=c.id) voted,
 EXISTS(SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=c.id) resolved,
 EXISTS(SELECT 1 FROM public.event_collaboration_invites i WHERE i.case_id=c.id) invited,
 EXISTS(SELECT 1 FROM public.event_authority_evidence e WHERE e.case_id=c.id) evaluated
 FROM public.event_cases c
), bank AS (
 SELECT audience,count(*) cases,sum(jsonb_array_length(decision_options)) options,
 count(*) FILTER(WHERE assigned) assigned,
 count(*) FILTER(WHERE resolved) resolved,
 count(*) FILTER(WHERE assigned AND NOT resolved AND voted) pending_with_votes,
 count(*) FILTER(WHERE assigned AND NOT resolved AND NOT voted) pending_without_votes,
 count(*) FILTER(WHERE NOT (assigned OR voted OR resolved OR invited OR evaluated)) editable,
 count(*) FILTER(WHERE nullif(btrim(source_url),'') IS NOT NULL) with_source,
 count(*) FILTER(WHERE verified) verified
 FROM protected GROUP BY audience
), issues AS (
 SELECT count(*) FILTER(WHERE jsonb_typeof(decision_options) IS DISTINCT FROM 'array'
  OR jsonb_typeof(effect_plan->'options') IS DISTINCT FROM 'array'
  OR jsonb_array_length(decision_options) IS DISTINCT FROM jsonb_array_length(effect_plan->'options')) invalid_option_shape,
 count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(effect_plan->'options') WITH ORDINALITY o(val,n)
  WHERE o.val->>'key' IS DISTINCT FROM 'option_'||o.n)) invalid_option_keys,
 count(*) FILTER(WHERE voted AND NOT assigned) votes_without_assignment,
 count(*) FILTER(WHERE resolved AND NOT assigned) outcomes_without_assignment,
 count(*) FILTER(WHERE evaluated AND NOT voted) evidence_without_vote
 FROM protected
), history AS (
 SELECT 'cases' kind,count(*) rows,md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'[]')) fingerprint
 FROM protected p WHERE assigned OR voted OR resolved OR invited OR evaluated
 UNION ALL SELECT 'assignments',count(*),md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text,'[]')) FROM public.event_assignments a
 UNION ALL SELECT 'decisions',count(*),md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id)::text,'[]')) FROM public.event_decisions d
 UNION ALL SELECT 'outcomes',count(*),md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.case_id)::text,'[]')) FROM public.event_case_outcomes o
 UNION ALL SELECT 'authority_evidence',count(*),md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.decision_id)::text,'[]')) FROM public.event_authority_evidence e
 UNION ALL SELECT 'invitations',count(*),md5(coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id)::text,'[]')) FROM public.event_collaboration_invites i
)
SELECT (SELECT jsonb_agg(to_jsonb(bank) ORDER BY audience) FROM bank) AS bank,
 (SELECT to_jsonb(issues) FROM issues) AS integrity,
 (SELECT jsonb_agg(to_jsonb(history) ORDER BY kind) FROM history) AS history,
 (SELECT count(*) FROM public.event_collaboration_invites WHERE status='pending') AS pending_invites;
