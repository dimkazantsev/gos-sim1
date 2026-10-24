-- Ensure game creation remains available to verified teachers even after
-- their last game has been archived. A teacher profile is only insertable by
-- an authorized platform admin / existing game owner / teacher under RLS.
CREATE OR REPLACE FUNCTION public.create_teacher_game_session(
 p_title text, p_game_code text, p_teacher_code text, p_student_code text, p_teacher_name text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $teacher_gate$
BEGIN
 IF auth.uid() IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean,true) THEN
  RAISE EXCEPTION 'Войдите по электронной почте и личному паролю' USING errcode='42501';
 END IF;
 IF NOT private.is_platform_admin()
    AND NOT EXISTS (SELECT 1 FROM public.teacher_profiles t WHERE t.user_id=auth.uid())
    AND NOT EXISTS (SELECT 1 FROM public.game_members g WHERE g.user_id=auth.uid()
       AND g.kind='teacher' AND g.roster_archived_at IS NULL)
 THEN
  RAISE EXCEPTION 'Создавать игры может только преподаватель или администратор' USING errcode='42501';
 END IF;
 RETURN public.create_game_session(p_title,p_game_code,p_teacher_code,p_student_code,p_teacher_name);
END;
$teacher_gate$;

-- Do not expose legacy SECURITY DEFINER to students, guests or anonymous
-- sessions. The protected function above calls it as its postgres owner.
REVOKE ALL ON FUNCTION public.create_game_session(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_teacher_game_session(text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_teacher_game_session(text,text,text,text,text) TO authenticated;
