-- Keep the internal role helper inaccessible as an RPC and callable
-- only from authorized SECURITY DEFINER server procedures.
REVOKE ALL ON FUNCTION private.has_effective_role_like(uuid,uuid,text[])
 FROM PUBLIC,anon,authenticated;
