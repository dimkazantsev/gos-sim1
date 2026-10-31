/* Reproduce stalled Blitz transport locally; no Supabase access, network or writes. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync('components/game/blitzRequest.ts','utf8');
const component=fs.readFileSync('components/game/Blitz.tsx','utf8');
const sandboxModule={exports:{}};
const js=ts.transpileModule(source,{fileName:'blitzRequest.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext('(function(module,exports){'+js+'})',{AbortController,setTimeout,clearTimeout,Promise,Error})(sandboxModule,sandboxModule.exports);
const {blitzBoundedRequest,BLITZ_RPC_TIMEOUT_MS}=sandboxModule.exports;
assert.equal(BLITZ_RPC_TIMEOUT_MS,10000);
assert(component.includes("BLITZ_RECEIVE_GRACE_MS=2000")&&component.includes("BLITZ_CHOICE_WINDOW_MS=20_000"),'The 20+2-second server contract must remain unchanged');
assert(component.includes('BLITZ_UNCONFIRMED')&&component.includes('Проверить результат в истории'),'An ambiguous server failure must not be presented as a wrong answer');
assert(component.includes("blitz_archive_filtered")&&component.includes('finally{if(token===request.current)setLoading(false)}'),'Archive must stop displaying indefinite loading');
assert.equal(component.split('blitzBoundedRequest(').length-1,7,'All seven Blitz RPC paths are bounded');
assert(!component.includes('await supabase.rpc('),'No unbounded Blitz RPC left');
async function run(){
 let started=0,aborted=false;
 await assert.rejects(
  blitzBoundedRequest(signal=>{started++;signal.addEventListener('abort',()=>{aborted=true});return new Promise(()=>{})},15),
  /Сервер блиц-вопросов|abort/i
 );
 assert.equal(aborted,true,'The network request must be aborted');
 assert.equal(started,1,'Never automatically repeat an uncertain write');
 const fast=await blitzBoundedRequest(()=>Promise.resolve({data:'accepted',error:null}),50);
 assert.equal(fast.data,'accepted');
 await assert.rejects(blitzBoundedRequest(()=>Promise.reject(Error('server 500')),50),/server 500/);
 const late=new Promise(resolve=>setTimeout(()=>resolve({data:'late acceptance'}),40));
 await assert.rejects(blitzBoundedRequest(()=>{started++;return late},8),/Сервер блиц-вопросов|abort/i);
 assert.equal(started,2,'The late response must not cause another submission');
 assert.equal((await late).data,'late acceptance','A committed server response may arrive after the local deadline');
 console.log('PASS: bounded Blitz request, transport abort, no replay, ambiguous acceptance, archive recovery and intact scoring contract');
}
run().catch(error=>{console.error(error);process.exitCode=1});
