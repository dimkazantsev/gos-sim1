'use strict';
// Issue #491: deterministic 100-client recovery race over the actual useRepublicGame hook.
// Pure synthetic Supabase transport: no external accounts, production traffic, or writes.
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {harness}=require('./republic-game-resilience-check.cjs');
const COUNT=100;
const percentile=(values,q)=>{const s=[...values].sort((a,b)=>a-b);return Math.round(s[Math.ceil(q*s.length)-1]);};
async function main(){
 const clients=Array.from({length:COUNT},(_,i)=>{
  const h=harness();h.setUser('qa-student-'+String(i+1));return h;
 });
 const durations=[],first=[],stale=[];
 try{
  // All 100 clients start their initial grouped bootstrap concurrently.
  // Hold the *old* response, then open a new revision of the same game.
  for(const h of clients){
   const old=h.hold('games');
   first.push({h,old,pending:h.render().refresh()});
  }
  await new Promise(resolve=>setImmediate(resolve));
  for(const {h,old,pending} of first){
   const started=performance.now();
   h.setRevision(2);
   // Complete a newer revision before delivering the old one.
   stale.push({h,old,pending,started});
  }
  const newer=await Promise.all(stale.map(async item=>{
   await item.h.render().refresh();
   return {h:item.h,ms:performance.now()-item.started};
  }));
  for(const {h,ms} of newer){
   assert.equal(h.render().game?.current_round,2,'Newer game revision must win');
   durations.push(ms);
  }
  stale.forEach(item=>item.old.resolve());
  await Promise.all(stale.map(item=>item.pending));
  for(const h of clients){
   assert.equal(h.render().game?.current_round,2,'Late stale response must not overwrite active state');
   assert.equal(h.rpcCount('get_game_entry_v4'),2,'Two bounded entry RPCs, no runaway retries');
   assert.equal(h.readCount('state_metrics'),0,'No redundant legacy fallback when projection works');
   assert.equal(h.writeCount('game_stages'),0,'Recovery must not write or unlock stages');
   assert.equal(h.writeCount('game_ballots'),0,'Recovery must not duplicate ballots');
   assert.equal(h.writeCount('game_evaluations'),0,'Recovery must not duplicate scores');
  }
  const requests=clients.reduce((sum,h)=>sum+h.stats().requests,0);
  const responseBytes=clients.reduce((sum,h)=>sum+h.stats().responseBytes,0);
  console.log(JSON.stringify({status:'PASS',scenario:'100 synthetic independently rendered game-hook clients; stale-to-fresh bootstrap race',clients:COUNT,staleResponsesDiscarded:COUNT,confirmedLatestRevision:2,bootstrapRPCs:COUNT*2,readLatencyVirtualMs:{p50:percentile(durations,.50),p95:percentile(durations,.95),p99:percentile(durations,.99)},harnessRequests:requests,harnessResponseBytes:responseBytes,duplicateWrites:0,productionRequests:0,scope:'In-process fake Supabase, real useRepublicGame hook; not real JWT, full game 16-stage or network latency'}));
 }finally{for(const item of first)item.old.resolve();clients.forEach(h=>h.dispose());}
}
main().catch(error=>{console.error('FAIL recovery 100: '+(error?.stack||error));process.exitCode=1});
