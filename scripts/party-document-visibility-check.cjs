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
assert.match(student,/history\.map\(d=>[\s\S]*?partyDocumentVersionLabel\(d\) · \{partyDocumentVerdict\(d\)\}/,
 'Each document must expose every prior verdict and version inside its own history');
assert.match(student,/d\.note&&<small> · \{d\.note\}<\/small>/,
 'Older teacher remarks must remain accessible in document history');
assert.match(student,/current\?\.status==="revision"&&<p className="partyRegistrationRevisionNote"/,
 'Current returned document and correction grounds must be visually emphasized');
assert.doesNotMatch(student,/partyRegistrationUpdates/,
 'Do not introduce a second parallel review timeline');
assert.match(student,/partyDocumentVersionLabel\(d\)/,
 'Students must see the reviewed document version');
assert.match(orphans,/<details aria-label="Технические загрузки без регистрации"/,
 'Technical Storage objects must remain separate from submitted documents');
console.log('PASS party documents: teacher hydration, party isolation, student revision notes, orphan separation.');
