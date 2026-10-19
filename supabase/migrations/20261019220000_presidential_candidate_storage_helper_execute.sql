-- Restore authenticated access to the narrow Storage RLS helper.
GRANT EXECUTE ON FUNCTION private.can_upload_presidential_candidate_document(uuid,uuid) TO authenticated;
