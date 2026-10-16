-- Restore access to existing private voting predicates for authenticated callers.
-- Incident: SQLSTATE 42501 "permission denied for function vote_member_has_office"
-- when SECURITY INVOKER voting helpers inspect an institution's electorate.
-- This grants only EXECUTE on two boolean helpers. It does not grant
-- voting, office assignments, table access or administrative RPC rights.
DO $$
BEGIN
 IF to_regprocedure('private.vote_member_has_office(uuid,uuid,text)') IS NULL
    OR to_regprocedure('private.vote_member_matches(uuid,uuid,text)') IS NULL
 THEN
  RAISE EXCEPTION 'Voting permission helpers have changed; inspect migration before applying';
 END IF;
END $$;

REVOKE EXECUTE ON FUNCTION private.vote_member_has_office(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.vote_member_matches(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.vote_member_has_office(uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.vote_member_matches(uuid,uuid,text) TO authenticated, service_role;
