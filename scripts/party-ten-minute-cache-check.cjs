/* Test the real in-memory party-read cache with 100 isolated browser identities.
 * Synthetic Supabase queries only; no external network or production mutation. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const from=source.indexOf(' function invalidatePartyRows(){');
const to=source.indexOf(' const assetSignatures=',from);
assert(from>0&&to>from,'Scoped party cache must be present');
const compiled=ts.transpileModule(source.slice(from,to),{
 compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}
}).outputText;
assert(source.includes("if(table==='game_parties')invalidatePartyRows()"),'Live party changes must invalidate cached rows');
assert(source.includes('async function refresh(){invalidatePartyRows()'),'Manual refresh invalidates presentation cache');
assert(source.includes("if(openVotes.length){for(const vote of openVotes)changedVoteIds.current.add(vote.id);scheduleRealtimeReload(0,['vote_ballots'])}"),'Votes retain six-second reconciliation');
const simulate=async i=>{
 let clock=1000000,requests=0;
 const ctx={
  PRESENTATION_CACHE_TTL_MS:600000,
  gameId:'game-1',authUser:{current:'student-'+i},readEpoch:{current:2},
  partyReadState:{current:{scope:'',lastSuccessAt:0,rows:null,inflight:null}},
  Date:{now:()=>clock},
  limitedCoreRead:async query=>await query,
  supabase:{from(table){assert.equal(table,'game_parties');requests++;
   const builder={select(){return this},eq(){return this},order(){return this},
    then(resolve,reject){return Promise.resolve({data:[{id:'party-'+requests,game_id:ctx.gameId}],error:null}).then(resolve,reject)}};
   return builder;
  }}
 };
 vm.runInNewContext(compiled+'\nthis.loadCachedParties=loadCachedParties;this.invalidatePartyRows=invalidatePartyRows;',ctx);
 const cached=ctx.loadCachedParties;
 await Promise.all(Array.from({length:12},()=>cached()));
 assert.equal(requests,1,'Concurrent components use one party read');
 for(let j=0;j<20;j++)await cached();
 assert.equal(requests,1,'Repeated page visits reuse the authorized party snapshot');
 clock+=599999;await cached();assert.equal(requests,1,'Cached for the full 10-minute TTL');
 clock+=1;await cached();assert.equal(requests,2,'Expired cache fetches a fresh snapshot');
 ctx.invalidatePartyRows();await cached();assert.equal(requests,3,'Realtime invalidation refreshes early');
 ctx.authUser.current='different-user-'+i;await cached();assert.equal(requests,4,'Never reuse another user\'s RLS result');
 ctx.gameId='game-2';await cached();assert.equal(requests,5,'Never reuse another room\'s parties');
 ctx.readEpoch.current++;await cached();assert.equal(requests,6,'Role epoch changes invalidate the cache');
 return requests;
};
Promise.all(Array.from({length:100},(_,i)=>simulate(i))).then(counts=>{
 assert.equal(counts.reduce((a,b)=>a+b,0),600);
 console.log('PASS: 100 synthetic browsers: per-user 10m TTL, 1200 simultaneous => 100 party reads, expiry, realtime, game, user and role isolation');
}).catch(e=>{console.error(e);process.exitCode=1});
