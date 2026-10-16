'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'lib/boundedSessionRefresh.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const pendingTimers=[];
const sandbox={module:{exports:{}},exports:{},AbortController,URL,console,
 setTimeout(callback){pendingTimers.push(callback);return pendingTimers.length;},
 clearTimeout(){}};
sandbox.exports=sandbox.module.exports;
vm.runInNewContext(compiled,sandbox);
const {fetchWithBoundedSessionRefresh:request,SESSION_REFRESH_NETWORK_TIMEOUT_MS:limit}=sandbox.module.exports;
assert.equal(limit,6500);
const refreshUrl='https://example.supabase.co/auth/v1/token?grant_type=refresh_token';
const ordinaryUrl='https://example.supabase.co/rest/v1/game_members';
(async()=>{
 let requestCount=0;
 const originalController=new AbortController();
 const originalSignal=originalController.signal;
 const plain={signal:originalSignal,method:'GET'};
 const untouched=await request(ordinaryUrl,plain,async(_input,init)=>{
  requestCount++;
  assert.strictEqual(init,plain,'PostgREST fetch must remain unchanged');
  return {status:200};
 });
 assert.equal(untouched.status,200);
 assert.equal(requestCount,1);
 assert.equal(pendingTimers.length,0,'PostgREST must not set a timer');

 let refreshSignal;
 const success=await request(refreshUrl,{method:'POST'},async(_input,init)=>{
  refreshSignal=init.signal;return {status:200};
 });
 assert.equal(success.status,200);
 assert.ok(refreshSignal instanceof AbortSignal);
 assert.equal(refreshSignal.aborted,false);
 assert.equal(pendingTimers.length,1);

 let inflightSignal;
 const stalled=request(refreshUrl,{},(_input,init)=>{
  inflightSignal=init.signal;
  return new Promise((resolve,reject)=>{
   inflightSignal.addEventListener('abort',()=>reject(new Error('transport aborted')),{once:true});
  });
 });
 await Promise.resolve();
 pendingTimers.at(-1)();
 await assert.rejects(stalled,/Обновление сессии не получило ответ/);
 assert.equal(inflightSignal.aborted,true,'A stalled refresh must actually abort its network request');

 const controller=new AbortController();
 let forwardedSignal;
 const forwarded=request(refreshUrl,{signal:controller.signal},(_input,init)=>{
  forwardedSignal=init.signal;
  return new Promise((resolve,reject)=>{
   forwardedSignal.addEventListener('abort',()=>reject(new Error('caller cancellation')),{once:true});
  });
 });
 await Promise.resolve();
 controller.abort();
 await assert.rejects(forwarded,/caller cancellation/);
 assert.equal(forwardedSignal.aborted,true);

 const client=fs.readFileSync(path.join(root,'lib/supabase.ts'),'utf8');
 const hook=fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8');
 assert.match(client,/fetchWithBoundedSessionRefresh\(input,init\)/);
 assert.match(hook,/supabase\.auth\.getSession\(\),SESSION_BOOTSTRAP_TIMEOUT_MS/);
 assert.match(hook,/const SESSION_BOOTSTRAP_TIMEOUT_MS=16000/);
 assert.match(client,/auth:\s*\{\s*persistSession:\s*true,\s*autoRefreshToken:\s*true\s*\}/);
 console.log('PASS: Only refresh_token requests bounded; caller abort preserved; login and other API requests unchanged.');
})().catch(err=>{console.error(err);process.exitCode=1;});
