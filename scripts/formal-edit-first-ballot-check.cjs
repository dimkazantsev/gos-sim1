'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const migration=fs.readFileSync('supabase/migrations/20261119162951_edit_formal_document_until_first_ballot_20261119.sql','utf8');
const view=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
assert(migration.includes('join public.game_ballots b on b.vote_id=v.id'),
  'Permission decision must check a cast ballot, not merely an open vote');
assert(migration.includes('editable:=not has_ballot and'),
  'The first cast ballot permanently locks document text');
assert(migration.includes('perform v.id from public.game_votes v where v.formal_document_id=p_document_id'),
  'Save must lock linked votes before saving to avoid a first-vote race');
assert(migration.includes('order by v.id for update;'),
  'Vote locks must use the same lock ordering as ballot submission');
assert(migration.includes("if exists(") && migration.includes("raise exception 'Редактирование запрещено: по документу уже подан голос'"),
  'Server must deny a stale editor after the first ballot');
assert(view.includes('documentAccess?.can_edit===true'),
  'The editor button must use server permissions, without optimistic role guesses');
assert(view.includes('new Set(g.ballots.map(b=>b.vote_id))'),
  'Existing game ballot cache must detect first vote with no new API calls');
assert(view.includes('!hasCastVoteForSelected;'),
  'The editor must disappear after a ballot is cast');
assert(view.includes('editTitle.trim().length<3||hasCastVoteForSelected'),
  'Save button must be disabled if a vote arrives during editing');
assert(!view.includes("!votes.some(v=>v.formal_document_id===selected.id&&v.status==='open')"),
  'Opening a vote must not freeze text before a ballot');
console.log('PASS: 0 ballots permits authorized edit; first ballot prevents saving; no extra client reads');
