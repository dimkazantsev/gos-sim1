/* Targeted behavioral check for lazy document revision text.
 * Real component function via TypeScript transpilation, fake Supabase transport;
 * never contacts production and does not claim to test browser layout or RLS.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const file=path.resolve(__dirname,'../components/game/DocumentsView.tsx');
const source=fs.readFileSync(file,'utf8');
const start=source.indexOf('type HistoricalRevisionHeader=');
const end=source.indexOf('\nexport default function DocumentsView(',start);
assert(start>=0&&end>start,'Historical revision component must be extracted from actual source');
assert(source.includes("select('id,revision,title,created_at')"),'Metadata list must not include revision body');
assert(!source.includes("select('id,revision,title,body_text,created_at')"),'No eager revision body download');
const compiled=ts.transpileModule(source.slice(start,end)+'\nmodule.exports={HistoricalRevisionItem};',{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}
}).outputText;
function fakeReactElement(type,props,key){return{type,props:props||{},key}}
function find(tree,type){
 if(!tree||typeof tree!=='object')return null;
 if(Array.isArray(tree)){for(const entry of tree){const found=find(entry,type);if(found)return found}return null}
 if(tree.type===type)return tree;
 return find(tree.props?.children,type);
}
function textOf(tree){
 if(tree===null||tree===undefined||typeof tree==='boolean')return '';
 if(typeof tree==='string'||typeof tree==='number')return String(tree);
 if(Array.isArray(tree))return tree.map(textOf).join('');
 return textOf(tree.props?.children);
}
function fixture({canRestore=true,reply={data:{body_text:'Проверенный текст редакции'},error:null}}={}){
 const slots=[],queries=[],restored=[];let cursor=0,serverReply=reply;
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next}]},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i]},
  useEffect(fn){const i=cursor++;if(!(i in slots)){slots[i]=true;fn()}}
 };
 const supabase={from(table){
  const query={table,fields:'',filters:[]};
  const chain={select(fields){query.fields=fields;return chain},eq(name,value){query.filters.push([name,value]);return chain},
   maybeSingle(){queries.push(query);return Promise.resolve(serverReply)}};
  return chain;
 }};
 const exports={};
 const module={exports};
 const sandbox={...hooks,supabase,module,exports,Promise,console,
  userError:error=>error.message||String(error),fmtDateTime:()=> '30.10.2026',
  require:name=>{assert.equal(name,'react/jsx-runtime');return{jsx:fakeReactElement,jsxs:fakeReactElement}}
 };
 vm.runInNewContext(compiled,sandbox,{filename:'HistoricalRevisionItem.jsx'});
 const render=()=>{cursor=0;return module.exports.HistoricalRevisionItem({
  revision:{id:'rev-1',revision:3,title:'Редакция № 3',created_at:'2026-10-30T10:00:00Z'},
  documentId:'doc-1',canRestore,
  onRestore:(...values)=>restored.push(values)
 })};
 return {render,queries,restored,setReply(value){serverReply=value}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const test=fixture();
 let tree=test.render();
 assert.equal(test.queries.length,0,'Initial revision list must not fetch body');
 assert.equal(find(tree,'button')?.props.disabled,false,'Existing restore action remains available');
 find(tree,'details').props.onToggle({currentTarget:{open:true}});
 assert.equal(test.queries.length,1,'Opening one revision requests one body');
 const q=test.queries[0];
 assert.equal(q.table,'formal_document_revisions');
 assert.equal(q.fields,'body_text');
 assert.deepEqual(q.filters,[['document_id','doc-1'],['id','rev-1']],'Body request scoped to exact document and revision');
 await flush();
 tree=test.render();
 assert(textOf(tree).includes('Проверенный текст редакции'),'Opened revision renders fetched text');
 find(tree,'button').props.onClick();
 await flush();
 assert.deepEqual(test.restored,[['Редакция № 3','Проверенный текст редакции',3]],'Restore waits for the requested text');
 assert.equal(test.queries.length,1,'Restore reuses loaded revision body');
 find(tree,'details').props.onToggle({currentTarget:{open:false}});
 tree=test.render();
 find(tree,'details').props.onToggle({currentTarget:{open:true}});
 await flush();
 assert.equal(test.queries.length,1,'Reopening does not refetch immutable revision text');
 const denied=fixture({canRestore:false,reply:{data:null,error:{message:'Недостаточно прав'}}});
 tree=denied.render();
 assert.equal(find(tree,'button'),null,'No restoration button without edit rights');
 find(tree,'details').props.onToggle({currentTarget:{open:true}});
 await flush();
 assert(textOf(denied.render()).includes('Недостаточно прав'),'RLS read error is shown, not replaced by empty text');
 assert.equal(denied.restored.length,0);
 console.log('PASS lazy revisions: metadata-only initial query; scoped on-demand body; cached reopen; restore content; denied read and edit rights (mock transport).');
})().catch(error=>{console.error(error);process.exitCode=1});
