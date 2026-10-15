/* Guard the student → teacher → revision document visibility contract. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const teacher=fs.readFileSync('components/game/TeacherPartyDossiers.tsx','utf8');
const student=fs.readFileSync('components/game/PartiesView.tsx','utf8');
const orphans=fs.readFileSync('components/game/PartyUnregisteredFiles.tsx','utf8');

assert.match(hook,/if\(view==='teacher'\)jobs\.push\(loadPartyDocuments\(\)\)/,
 'Teacher view must fetch the registered documents, not just party representation');
assert.match(hook,/async function loadPartyDocuments\(\)[\s\S]*?from\('party_documents'\)\.select\('\*'\)\.eq\('game_id',gameId\)[\s\S]*?setPartyDocuments\(rows\)/,
 'Teacher document loader must read game-scoped rows and update document state');
assert.match(hook,/async function reviewPartyDocument[\s\S]*?update\(\{status,note:note\?\.trim\(\)\|\|null\}\)[\s\S]*?await loadPartyDocuments\(\)/,
 'Review must persist status and note then refresh teacher documents');
assert.match(teacher,/const docs=partyDocuments\.filter\(d=>d\.party_id===p\.id\)/,
 'Each dossier must display only its own party documents');
assert.match(teacher,/g\.reviewPartyDocument\(id,status,status==='revision'\?reviewNotes\[id\]:undefined\)/,
 'Review must forward the entered return note');
assert.match(teacher,/reviewNotice\?\.id===d\.id/,
 'Review results should appear by the corresponding document');
assert.match(student,/docs\.map\(d=>\{const version=[\s\S]*?d\.status==='revision'\?'На доработке'/,
 'Students must see numbered attempts and revisions');
assert.match(student,/\{d\.note&&<p role="status">Замечание Минюста к версии В\{version\}: \{d\.note\}<\/p>\}/,
 'Students must see a return note for the matching version');
assert.match(student,/registration_status==='registered'\?latestDocs\.filter/,
 'Public documents must be withheld until registration');
assert.match(teacher,/latestDocs\.some\(x=>x\.id===d\.id\)/,
 'Teacher actions must use only the latest version');
assert.match(orphans,/<details aria-label="Технические загрузки без регистрации"/,
 'Technical Storage objects must remain separate from submitted documents');
const migration=fs.readFileSync('supabase/migrations/20261015224500_party_document_visibility_versions.sql','utf8');
assert.match(migration,/private\.party_registration_published\(party_id\)/,'Public document access requires issued certificate');
assert.match(migration,/newer\.created_at>d\.created_at/,'Server registration must reject accepted superseded versions');
assert.match(migration,/p\.registration_status='registered'/,'Registered party must not be reverted by another submission');
console.log('PASS party documents: teacher hydration, party isolation, student revision notes, orphan separation.');
