/* ГОС.ID · Этап 8.2. Synthetic Realtime reads only; no production traffic. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {harness}=require('./republic-game-resilience-check.cjs');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const source=fs.readFileSync('components/game/formalDocumentSummary.ts','utf8');
const mod={exports:{}};
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext('(function(module,exports){'+js+'})',{})(mod,mod.exports);
const {FORMAL_DOCUMENT_SUMMARY_COLUMNS,mergeFormalDocumentSummaries}=mod.exports;
const fields=FORMAL_DOCUMENT_SUMMARY_COLUMNS.split(',');
assert(fields.includes('id')&&fields.includes('game_id')&&fields.includes('updated_at')&&fields.includes('status_code'));
assert(!fields.includes('*')&&!fields.includes('body_text')&&!fields.includes('metadata'),'Never transmit document body or metadata in background reconciliation');
assert(hook.includes(".select(FORMAL_DOCUMENT_SUMMARY_COLUMNS).eq('game_id',gameId)"),'The read must retain the game filter and Postgres table RLS');
assert(hook.includes("if(view==='documents')jobs.push(loadFormalRegistry())"),'The document editor must keep its authoritative full registry');
assert(hook.includes("if(formalFullVersion.current!==formalVersion(summaries as FormalDocument[]))"),'Summary refresh must invalidate changed full-document cache');
const updated='2026-10-31T11:00:00Z';
const doc=i=>({id:'doc-'+i,game_id:'game-a',updated_at:updated,stage_no:12,registry_no:'N'+i,title:'Проект '+i,doc_type:'fz_bill',subject_key:'gd_deputy',subject_label:'Депутат',author_id:'student-'+i,
 body_text:'Текст федерального закона '.repeat(550),metadata:{revision:1,private_record:'X'.repeat(2500)},source_file_path:'game-a/doc-'+i+'.pdf',source_file_name:'doc.pdf',source_mime_type:'application/pdf',workflow_key:'bill',workflow_steps:[{code:'draft',label:'Подготовка',owner:'author',action:'approve'}],current_step:0,status_code:'draft',status_label:'Подготовка',current_owner_key:'author',created_at:updated});
const rows=Array.from({length:8},(_,i)=>doc(i));
const selectedRows=rows.map(d=>Object.fromEntries(fields.map(k=>[k,d[k]])));
const fullBytes=Buffer.byteLength(JSON.stringify({data:rows,error:null}));
const lightBytes=Buffer.byteLength(JSON.stringify({data:selectedRows,error:null}));
assert(lightBytes<fullBytes*0.15,'Expected >85% transport reduction on heavy fixture documents');
const prior=[{...rows[0],file_url:'signed:old'}];
let next=mergeFormalDocumentSummaries(prior,selectedRows.slice(0,1));
assert.equal(next[0].body_text,rows[0].body_text,'Unchanged and authorized full text remains in memory');
assert.equal(next[0].metadata.revision,1);
assert.equal(next[0].file_url,'signed:old');
next=mergeFormalDocumentSummaries(prior,[{...selectedRows[0],updated_at:'2026-10-31T11:01:00Z',title:'Новая версия'}]);
assert.equal(next[0].body_text,null,'Changed revision must not show stale content');
assert.equal(Object.keys(next[0].metadata).length,0,'Changed revision invalidates stale metadata');
assert.equal(next[0].title,'Новая версия');
assert.equal(mergeFormalDocumentSummaries(prior,[]).length,0,'Deleted/RLS-hidden rows disappear');
const changedPath=mergeFormalDocumentSummaries(prior,[{...selectedRows[0],source_file_path:'new-file.pdf'}]);
assert.equal(changedPath[0].file_url,null,'Signed URL cannot be reused for a new storage file');

async function main(){
 const clients=Array.from({length:40},(_,i)=>{const h=harness({effects:true});h.setUser('student-'+i);return h});
 try{
  await Promise.all(clients.map(h=>h.settle()));
  const before=clients.map(h=>h.stats());
  clients.forEach(h=>h.fixture('formal_documents',rows));
  // Deletions and incomplete event payloads require an RLS-scoped reconciliation.
  for(const h of clients){
   h.emit('formal_documents',{id:'deleted',game_id:'game-a'},'DELETE');
   h.emit('formal_documents',{id:'deleted',game_id:'game-a'},'DELETE');
   h.emit('formal_documents',{id:'deleted',game_id:'game-a'},'DELETE');
  }
  await Promise.all(clients.map(h=>h.advance(3200)));
  let reads=0,transmitted=0;
  clients.forEach((h,i)=>{
   const now=h.stats(),delta=now.queryLog.slice(before[i].queryLog.length);
   const target=delta.filter(q=>q.table==='formal_documents');
   assert.equal(target.length,1,'Burst reconciliation must issue one select per client');
   assert.equal(target[0].columns,FORMAL_DOCUMENT_SUMMARY_COLUMNS,'Actual hook must request exactly summary fields');
   assert.equal(target[0].eqs.game_id,'game-a','Game filter retained');
   assert(h.render().formalDocuments.length===rows.length,'All authorized document summaries remain available');
   assert(h.render().formalDocuments.every(d=>d.body_text===null&&Object.keys(d.metadata).length===0),'Summary never exposes uncached bodies');
   reads+=target.length;transmitted+=now.responseBytes-before[i].responseBytes;
  });
  assert.equal(reads,40,'40 simulated students must perform one RLS request each');
  assert(transmitted<fullBytes*40*0.2,'Measured mock payload must be much smaller than 40 full document responses');
  const sample=harness({effects:true});sample.setMemberKind('observer');await sample.settle();
  sample.fixture('formal_documents',[rows[0]]);
  sample.emit('formal_documents',{id:'deleted',game_id:'game-a'},'DELETE');await sample.advance(3200);
  assert(sample.render().formalDocuments.every(d=>d.body_text===null),'Guest role must see only the summary projection');
  sample.dispose();
  console.log(JSON.stringify({status:'PASS',students:40,observer:1,fullBytesPerRead:fullBytes,summaryBytesPerRead:lightBytes,modelReductionPercent:Math.round((1-lightBytes/fullBytes)*1000)/10,actualMockBytes:transmitted,networkCalls:40,eventsOffered:120,fullBodyQueries:0,notes:'Local 40-client synthetic model, not production network or real users'}));
 }finally{clients.forEach(h=>h.dispose())}
}
main().catch(e=>{console.error(e);process.exitCode=1});
