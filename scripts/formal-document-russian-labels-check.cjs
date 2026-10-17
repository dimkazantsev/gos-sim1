/* Regression: UI must never expose persisted English document type identifiers. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'components/game/formalInstitutions.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const sandboxModule={exports:{}};
vm.runInNewContext(compiled,{module:sandboxModule,exports:sandboxModule.exports});
const {formalDocumentTypeLabel,formalDocumentTitle,formalSubjectDisplayLabel,ownerLabel,FORMAL_TYPES}=sandboxModule.exports;
for(const [code,label] of Object.entries({
 party_certificate:'Свидетельство о государственной регистрации политической партии',
 justice_response:'Официальный ответ Министерства юстиции Российской Федерации',
})){assert.equal(formalDocumentTypeLabel(code),label);}
for(const type of FORMAL_TYPES){assert.equal(formalDocumentTypeLabel(type.key),type.label);assert.match(type.label,/[А-Яа-яЁё]/);}
assert.equal(formalDocumentTypeLabel('not_registered_internal_key'),'Документ');
assert.equal(ownerLabel('unknown_internal_role'),'Ответственный орган');
assert.equal(formalDocumentTitle('party_certificate','party_certificate'),'Свидетельство о государственной регистрации политической партии');
assert.equal(formalDocumentTitle('party_certificate','other'),'Свидетельство о государственной регистрации политической партии');
assert.equal(formalDocumentTitle('justice_response','justice_response'),'Официальный ответ Министерства юстиции Российской Федерации');
assert.equal(formalDocumentTitle('fz_bill','other'),'Проект федерального закона');
assert.equal(formalDocumentTitle('unknown_internal_key','party_certificate'),'Свидетельство о государственной регистрации политической партии');
assert.equal(formalDocumentTitle('','other'),'Иной формальный институт / документ');
assert.equal(formalDocumentTitle('Goust Voting','other'),'Goust Voting');
assert.equal(formalDocumentTitle('Название, указанное автором','other'),'Название, указанное автором');
const view=fs.readFileSync(path.join(root,'components/game/DocumentsView.tsx'),'utf8');
assert.match(view,/function typeLabel\(key:string\)\{return formalDocumentTypeLabel\(key\)\}/);
assert.match(view,/typeLabel\(selected\.doc_type\)/);
assert.match(view,/typeLabel\(d\.doc_type\)/);
assert.match(view,/formalDocumentTitle\(d\.title,d\.doc_type\)/);
assert.doesNotMatch(view,/<h3>\{d\.title\}<\/h3>/);
for(const path of [
 'components/game/DocumentPaper.tsx',
 'components/game/FormalDocumentPicker.tsx',
 'components/game/PoliticalWallView.tsx',
 'components/game/NewsProposals.tsx',
 'components/game/VotesView.tsx',
 'components/game/DocumentTools.tsx',
]){
 assert.match(fs.readFileSync(require('node:path').join(root,path),'utf8'),/formalDocumentTitle\(/,path);
}
assert.doesNotMatch(view,/FORMAL_TYPES\.find\(x=>x\.key===key\)\?\.label\|\|key/);
const dossier=fs.readFileSync(path.join(root,'components/game/TeacherPartyDossiers.tsx'),'utf8');
assert.doesNotMatch(dossier,/docLabels\[d\.doc_kind\]\|\|d\.doc_kind/);
const uploads=fs.readFileSync(path.join(root,'components/game/PartyUnregisteredFiles.tsx'),'utf8');
assert.doesNotMatch(uploads,/Supabase Storage|>[^<]*Storage[^<]*</);
const votes=fs.readFileSync(path.join(root,'components/game/VotesView.tsx'),'utf8');
assert.doesNotMatch(votes,/Стадия НПА: '\+v\.formal_step_code/);
assert.doesNotMatch(votes,/GV уменьшает| GV −| GV'/);
const events=fs.readFileSync(path.join(root,'components/game/EventWorkspace.tsx'),'utf8');
assert.doesNotMatch(events,/EVENT · ИГРОВЫЕ СИТУАЦИИ/);
console.log('PASS: Русские заголовки документов в НПА, голосованиях, СМИ, политическом процессе и входящих.');

assert.equal(formalSubjectDisplayLabel('unknown_subject_key','unknown_subject_key'),'Государственный орган');
