-- Direct table DELETE is revoked from authenticated users.
-- Deletion is authorized inside public.delete_procedural_vote(uuid),
-- so the extra DELETE RLS policy is intentionally removed to avoid
-- overlapping permissive policies.
drop policy if exists "game_votes_delete_owner_or_teacher" on public.game_votes;
