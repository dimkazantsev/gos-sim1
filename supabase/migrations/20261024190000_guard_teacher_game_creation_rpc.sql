-- Prevent anonymous players and ordinary members from creating whole games through
-- the legacy SECURITY DEFINER RPC. The verified teacher wrapper performs role checks
-- and calls this implementation as its postgres function owner.
-- Both functions already exist; this is privilege hardening, not data migration.
REVOKE ALL ON FUNCTION public.create_game_session(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_teacher_game_session(text,text,text,text,text) TO authenticated;
