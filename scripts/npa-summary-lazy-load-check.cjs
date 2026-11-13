/* ГОС.ID: registry cards are a single RLS-scoped summary read.
 * Full document and history are fetched once, on opening a specific record.
 * Pure synthetic fixtures, no production requests or mutations. */
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const view=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
const summary=fs.readFileSync('components/game/formalDocumentSummary.ts','utf8');
const source=ts.transpileModule(summary,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const lib={exports:{}};new Function('module','exports','require',source)(lib,lib.exports,require);
const {FORMAL_DOCUMENT_SUMMARY_COLUMNS,mergeFormalDocumentSummaries}=lib.exports;
assert(hook.includes("if(!ids){")&&hook.includes(".select(FORMAL_DOCUMENT_SUMMARY_COLUMNS).eq('game_id',gameId)"),
 'List must read narrow RLS-scoped columns only');
assert(hook.includes("await readSafely(['formal']")&&hook.includes("requireSuccessful([result])"),
 'Preserve request generation and proper error checking');
assert(hook.includes("p_document_ids:ids??null")&&hook.includes("if(ids)for(const row of rows)formalDetailVersions.current.set(row.id,row.updated_at)"),
 'Targeted full document+history read is retained');
assert(hook.includes("function ensureFormalDocument(id:string,version:string)")&&hook.includes("formalDetailReads.current.get(key)"),
 'Duplicate simultaneous opens must coalesce');
assert(hook.includes('formalDetailVersions.current.clear();formalDetailReads.current.clear()'),
 'Clear full-detail caches on authorization/game reset');
assert(view.includes('const selected=detailPending?undefined:selectedSummary;')&&
 view.includes("g.ensureFormalDocument(selectedSummary.id,selectedSummary.updated_at)")&&
 view.includes("detailPending?<div className=\"formalEmptyBig\""),
 'Do not render an incomplete document, allow loading and retry');
assert(!view.includes("formalDocuments.slice(0,30)"),'List must not pretend to be limited to 30');
const fields=FORMAL_DOCUMENT_SUMMARY_COLUMNS.split(',');
assert(!fields.includes('body_text')&&!fields.includes('metadata')&&!fields.includes('file_url'));
assert(fields.includes('workflow_steps')&&fields.includes('status_code')&&fields.includes('current_owner_key'),'Keep all card and routing fields');
const docs=Array.from({length:30},(_,i)=>({
 id:'document-'+i,game_id:'game-a',stage_no:12,registry_no:'NPA-'+i,title:'Проект закона '+i,
 doc_type:'fz_bill',subject_key:'gd_deputy',subject_label:'Депутат',author_id:'student-1',
 source_file_path:null,source_file_name:null,source_mime_type:null,workflow_key:'bill',
 workflow_steps:['registration','committee','reading1','reading2','reading3','sf','president'],
 current_step:i%7,status_code:i%2?'reading1':'published',status_label:'Рассматривается',
 current_owner_key:'duma',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-11-11T00:00:00Z',
 body_text:'Документ '+i+'\n'+'Текст'.repeat(2200),
 metadata:{revision:1,related_objects:'связи'.repeat(150)},file_url:null
}));
const cards=docs.map(x=>Object.fromEntries(fields.map(k=>[k,x[k]])));
const fullBytes=Buffer.byteLength(JSON.stringify(docs));
const lightBytes=Buffer.byteLength(JSON.stringify(cards));
assert(lightBytes<fullBytes*.2,'Summary must use less than 20% of full document payload');
let merged=mergeFormalDocumentSummaries([docs[0]],cards);
assert.equal(merged.length,30,'All available documents remain in the registry');
assert.equal(merged[0].body_text,docs[0].body_text,'Previously authorised unchanged document text may be reused');
assert.equal(merged[1].body_text,null,'Unopened documents must not have body text');
assert.deepEqual(merged[1].metadata,{},'No metadata attached to unopened documents');
assert.equal(merged[1].workflow_steps.length,7,'Workflow remains available for cards and routing');
const changed=cards.map((d,i)=>i===0?{...d,updated_at:'2026-11-12T00:00:00Z'}:d);
merged=mergeFormalDocumentSummaries(merged,changed);
assert.equal(merged[0].body_text,null,'Updated version invalidates old cached text');
assert.deepEqual(merged[0].metadata,{},'Updated version invalidates old metadata');
merged=mergeFormalDocumentSummaries(merged,changed.slice(1));
assert.equal(merged.length,29,'Removed or inaccessible documents disappear');
console.log('PASS NPA summary-on-open: 30 cards, %.1f%% payload reduction, targeted full detail/history, cache invalidation, protected document UI',100*(1-lightBytes/fullBytes));
