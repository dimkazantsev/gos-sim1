/* Guard the student → teacher → revision document visibility contract. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const teacher=fs.readFileSync('components/game/TeacherPartyDossiers.tsx','utf8');
const student=fs.readFileSync('components/game/PartiesView.tsx','utf8');
const orphans=fs.readFileSync('components/game/PartyUnregisteredFiles.tsx','utf8');

assert.match(hook,/if\(view==='teacher'\)jobs\.push\(loadPartyDocuments\(\)\)/,
 'Teacher view must fetch the registered documents, not just party representation');
assert.match(hook,/async function loadPartyDocuments\(\)[\s\S]*?from\('party_documents'\)\.select\('\*'\)\.eq\('game_id',gameId\)[\s\S]*?acceptPartyDocuments\(\(pd\.data\|\|\[\]\)/,
 'Teacher document loader must read game-scoped rows and update document state');
assert.match(hook,/async function reviewPartyDocument[\s\S]*?update\(\{status,note:note\?\.trim\(\)\|\|null\}\)[\s\S]*?await loadPartyDocuments\(\)/,
 'Review must persist status and note then refresh teacher documents');
assert.match(teacher,/const docs=partyDocuments\.filter\(d=>d\.party_id===p\.id\)/,
 'Each dossier must display only its own party documents');
assert.match(teacher,/g\.reviewPartyDocument\(id,status,status==='revision'\?reviewNotes\[id\]:undefined\)/,
 'Review must forward the entered return note');
assert.match(teacher,/reviewNotice\?\.id===d\.id/,
 'Review results should appear by the corresponding document');
assert.ok(student.includes('{history.slice(1).map(d=><p key={d.id}>{partyDocumentVersionLabel(d)} · {partyDocumentVerdict(d)}'),
 'Each document must expose prior versions without duplicating the current document');
assert.match(student,/history\.length>1&&<details className="partyRegistrationDocHistory"/, 'History controls are needed only when older versions exist');
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
// Stage closure must not disable the read-only Minjust document viewer.
assert.match(student,/<div className="gosPartyStageFieldset"><JusticeDocuments g=\\{g\\} partyId=\\{selected\\.id\\}\\/><\\/div>/,
 'Minjust documents remain clickable for party members after Stage 1 closes');
assert.doesNotMatch(student,/<fieldset className="gosPartyStageFieldset"[^>]*disabled/,
 'Never disable the document viewer through an ancestor fieldset');
assert.match(student,/if\\(!partyFormationOpen\\|\\|!selected\\|\\|selected\\.id!==partyId/,
 'Uploading a new document still requires the active party formation stage');
assert.match(student,/disabled=\\{busy\\|\\|!partyFormationOpen\\}/,
 'Upload controls remain disabled outside the stage work window');

console.log('PASS party documents: teacher hydration, party isolation, student revision notes, orphan separation.');
