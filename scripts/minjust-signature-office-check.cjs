const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../components/game/documentSignerTitle.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};
const context={exports,require:(name)=>{
 if(name==='./formalInstitutions')return {FORMAL_SUBJECTS:[
  {key:'sf',signatureTitle:'Председатель Совета Федерации'},
  {key:'gd',signatureTitle:'Председатель Государственной Думы'}
 ]};
 throw new Error('Unexpected import '+name);
}};
vm.runInNewContext(compiled,context);
const {documentSignerTitle,MINJUST_REGISTRATION_SIGNER_TITLE}=exports;
const doc=(doc_type,subject_key,metadata={})=>({doc_type,subject_key,subject_label:'',metadata});
assert.equal(documentSignerTitle(doc('justice_response','minjust'),'Председатель Совета Федерации'),MINJUST_REGISTRATION_SIGNER_TITLE);
assert.equal(documentSignerTitle(doc('justice_response','minjust'),'Преподаватель'),MINJUST_REGISTRATION_SIGNER_TITLE);
assert.equal(documentSignerTitle(doc('party_certificate','minjust'),'Председатель Совета Федерации'),MINJUST_REGISTRATION_SIGNER_TITLE);
assert.equal(documentSignerTitle(doc('sf_resolution','sf'),'Председатель Совета Федерации'),'Председатель Совета Федерации');
assert.equal(documentSignerTitle(doc('gd_resolution','gd',{acting_office_title:'Председатель Государственной Думы'}),null),'Председатель Государственной Думы');
console.log('Minjust signature role: 5 focused checks passed.');
