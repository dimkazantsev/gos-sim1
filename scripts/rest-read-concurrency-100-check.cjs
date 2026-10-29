/* 100 independent synthetic browser tabs; no network traffic and no real users. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync('lib/supabase.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const origin='https://bderfrcfuhnutuoyudje.supabase.co';
function tab(index){
 const pending=[],count={readActive:0,peakRead:0,readStarted:0,writes:0,auth:0};
 let hold=true;
 const transport=async input=>{
  const href=typeof input==='string'?input:input.url;
  if(href.includes('/auth/v1/')){count.auth++;return new Response('{}',{status:200})}
  if(href.includes('rpc/cast_vote')){count.writes++;return new Response('{}',{status:201})}
  count.readStarted++;count.readActive++;count.peakRead=Math.max(count.peakRead,count.readActive);
  if(!hold){count.readActive--;return new Response('{}',{status:200})}
  return new Promise(resolve=>{pending.push(()=>{count.readActive--;resolve(new Response('{}',{status:200}))})});
 };
 const module={exports:{}};
 const sandbox={module,exports:module.exports,window:{},Response,Headers,URL,AbortController,setTimeout,clearTimeout,Date,performance,
  process:{env:{}},require:name=>{
   if(name==='./userError')return{userError:value=>String(value?.message||'Сервер недоступен')};
   if(name==='./boundedSessionRefresh')return{fetchWithBoundedSessionRefresh:transport};
   if(name==='./authTransport')return{fetchWithAuthTimeout:transport,isAuthVerificationRequest:()=>false};
   if(name==='@supabase/supabase-js')return{createClient:(_url,_key,options)=>options};
   throw Error('Unexpected mock '+name);
  }};
 vm.runInNewContext(compiled,sandbox);
 return{fetch:module.exports.supabase.global.fetch,count,pending,unhold:()=>{hold=false}};
}
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
async function exercise(index){
 const c=tab(index),url=origin+'/rest/v1/game_members?game_id=eq.abc';
 const jobs=Array.from({length:18},(_,i)=>c.fetch(url+'&page='+i));
 await settle();
 assert.equal(c.count.readStarted,4,'At most four reads may start in a tab');
 assert.equal(c.count.peakRead,4,'Peak read concurrency bounded');
 // Critical transactions must bypass queued GETs.
 const [write,auth]=await Promise.all([c.fetch(origin+'/rest/v1/rpc/cast_vote',{method:'POST'}),c.fetch(origin+'/auth/v1/user')]);
 assert.equal(write.status,201);assert.equal(auth.status,200);
 assert.equal(c.count.writes,1);assert.equal(c.count.auth,1);
 c.unhold();
 while(c.pending.length){const batch=c.pending.splice(0);batch.forEach(f=>f());await settle()}
 const result=await Promise.all(jobs);
 assert.ok(result.every(r=>r.status===200));
 assert.equal(c.count.readStarted,18);
 assert.equal(c.count.peakRead,4);
 return c.count;
}
(async()=>{
 const tabs=await Promise.all(Array.from({length:100},(_,i)=>exercise(i)));
 assert.equal(tabs.reduce((sum,c)=>sum+c.readStarted,0),1800);
 assert.equal(tabs.reduce((sum,c)=>sum+c.writes,0),100);
 const c=tab(101),url=origin+'/rest/v1/political_posts';
 const abort=new AbortController();
 const jobs=Array.from({length:51},(_,i)=>c.fetch(url+'?i='+i));
 const canceled=c.fetch(url+'?aborted=yes',{signal:abort.signal});
 await settle();
 const denied=await c.fetch(url+'?overflow=yes');
 assert.equal(denied.status,503,'Bounded waiting queue rejects excess work locally');
 assert.equal(denied.headers.get('x-gos-local-limit'),'1');
 assert.equal(c.count.readStarted,4,'Overload must not cause extra network traffic');
 abort.abort();await settle();
 assert.equal((await canceled).status,503,'Queued, aborted read must not start');
 c.unhold();
 while(c.pending.length){c.pending.splice(0).forEach(f=>f());await settle()}
 const result=await Promise.all(jobs);
 assert.equal(result.filter(r=>r.status===200).length,51);
 assert.equal(c.count.readStarted,51);
 console.log('PASS 100 synthetic clients: <=4 GET/readonly RPC per tab, 1800 responses; Auth/votes bypass; abort and backlog protection; no live load.');
})().catch(error=>{console.error(error);process.exitCode=1});
