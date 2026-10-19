-- Public CEC decision summaries on stage 7. The allegation and author stay private.
CREATE OR REPLACE FUNCTION public.list_presidential_cec_complaint_decisions(p_game_id uuid)
RETURNS TABLE (id uuid,candidate_id uuid,status text,resolution text,resolved_at timestamptz,case_number text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public,private,pg_temp AS $fn$
 SELECT c.id,c.candidate_id,c.status,c.resolution,c.resolved_at,ref.case_number
 FROM public.presidential_cec_complaints c
 LEFT JOIN public.presidential_cec_court_referrals ref ON ref.complaint_id=c.id
 WHERE c.game_id=p_game_id AND c.status<>'pending'
  AND private.is_game_member(p_game_id)
 ORDER BY c.resolved_at DESC;
$fn$;
REVOKE ALL ON FUNCTION public.list_presidential_cec_complaint_decisions(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_presidential_cec_complaint_decisions(uuid) TO authenticated;
