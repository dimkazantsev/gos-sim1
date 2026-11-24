const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
function readModule(path,deps={}){
 const source=fs.readFileSync(path,'utf8');
 const js=ts.transpileModule(source,{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert(!js.diagnostics?.some(x=>x.category===ts.DiagnosticCategory.Error),path+' must parse');
 const exports={};
 new Function('exports','require',js.outputText)(exports,id=>{if(!(id in deps))throw Error('Unknown dependency: '+id);return deps[id]});
 return exports;
}
const institutions=readModule('components/game/formalInstitutions.ts');
const signatures=readModule('components/game/documentSignerTitle.ts',{'./formalInstitutions':institutions});
const role=(docType,subjectKey,capturedRole,metadata={},subjectLabel='Министерство')=>
 signatures.documentSignerTitle({doc_type:docType,subject_key:subjectKey,subject_label:subjectLabel,metadata},capturedRole);
const minjust=signatures.MINJUST_REGISTRATION_SIGNER_TITLE;
assert.equal(role('justice_response','minjust','Преподаватель'),minjust);
assert.equal(role('justice_response','minjust',null),minjust);
assert.equal(role('party_certificate','minjust','Администратор'),minjust);
assert.equal(role('president_decree','president','Преподаватель'),'Президент Российской Федерации');
assert.equal(role('sf_resolution','sf','Руководитель симуляции'),'Председатель Совета Федерации');
assert.equal(role('government_resolution','government','Преподаватель'),'Председатель Правительства Российской Федерации');
assert.equal(role('other','other','Преподаватель',{issuer_name:'Счётная палата Российской Федерации'}),'Уполномоченное лицо — Счётная палата Российской Федерации');
assert.equal(role('justice_response','minjust','Министр юстиции Российской Федерации'),minjust);
assert.equal(role('justice_response','minjust','Преподаватель',{signatory_title:'Начальник Управления Минюста'}),minjust);
assert.equal(role('government_resolution','government','Преподаватель',{acting_office_title:'Заместитель Председателя Правительства Российской Федерации'}),'Заместитель Председателя Правительства Российской Федерации');
assert.equal(role('sf_resolution','sf','Преподаватель-администратор',{acting_office_title:'Администратор игры'}),'Председатель Совета Федерации');
assert.equal(role('justice_response','minjust','Преподаватель',{signatory_title:'Заместитель министра юстиции',acting_office_title:'Сотрудник Минюста'}),minjust);


assert.equal(role('sf_resolution','sf','Председатель Совета Федерации'),'Председатель Совета Федерации');
const responsible=(docType,subjectKey,metadata={},subjectLabel='',required=[])=>signatures.documentSigningAuthority({
 doc_type:docType,subject_key:subjectKey,subject_label:subjectLabel,metadata
},required);
assert.equal(responsible('fz_bill','gd_deputy'), 'Президент Российской Федерации (после прохождения установленной процедуры)', 'A bill is signed by President, not deputy-author');
assert.equal(responsible('fkz_bill','sf_member'),'Президент Российской Федерации (после прохождения установленной процедуры)');
assert.equal(responsible('federal_budget','government'),'Президент Российской Федерации (после прохождения установленной процедуры)');
assert.equal(responsible('president_decree','president',{},'Президент Российской Федерации'),'Президент Российской Федерации — Президент Российской Федерации');
assert.equal(responsible('gd_resolution','gd',{},'Государственная Дума Федерального Собрания РФ'),'Государственная Дума Федерального Собрания РФ — Председатель Государственной Думы');
assert.equal(responsible('sf_resolution','sf',{},'Совет Федерации Федерального Собрания РФ'),'Совет Федерации Федерального Собрания РФ — Председатель Совета Федерации');
assert.equal(responsible('government_resolution','government',{},'Правительство Российской Федерации'),'Правительство Российской Федерации — Председатель Правительства Российской Федерации');
assert.equal(responsible('ministry_order','ministry',{issuer_name:'Министерство по экономической политике'},'Федеральное министерство'),'Министерство по экономической политике — Федеральный министр');
assert.equal(responsible('justice_response','minjust'),'Министерство юстиции Российской Федерации — '+minjust);
assert.equal(responsible('meeting_agenda','gd',{},'Государственная Дума',[
 {office:'Председатель Государственной Думы'},{office:'Заместитель Председателя Государственной Думы'}
]),'Государственная Дума — Председатель Государственной Думы; Заместитель Председателя Государственной Думы');
assert.match(responsible('meeting_agenda','ksrf',{},'КСРФ'),/состав уполномоченных подписантов пока не подтверждён/,'Missing signer list cannot claim a person has signed');
const view=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
// Evaluate the actual signer expression from the rendered procedure, including
// the approved teacher decision for SF legislative/budget review.
const signerExpression=view.match(/Документ подписывает: <b>\{([^{}]+)\}<\/b>/);
assert(signerExpression,'Signing institution remains visible in the procedure');
const renderSigner=new Function('selected','institutionSigners','documentSigningAuthority','return ('+signerExpression[1]+')');
for(const workflow_key of ['bill','budget','other']){
 for(const status_code of ['sf','president','draft']){
  const selected={workflow_key,status_code};
  const required=[{office:'Existing authority'}];
  let reads=0;
  const actual=renderSigner(selected,{required},(doc,signers)=>{reads++;assert.equal(doc,selected);assert.equal(signers,required);return 'Existing authority';});
  const teacherReview=status_code==='sf'&&['bill','budget'].includes(workflow_key);
  assert.equal(actual,teacherReview?'Преподаватель (решение Совета Федерации)':'Existing authority');
  assert.equal(reads,teacherReview?0:1);
 }
}
assert(view.includes('!isTerminalDocument&&<p>Документ подписывает:'),'Terminal document does not display a future signer');
assert(!view.includes("rpc('get_document_signing_authority'"),'No new signature lookups');

const paper=fs.readFileSync('components/game/DocumentPaper.tsx','utf8');
assert(paper.includes('role=documentSignerTitle(d,isRoleSigner?m.acting_office_title:metadataSigned?m.signed_role:null)'),'Signed paper must use the verified acting office when a role-specific name is present');
assert(paper.includes('name=isRoleSigner?roleName:'),'Role-specific personal name must match the signed office');
assert(paper.includes('<b>{name}</b>')&&paper.includes("role||'Уполномоченное лицо'"),'Existing signer name/date display is preserved');
console.log('PASS: approved Minjust institutional signer overrides unrelated roles, other offices use signed authority');
