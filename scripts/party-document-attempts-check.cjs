'use strict';
const fs=require('fs'),assert=require('node:assert/strict'),ts=require('typescript');
const filename='components/game/partyDocumentWorkflow.ts';
let transpiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleExports={};new Function('exports','require',transpiled)(moduleExports,require);
const {partyDocumentLatest,partyLatestPublicDocuments,partyRegistrationReady,requiredPartyKinds}=moduleExports;
const base=requiredPartyKinds.map((doc_kind,index)=>({id:'v1-'+index,party_id:'demo',doc_kind,version_no:1,created_at:'2026-01-01T00:00:00Z',status:'accepted'}));
assert.equal(partyRegistrationReady(base),true,'All six accepted latest versions may register');
assert.equal(partyLatestPublicDocuments(base,false).length,0,'Before certificate NOTHING is public');
assert.equal(partyLatestPublicDocuments(base,true).length,4,'After certificate only public types release');
const v2={...base[0],id:'v2',version_no:2,status:'revision',note:'Нет подписи',created_at:'2026-01-02T00:00:00Z'};
assert.equal(partyRegistrationReady([...base,v2]),false,'An accepted old version may NOT authorise registration');
assert.equal(partyDocumentLatest([...base,v2]).get('application').id,'v2');
assert.equal(partyRegistrationReady([...base,{...v2,status:'accepted'}]),true);
const attempts=Array.from({length:1200},(_,i)=>({...base[1],id:'v'+(i+1),version_no:i+1,status:i===1199?'submitted':'revision',created_at:new Date(Date.UTC(2026,0,1,0,i)).toISOString()}));
assert.equal(partyDocumentLatest(attempts).get('charter').version_no,1200,'Attempts must be unbounded');
assert.equal(partyRegistrationReady([...base,...attempts]),false);
assert.equal(partyLatestPublicDocuments([...base,...attempts],true).some(d=>d.doc_kind==='charter'),false,'Old accepted charter cannot leak');
const sql=fs.readFileSync('supabase/migrations/20261015201500_party_document_versioned_review_private_release.sql','utf8');
for(const snippet of ['row_number() OVER (PARTITION BY party_id,doc_kind','FOR UPDATE',
 'party_documents_party_kind_version_unique','CREATE POLICY party_documents_read','AS RESTRICTIVE FOR SELECT',
 'party_dossier_storage_release','party_justice_correspondence_visibility','party_registration_certified',
 "NEW.status:='submitted'",'latest_version_idx', "party_pending_justice_post_visibility"]){
 assert(sql.includes(snippet),'Missing SQL protection: '+snippet);
}
assert(!/LIMIT\s+\d+\s+ATTEMPTS/i.test(sql),'No fixed attempt quota');
const t=fs.readFileSync('components/game/TeacherPartyDossiers.tsx','utf8'),p=fs.readFileSync('components/game/PartiesView.tsx','utf8');
assert(t.includes("const canReview=isCurrent")&&t.includes("reviewNotes[id]"),'Teacher reviews latest with notes');
assert(t.includes("note.length<5"),'Revision requires explanation');
assert(p.includes("data-party-doc-kind={kind}")&&p.includes("uploadVersion(kind,file)"),'Members can resubmit individual documents');
assert(p.includes("Заключение Минюста")&&p.includes("История версий"),'Members see each decision and history');
assert(p.includes('partyLatestPublicDocuments(docs,certified)'),'Only certified latest accepted are public');
assert(fs.readFileSync('components/game/PartyJusticeReview.tsx','utf8').includes('partyRegistrationReady(docs)'));
console.log('PASS 6 document types; 1,200 attempts; latest-only registration; privacy and UI checks');
