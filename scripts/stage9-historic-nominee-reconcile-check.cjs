'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261021155754_stage9_reconcile_confirmed_historical_minister_identities.sql'),'utf8');

const expected=[
 ['ministry_foreign','Иванов Иван Ивановича','Иванов Иван Иванович'],
 ['ministry_defence','Иванов Иван Ивановичв','Тестов Тест Тестович'],
 ['ministry_internal','Иванов Иван Ивановича','Иванов Иван Иванович']
];
for(const [office,previous,confirmed] of expected){
 const row="('"+office+"','"+previous+"','"+confirmed+"')";
 assert.equal(sql.split(row).length-1,2,'Exact source and target in each preflight/mutation pass: '+office);
}
assert.match(sql,/v_games<>1/,'Only one unambiguous target game allowed');
assert.ok(!sql.includes('min(game_id)')&&!sql.includes('min(user_id)'),'Do not use min(uuid)');
assert.ok(sql.includes('min(game_id::text)::uuid'),'Expected valid game ID lookup');
assert.ok(sql.includes('min(user_id::text)::uuid'),'Expected valid student ID lookup');
assert.match(sql,/candidate_user_id IS NULL/,'Prevent rewriting linked existing appointments');
assert.match(sql,/kind='student' AND roster_archived_at IS NULL/,'Use active registered students only');
assert.match(sql,/FOR UPDATE/,'Concurrent edits must serialize');
assert.match(sql,/pg_advisory_xact_lock/,'Avoid concurrent reconciliations');
assert.match(sql,/appointment_document_id IS NULL/,'Appointment decree preflight');
assert.match(sql,/status_code='published'/,'Require matching signed historic acts');
assert.match(sql,/metadata->>'nomination_id'=v_nom.id::text/,'Reject unrelated document');
assert.match(sql,/ON CONFLICT \(unit_id,user_id\)/,'Prevent duplicate leadership records');
assert.match(sql,/SET assignment_role='head'/,'Link leadership for each independent ministry');
assert.match(sql,/original_document_preserved',true/,'Preserve original signed acts');
assert.match(sql,/formal_document_history/,'Track corrections in the document history');
assert.match(sql,/owner_confirmed_historic_minister_identity/,'Audit exact owner-approved links');
assert.match(sql,/votes_and_scores_unchanged',true/,'Never rewrite votes and scores');
for(const table of ['game_votes','vote_ballots','game_office_assignments','game_members','formal_document_signatures','formal_document_revisions','game_events']){
 assert.doesNotMatch(sql,new RegExp('(?:update|delete\\s+from)\\s+(?:public\\.)?'+table+'\\b','i'),'Forbidden modification to '+table);
}
assert.doesNotMatch(sql,/set\s+[^;]*\b(body_text|title|status_code|registry_no|signed_by)\s*=/i,'Signed fields unchanged');
console.log('PASS: three exact confirmed mappings, atomic preflight, linked ministry heads, audit trail and immutable historic signed acts.');
