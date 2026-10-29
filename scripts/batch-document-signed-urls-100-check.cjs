'use strict';
/* Production batch helper with fake Storage responses. No Auth, SQL or network. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const helper=fs.readFileSync(path.join(root,'components/game/signDocumentAssetBatch.ts'),'utf8');
const core=fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8');
assert(core.includes("import {signDocumentAssetBatch} from './signDocumentAssetBatch'"));
assert.equal((core.match(/void signedDocumentLinks\(rows/g)||[]).length,2,'Only party and formal registry use the batch helper');
assert(core.includes("signOne:path=>signedAssetUrl('game-assets',path)"),'Single-file RLS fallback remains in production');
const js=ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(js,{
 module,exports:module.exports,Map,Set,Promise,Error,
 require:moduleName=>{
  assert.equal(moduleName,'@/lib/resolveStoredAsset');
  return{resolveStoredAsset:(bucket,p)=>bucket==='game-assets'&&p.startsWith('teacher-assets/')
   ?{bucket:'teacher-assets',path:p.slice('teacher-assets/'.length)}:{bucket,path:p}};
 }
},{filename:'signDocumentAssetBatch.js'});
const sign=module.exports.signDocumentAssetBatch;
const batchSize=20;
const docs=Array.from({length:100},(_,i)=>({id:'doc-'+i,path:'game-1/parties/p/docs/file-'+i+'.pdf'}));
const key=(b,p)=>b+':'+p;
function fixture(opts={}){
 let valid=true,active=0,maxActive=0;
 const cache=new Map(),requests=[],singles=[],stored=[];
 const signOne=async p=>{singles.push(p);return 'single:'+p};
 const signMany=async(bucket,paths)=>{
  active++;maxActive=Math.max(maxActive,active);
  requests.push({bucket,paths:[...paths]});
  if(opts.wait)await opts.wait();
  active--;
  if(opts.throwBatch)throw Error('Storage batch unavailable');
  const data=paths.map(p=>({path:p,signedUrl:'batch:'+bucket+'/'+p,error:null})).reverse();
  if(opts.denied?.length){
   for(const entry of data)if(opts.denied.includes(entry.path)){entry.error='denied';entry.signedUrl=null}
  }
  data.push({path:'unrelated/private-file',signedUrl:'MUST-NOT-LEAK',error:null});
  return{data,error:null};
 };
 return {
  cache,requests,singles,stored,get maxActive(){return maxActive},
  setValid:on=>{valid=on},
  options:{
   isCurrent:()=>valid,
   cached:k=>cache.get(k),
   store:(k,u)=>{stored.push([k,u]);cache.set(k,Promise.resolve(u))},
   signOne,signMany
  }
 };
}
(async()=>{
 const first=fixture();
 const results=await sign(docs,first.options);
 assert.equal(results.length,100);
 assert.equal(first.requests.length,Math.ceil(docs.length/batchSize));
 assert(first.requests.every(r=>r.paths.length<=20&&r.bucket==='game-assets'));
 assert.equal(first.maxActive,1,'Batch requests are serial, preventing 100-client connection bursts');
 assert.equal(first.singles.length,0);
 for(let i=0;i<100;i++)assert.equal(results[i].url,'batch:game-assets/'+docs[i].path);
 assert(!results.some(r=>r.url?.includes('MUST-NOT-LEAK')),'Never substitute URL for unrelated file');
 assert.equal(first.stored.length,100,'Authorised URLs enter user-scoped in-memory cache');
 const repeated=await sign(docs,first.options);
 assert.equal(first.requests.length,5,'Cached refresh needs no Storage request');
 assert.equal(first.stored.length,100);
 assert.equal(repeated[0].url,results[0].url);
 const mixed=[
  {id:'a',path:'teacher-assets/game-1/confidential/one.pdf'},
  {id:'b',path:'game-1/public/two.pdf'},
  {id:'c',path:'teacher-assets/game-1/confidential/three.pdf'}
 ];
 const second=fixture();
 const group=await sign(mixed,second.options);
 assert.deepEqual(second.requests.map(q=>q.bucket),['teacher-assets']);
 assert.equal(second.singles.length,1,'Single ordinary game-assets path retains existing per-file request');
 assert.deepEqual(Array.from(group,r=>r.url),[
  'batch:teacher-assets/game-1/confidential/one.pdf',
  'single:game-1/public/two.pdf',
  'batch:teacher-assets/game-1/confidential/three.pdf'
 ]);
 const denied=fixture({denied:[docs[10].path]});
 const failRows=await sign(docs.slice(0,30),denied.options);
 assert.equal(denied.singles.length,1,'Only unsuccessful file falls back to original RLS path');
 assert.equal(denied.singles[0],docs[10].path);
 assert.equal(failRows[10].url,'single:'+docs[10].path);
 const unsupported=fixture({throwBatch:true});
 const old=await sign(docs.slice(0,25),unsupported.options);
 assert.equal(unsupported.requests.length,2);
 assert.equal(unsupported.singles.length,25,'Legacy transport preserves existing links');
 assert(old.every(x=>x.url==='single:'+x.path));
 let release;const gate=new Promise(resolve=>{release=resolve});
 const stale=fixture({wait:()=>gate});
 const job=sign(docs.slice(0,40),stale.options);
 await Promise.resolve();await Promise.resolve();
 stale.setValid(false);release();
 const staleLinks=await job;
 assert(staleLinks.every(x=>x.url===null),'Changing user/game must invalidate pending URLs');
 assert.equal(stale.stored.length,0,'No old-user signed links may enter the next session cache');
 console.log('PASS batch document signing: 100 files -> 5 Storage batch requests; cache refresh -> 0.');
 console.log('PASS RLS fallback, distinct buckets, response-order independence, wrong-path rejection, and changed-session invalidation.');
 console.log('Mocked Storage transport only; this is NOT a 100-JWT or real Supabase load test.');
})().catch(e=>{console.error(e);process.exitCode=1});
