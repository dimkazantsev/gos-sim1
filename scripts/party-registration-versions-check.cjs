const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function loadHelper(path){
 const source=fs.readFileSync(path,'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports',js)(exports);return exports;
}
const util=loadHelper('components/game/partyDocumentVersions.ts');
const doc=(kind,n,status='submitted',note=null)=>({id:kind+'-'+n,party_id:'a',doc_kind:kind,version_no:n,status,note,created_at:'2026-10-'+String(n).padStart(2,'0')+'T00:00:00Z'});
const docs=[
 doc('fee',1,'accepted'),
 doc('fee',2,'revision','Не приложен документ об оплате.'),
 doc('fee',3,'submitted'),
 doc('charter',1,'accepted'),
 doc('application',1,'accepted'),
 doc('program',1,'accepted'),doc('symbol',1,'accepted'),doc('congress_minutes',1,'accepted')
];
assert.equal(util.latestPartyDocument(docs,'fee').id,'fee-3');
assert.equal(util.partyDocumentVersionLabel(docs[2]),'В3');
assert.equal(util.partyDocumentVerdict(docs[1]),'На доработке');
assert.equal(util.latestPartyDocuments(docs).length,6);
assert.equal(util.latestPartyDocuments(docs).every(d=>d.status==='accepted'),false,
 'Older accepted fee must not satisfy registration');
const many=[];for(let i=1;i<=250;i++)many.push(doc('charter',i,i===250?'accepted':'revision'));
assert.equal(util.latestPartyDocuments(many)[0].version_no,250,'Attempts must not be limited to 10');
for(const path of ['components/game/PartiesView.tsx','components/game/TeacherPartyDossiers.tsx','components/game/PartyJusticeReview.tsx']){
 const source=fs.readFileSync(path,'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},fileName:path,reportDiagnostics:true});
 assert(!compiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error),path+' syntax error');
}
const student=fs.readFileSync('components/game/PartiesView.tsx','utf8');
const teacher=fs.readFileSync('components/game/TeacherPartyDossiers.tsx','utf8');
const server=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const registrar=fs.readFileSync('components/game/PartyJusticeReview.tsx','utf8');
assert(student.includes("publicDocs=selected?.registration_status==='registered'&&certificateIssued?"));
assert(student.includes("latestDocs.filter(d=>")&&student.includes("d.status==='accepted'"));
assert(student.includes('История рассмотрения')&&student.includes('Загрузить {current?'));
assert(student.includes('Замечания Минюста:')&&student.includes('История версий'));
assert(teacher.includes('latest?.id===d.id')&&teacher.includes('canReview&&'));
assert(teacher.includes("reviewNotes[d.id]")&&teacher.includes("review(d.id,'revision')"));
// Only the latest actionable attempt can be reviewed; the teacher row stays concise.
assert(teacher.includes('partyDossierDocRow')&&teacher.includes('<time dateTime={d.created_at}>'));
assert(teacher.includes("review(d.id,'accepted')")&&teacher.includes("review(d.id,'revision')"));
assert(teacher.includes('revisionFor===d.id&&canReview&&'),'Notes must open on demand');
assert(teacher.includes('partyDossierRevisionActions'),'An explicit confirmation is required');
assert(!teacher.includes('{d.title} · {d.file_name}'),'No long upload filename in teacher row');
assert(student.includes('partyRegistrationDoc"+(current?.status==="revision"?" isRevision":"")'),'Only the latest returned document highlights red');
assert(student.includes('registrationPackageRef.current.open=true'),'Revision must reveal party dossier');
assert(server.includes(".in('status',['submitted','draft'])"));
assert(registrar.includes('latestPartyDocuments(docs)'));
const sql=fs.readFileSync('supabase/migrations/20261015211500_party_registration_versions_and_privacy.sql','utf8');
for(const expected of [
 'pg_advisory_xact_lock','party_documents_version_guard','party_registration_latest_guard',
 'party_document_review_chat_notice','party_documents_version_unique',
 'version_no=private.latest_party_document_version',
 "p.registration_status='registered'", "f.doc_type='party_certificate'",
 'drop policy if exists game_assets_news_visibility',
 'drop policy if exists game_assets_read',
 'drop policy if exists game_assets_party_insert',
 'drop policy if exists formal_documents_read',
 'drop policy if exists political_posts_read',
 'private.party_registration_published',
 'create policy party_documents_delete on public.party_documents for delete to authenticated using(false)',
 'new.status=\'revision\' and length(btrim(coalesce(new.note,\'\')))<5'
])assert(sql.includes(expected),'Missing integrity or privacy guard: '+expected);
assert(!sql.includes('LIMIT 10'),'No artificial maximum attempt count');
const css=fs.readFileSync('app/party-registration-versions.css','utf8');
assert(css.includes('@media(max-width:850px)')&&css.includes('@media(max-width:420px)')&&css.includes('.partyRegistrationDocActions'));
assert(css.includes('.partyDossierDocRow')&&css.includes('.partyRegistrationDoc.isRevision'));
assert(css.includes('@media(max-width:850px)'),'Compact teacher rows must support narrow screens');
console.log('PASS: V1…V250, latest-only decisions, pre-certificate privacy, SQL access guards, teacher/student controls and mobile CSS');
