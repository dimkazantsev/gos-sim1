/* Offline check: 100 simultaneous student roster loads, no network or production data. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const helper='components/game/coalesceInFlight.ts';
const source=fs.readFileSync(helper,'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleContext={exports:{}};
vm.runInNewContext('(function(module,exports){'+compiled+'})',{})(moduleContext,moduleContext.exports);
const {coalesceInFlight}=moduleContext.exports;
assert.equal(typeof coalesceInFlight,'function','A production helper must own in-flight de-duplication');
const gameFile=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
assert.match(gameFile,/coalesceInFlight\(rosterReads\.current/, 'Real game hook must reuse the pending roster request');
assert.equal((gameFile.match(/loadMemberRoster\(\)/g)||[]).length,5,'Initial load, teacher view, targeted recovery and chat directory share the same bounded roster loader');
assert.match(gameFile,/\.eq\('game_id',gameId\)\.order\('full_name'\)/,'Game-specific sorted roster must be preserved');
assert.match(gameFile,/\.eq\('user_id',uid\)\.maybeSingle\(\)/,'Independent, authoritative personal membership check must remain');
async function flush(){await Promise.resolve();await Promise.resolve();await Promise.resolve()}
(async()=>{
 const pending=new Map(),tasks=[],calls=[];
 const deferred=key=>new Promise(resolve=>{tasks.push({key,resolve})});
 const users=Array.from({length:100},(_,n)=>'student-'+n);
 const requests=users.map(user=>{
  const key='game-a:'+user+':1';
  const load=()=>{calls.push(key);return deferred(key)};
  const core=coalesceInFlight(pending,key,load);
  const parties=coalesceInFlight(pending,key,load);
  assert.equal(core,parties,'Consumers must share the same pending Promise for '+user);
  return [core,parties];
 });
 await flush();
 assert.equal(calls.length,100,'100 concurrent clients / 2 consumers must issue 100, not 200, reads');
 assert.equal(pending.size,100);
 tasks.forEach(task=>task.resolve({members:1}));
 await Promise.all(requests.flat());
 await flush();
 assert.equal(pending.size,0,'Resolved in-flight rows must never become a stale cross-session cache');
 const another=coalesceInFlight(pending,'game-a:student-0:1',()=>{calls.push('retry');return Promise.resolve({members:2})});
 assert.equal((await another).members,2,'Later updates must fetch new membership');
 await flush();
 assert.equal(pending.size,0);
 let attempts=0;
 await assert.rejects(coalesceInFlight(pending,'game-a:broken:1',()=>{attempts++;return Promise.reject(Error('network'))}),/network/);
 await flush();
 assert.equal(pending.size,0,'A failed read must not poison future refreshes');
 await coalesceInFlight(pending,'game-a:broken:1',()=>{attempts++;return Promise.resolve(null)});
 assert.equal(attempts,2,'Network failure must permit later recovery');
 const sessionReads=[];
 await Promise.all(['game-a:u:7','game-b:u:7','game-a:u:8','game-a:v:7'].map(key=>
  coalesceInFlight(pending,key,()=>{sessionReads.push(key);return Promise.resolve([])})
 ));
 assert.equal(sessionReads.length,4,'Game, participant, and login epoch must isolate requests');
 console.log(JSON.stringify({status:'PASS',clients:100,callersPerClient:2,previousRequests:200,sharedRequests:100,preventedRequests:100,network:'synthetic',crossGameIsolation:true,authEpochIsolation:true,retryAfterError:true,crossSessionCache:false},null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
