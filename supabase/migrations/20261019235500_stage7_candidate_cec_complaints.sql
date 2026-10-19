-- Stage 7. Candidate complaint intake and CEC decisions, isolated from registration.
-- Referral to Supreme Court only records referral; it NEVER removes candidate.
CREATE TABLE IF NOT EXISTS public.presidential_cec_complaints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 game_id uuid NOT NULL REFERENCES public.games(id),
 candidate_id uuid NOT NULL REFERENCES public.presidential_candidates(id),
 submitted_by uuid NOT NULL REFERENCES auth.users(id),
 subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 8 AND 180),
 allegation text NOT NULL CHECK (length(btrim(allegation)) BETWEEN 30 AND 6000),
 legal_basis text,
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','maintained','dismissed','removed','referred_court')),
 resolution text,
 resolved_by uuid,
 resolved_at timestamptz,
 CONSTRAINT cec_complaint_resolution_consistency CHECK (
  (status='pending' AND resolved_at IS NULL AND resolved_by IS NULL)
  OR (status<>'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND length(btrim(resolution))>=30)
 )
);
CREATE INDEX IF NOT EXISTS presidential_cec_complaints_queue ON public.presidential_cec_complaints(game_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS presidential_cec_complaints_subject ON public.presidential_cec_complaints(candidate_id,created_at DESC);
ALTER TABLE public.presidential_cec_complaints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.presidential_cec_complaints FROM PUBLIC,anon;
GRANT SELECT ON public.presidential_cec_complaints TO authenticated;
DROP POLICY IF EXISTS cec_complaints_read ON public.presidential_cec_complaints;
CREATE POLICY cec_complaints_read ON public.presidential_cec_complaints
 FOR SELECT TO authenticated USING (
  private.is_game_member(game_id)
  AND (private.is_game_teacher(game_id) OR submitted_by=auth.uid()
    OR (status<>'pending' AND EXISTS(
     SELECT 1 FROM public.presidential_candidates c
     WHERE c.id=candidate_id AND c.game_id=presidential_cec_complaints.game_id
       AND (c.user_id=auth.uid() OR c.created_by=auth.uid())
    )))
 );
-- No direct INSERT/UPDATE/DELETE grants: controlled RPC enforces assignment and stage.
CREATE OR REPLACE FUNCTION public.submit_presidential_cec_complaint(
 p_candidate_id uuid,p_subject text,p_allegation text,p_legal_basis text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $fn$
DECLARE c public.presidential_candidates%rowtype; v_id uuid; v_uid uuid:=auth.uid();
BEGIN
 SELECT * INTO c FROM public.presidential_candidates WHERE id=p_candidate_id AND archived_at IS NULL;
 IF c.id IS NULL OR c.registration_status<>'registered' THEN
  RAISE EXCEPTION 'Жалобы принимаются в отношении зарегистрированных кандидатов' USING ERRCODE='23514';
 END IF;
 IF NOT private.is_game_member(c.game_id) OR
  NOT EXISTS(SELECT 1 FROM public.game_members gm
   WHERE gm.game_id=c.game_id AND gm.user_id=v_uid AND gm.kind='student' AND gm.roster_archived_at IS NULL) THEN
  RAISE EXCEPTION 'Жалобу вправе подать только действующий участник' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.game_stages s
    WHERE s.game_id=c.game_id AND s.stage_no=7 AND s.status='open') THEN
  RAISE EXCEPTION 'Приём жалоб доступен на открытом этапе 7' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.presidential_cec_complaints(game_id,candidate_id,submitted_by,subject,allegation,legal_basis)
 VALUES(c.game_id,c.id,v_uid,btrim(p_subject),btrim(p_allegation),nullif(btrim(coalesce(p_legal_basis,'')),''))
 RETURNING id INTO v_id;
 RETURN v_id;
END $fn$;
CREATE OR REPLACE FUNCTION public.resolve_presidential_cec_complaint(
 p_complaint_id uuid,p_outcome text,p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $fn$
DECLARE v_row public.presidential_cec_complaints%rowtype;c public.presidential_candidates%rowtype;
BEGIN
 SELECT * INTO v_row FROM public.presidential_cec_complaints WHERE id=p_complaint_id FOR UPDATE;
 IF v_row.id IS NULL THEN RAISE EXCEPTION 'Жалоба не найдена' USING ERRCODE='P0002'; END IF;
 IF NOT private.is_game_teacher(v_row.game_id) THEN
  RAISE EXCEPTION 'Решения по жалобам вправе принимать только ЦИК' USING ERRCODE='42501';
 END IF;
 IF v_row.status<>'pending' THEN
  RAISE EXCEPTION 'Решение по жалобе уже принято' USING ERRCODE='23514';
 END IF;
 IF p_outcome NOT IN ('maintained','dismissed','removed','referred_court') THEN
  RAISE EXCEPTION 'Некорректный вид решения по жалобе' USING ERRCODE='23514';
 END IF;
 IF length(btrim(coalesce(p_reason,'')))<30 THEN
  RAISE EXCEPTION 'Укажите мотивировку решения ЦИК (от 30 символов)' USING ERRCODE='23514';
 END IF;
 SELECT * INTO c FROM public.presidential_candidates WHERE id=v_row.candidate_id FOR UPDATE;
 IF c.id IS NULL OR c.game_id<>v_row.game_id THEN RAISE EXCEPTION 'Кандидат не найден' USING ERRCODE='23514'; END IF;
 IF p_outcome='removed' THEN
  IF c.registration_status<>'registered' THEN
   RAISE EXCEPTION 'Можно снять только зарегистрированного кандидата' USING ERRCODE='23514';
  END IF;
  IF coalesce(p_reason,'') !~* '(19-ФЗ|67-ФЗ|Конституц|стать[яие]|ст[. ]+[0-9]+)' THEN
   RAISE EXCEPTION 'Для снятия кандидата укажите применимую норму закона' USING ERRCODE='23514';
  END IF;
  UPDATE public.presidential_candidates SET registration_status='withdrawn',updated_at=now()
   WHERE id=c.id;
 END IF;
 UPDATE public.presidential_cec_complaints SET status=p_outcome,resolution=btrim(p_reason),
  resolved_by=auth.uid(),resolved_at=now()
 WHERE id=v_row.id;
END $fn$;
REVOKE ALL ON FUNCTION public.submit_presidential_cec_complaint(uuid,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.resolve_presidential_cec_complaint(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_presidential_cec_complaint(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_presidential_cec_complaint(uuid,text,text) TO authenticated;
