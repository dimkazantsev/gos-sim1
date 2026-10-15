/* Party document attempt lifecycle: current-version selection + privacy invariants. */
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),Module=require('node:module');
const path='components/game/partyDocumentAttempts.ts',mod=new Module(path,module);
mod.filename=path;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,path);
const {partyDocumentLatest,partyDocumentAttempts,partyDocumentsReady,partyDocumentVersion,partyDocumentStatus}=mod.exports;
const make=(party_id,kind,version,status,notes='')=>({
 id:party_id+kind+version,game_id:'game-1',party_id,doc_kind:kind,
 version_number:version,status,note:notes,created_at:'2026-10-15T12:'+String(version).padStart(2,'0')+':00Z',
 file_name:'file-v'+version+'.pdf'
});
const kinds=['application','charter','program','fee','symbol','congress_minutes'];
const originals=kinds.map(kind=>make('party-A',kind,1,'accepted'));
const changes=[...originals,make('party-A','fee',2,'revision','Не подтверждена уплата')];
assert.equal(partyDocumentLatest(changes).length,6);
assert.equal(partyDocumentLatest(changes).find(d=>d.doc_kind==='fee').version_number,2);
assert.equal(partyDocumentAttempts(changes,'fee').map(d=>d.version_number).join(','),'2,1');
assert.equal(partyDocumentsReady(originals,kinds),true);
assert.equal(partyDocumentsReady(changes,kinds),false,'Old accepted fee cannot satisfy new revision');
changes.push(make('party-A','fee',3,'submitted'));
assert.equal(partyDocumentsReady(changes,kinds),false,'Latest submitted version is not yet approved');
changes.push({...changes.pop(),status:'accepted'});
assert.equal(partyDocumentsReady(changes,kinds),true,'Latest approved attempt permits registration');
const mixed=[...changes,make('party-B','fee',1,'submitted')];
assert.equal(partyDocumentLatest(mixed).length,7,'Document histories are isolated per party');
assert.equal(partyDocumentVersion({version_number:73}),73,'No artificial version cap');
assert.match(partyDocumentStatus({status:'revision'}),/доработку/);
const sql=fs.readFileSync('supabase/migrations/20261015220000_party_document_attempts_and_private_registration.sql','utf8');
for(const needle of [
 'CREATE UNIQUE INDEX IF NOT EXISTS party_documents_kind_version_unique',
 'FOR UPDATE','new.version_number:=coalesce',
 "new.status:='submitted'",
 'new.note:=NULL',
 'party_documents_read ON public.party_documents FOR SELECT TO authenticated',
 'AS RESTRICTIVE FOR SELECT TO authenticated',
 "registration_status='registered' AND p_status='accepted'",
 'private.original_issue_party_justice_response',
 "IF p_status='registered' THEN",
 'REVOKE ALL ON FUNCTION public.review_party_registration(uuid,text,text) FROM public,anon,authenticated',
 'Доработк'
]){
 if(!sql.includes(needle)&&needle!=='Доработк')assert.fail('Required migration guard missing: '+needle);
}
const view=fs.readFileSync('components/game/PartiesView.tsx','utf8');
const teacher=fs.readFileSync('components/game/TeacherPartyDossiers.tsx','utf8');
const justice=fs.readFileSync('components/game/PartyJusticeReview.tsx','utf8');
assert(view.includes("selected?.registration_status==='registered'?currentDocs.filter"),'Public documents are gated');
assert(view.includes("partyDocumentAttempts(docs,required.kind)"),'Members see each document history');
assert(view.includes("Загрузить версию В"),'Individual document resubmission exists');
assert(view.includes('current.note'), 'Review explanation visible');
assert(teacher.includes('currentDocs.map(d=><li'),'Teacher reviews only current attempt');
assert(teacher.includes('partyDocumentAttempts(docs,d.doc_kind)'),'Teacher can inspect older attempts');
assert(justice.includes('partyDocumentsReady(docs,'),'Certificate issuance uses current versions');
console.log('PASS: immutable unlimited versions, latest-status gate, party isolation, private publication rules and both role interfaces');
