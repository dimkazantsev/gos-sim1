-- ГОС.ID: PR #256 uses committee_mandate_allocations as the single authoritative
-- distribution ledger. The earlier experimental allocator used
-- institution_assignments.mandates_allocated and is not part of the published UI.
-- Keep the existing data and code for recovery/forensics, but forbid clients
-- to mutate the stale ledger. The canonical set_committee_mandates remains granted.
REVOKE ALL ON FUNCTION public.allocate_committee_mandates(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated;

DO $safety$
BEGIN
  IF to_regprocedure('public.set_committee_mandates(uuid,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Canonical committee mandate RPC missing; refusing safety migration';
  END IF;
END;
$safety$;
