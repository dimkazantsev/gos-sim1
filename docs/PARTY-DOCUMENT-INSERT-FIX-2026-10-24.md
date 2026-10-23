# Party document INSERT repair — 24 October 2026

## Observed failure

Production PostgreSQL logs on 23 October 2026 at 18:36 UTC contain repeated
PostgREST INSERT failures in public.party_documents after the Storage upload:

```text
SQLSTATE 42883
function private.stage4_legal_act_can_finalize(party_documents, party_documents, uuid) does not exist
PL/pgSQL function guard_stage_submission() line 47 at IF
```

The same failure was reproduced using SET LOCAL ROLE authenticated and an
existing active student with a party whose chair had not yet been elected.
The reproduction was rolled back.

RLS is enabled. The inspected INSERT policy requires the uploader to match
auth.uid(), an active student in the same party or the game's teacher, and a
party that is not registered. SELECT and teacher review policies were also
inspected. The failure originated in the shared stage trigger, not these policies.

## Correction

Migration 20261023184805_party_document_stage_trigger_composite_scope.sql
limits the two helpers taking public.formal_documents row arguments to a
procedural IF for formal_documents UPDATE. A boolean AND in the original
condition did not prevent PostgreSQL from resolving the helpers for a different
trigger row type. The function remains shared by party_documents,
party_invitations and formal_documents.

The replacement retains the live function's permissions, search_path,
membership/stage/deadline checks and existing formal-document exceptions.
It also records the already-live permission to upload party drafts before
chair election. RLS, Storage policies, files and application code are unchanged.
The migration filename matches the version recorded by Supabase.

## Verification

- New regression: `node scripts/party-document-stage-trigger-check.cjs --before`
  fails with the original 42883; without --before it passes.
- The new check executes the real document RLS/version guard and invitation
  RPCs. It covers all three trigger relations, pre-chair upload, teacher
  upload, cross-party confidentiality, unauthorized/archived/observer
  rejection, closed/expired stages, paused game, registered-party lock and
  both typed formal UPDATE branches. The two helper return values are fixtures;
  their authorization internals are checked separately.
- Existing hook/revision, Storage INSERT/UPDATE, document visibility/versioning,
  certified program privacy and returned GD minutes authorization checks pass.
- Live database transaction after applying the migration: student INSERT with
  RETURNING, teacher revision with note, student V2, teacher acceptance, student
  history, teacher upload and cross-party read/INSERT denial all pass. ROLLBACK
  removed the three temporary submissions and their transactional notices.
  A separate query confirmed zero test documents remained. Fifteen prior orphan
  Storage files were preserved; their intended document kind cannot be inferred.
- Real Chrome UI at 320/390/900/1600 px passes the teacher return → student retry
  → V2 → teacher acceptance flow, history, stage closure and certificate gates.
  A second run with no elected chair passes all six upload controls and keeps
  full registration submission unavailable. UI uses fictional state; it does
  not prove a real browser-to-Supabase upload.
- Mobile header regression passes at 320/390/428/650/768/1280 px.
- Local Next tests/build use --webpack because Turbopack does not resolve the
  dependency junction outside the isolated clone. No production configuration
  was changed for this environment constraint.
- Supabase security advisor finding counts are unchanged after the migration.
  Existing project advisories were not remediated as part of this upload repair.
- TypeScript, design/contrast (130 checks), news lifecycle, Russian interface
  checks and the complete production build with --webpack all pass.

## Release baseline

Prepared from GitHub main dca4cd8604af5b1d8d852fa6ad9d6a1e4e2fdcec in a
separate clone. The original working directory's unrelated edits were preserved.
Supabase migration was applied and verified separately from GitHub publication.
GitHub Pages is the static publishing workflow. Vercel already reported a build
rate limit on the baseline; this SQL repair takes effect in the shared database.

