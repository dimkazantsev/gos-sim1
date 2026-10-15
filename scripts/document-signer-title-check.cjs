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
assert.equal(role('justice_response','minjust','Министр юстиции Российской Федерации'),'Министр юстиции Российской Федерации');
assert.equal(role('justice_response','minjust','Преподаватель',{signatory_title:'Начальник Управления Минюста'}),'Начальник Управления Минюста');
assert.equal(role('government_resolution','government','Преподаватель',{acting_office_title:'Заместитель Председателя Правительства Российской Федерации'}),'Заместитель Председателя Правительства Российской Федерации');
assert.equal(role('sf_resolution','sf','Преподаватель-администратор',{acting_office_title:'Администратор игры'}),'Председатель Совета Федерации');
assert.equal(role('sf_resolution','sf','Председатель Совета Федерации'),'Председатель Совета Федерации');
const paper=fs.readFileSync('components/game/DocumentPaper.tsx','utf8');
assert(paper.includes('role=documentSignerTitle(d,metadataSigned?m.signed_role:null)'),'Signed paper must resolve a contextual game office');
assert(paper.includes('<b>{name}</b>')&&paper.includes("role||'Уполномоченное лицо'"),'Existing signer name/date display is preserved');
console.log('PASS: signer office follows signed authority, existing office snapshot prevails, technical access role never appears');
