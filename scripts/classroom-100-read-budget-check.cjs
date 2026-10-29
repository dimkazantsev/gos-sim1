/* Deterministic classroom view-navigation budget. No live DB or browser I/O. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const ast=ts.createSourceFile('useRepublicGame.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length,0,'Game hook must parse');
assert(source.includes("if(openVotes.length){for(const vote of openVotes)changedVoteIds.current.add(vote.id);scheduleRealtimeReload(0,['vote_ballots'])}"),
 'Six-second recovery for every voter must remain intact');
assert(source.includes("chatRecovery=setInterval(recoverVisibleChatAndBallots,6000)"),
 'Keep existing six-second ballot cadence');
assert(source.includes("officeReadState.current={scope:'',lastSuccessAt:0,inflight:null};"),
 'Game/user resets must clear the office cache');
const start=source.indexOf(' async function loadRepublicOffices(');
const end=source.indexOf(' async function loadClassroomTelemetry(',start);
assert(start>=0&&end>start,'Office loader must be available');
const snippet=source.slice(start,end);
const compiled=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
async function simulateBrowser(index){
 let clock=1000000,requests=0;
 const ctx={
  gameId:'game-1',authUser:{current:'student-'+index},readEpoch:{current:3},
  officeReadState:{current:{scope:'',lastSuccessAt:0,inflight:null}},
  Date:{now:()=>clock},readSafely:async (_scopes,fn)=>fn({}),
  readCurrent:()=>true,requireSuccessful:([r])=>{if(r.error)throw r.error;},
  setOfficeRows:()=>{},
  supabase:{from:()=>{requests++;return{select(){return this},eq(){return this},order(){return Promise.resolve({data:[],error:null})}}}}
 };
 vm.runInNewContext(compiled+'\nthis.loadOffices=loadRepublicOffices;',ctx);
 await Promise.all(Array.from({length:10},()=>ctx.loadOffices()));
 assert.equal(requests,1,'Ten simultaneous view reads must share one request');
 for(let i=0;i<10;i++)await ctx.loadOffices();
 assert.equal(requests,1,'Ten sequential view changes must reuse a fresh read');
 clock+=30001;await ctx.loadOffices();
 assert.equal(requests,2,'30-second stale office data must revalidate');
 await ctx.loadOffices(true);
 assert.equal(requests,3,'Manual refresh must bypass cache');
 ctx.authUser.current='another-user-'+index;await ctx.loadOffices();
 assert.equal(requests,4,'Another user must never reuse cached office data');
 return requests;
}
(async()=>{
 const results=await Promise.all(Array.from({length:100},(_,i)=>simulateBrowser(i)));
 assert.equal(results.reduce((sum,n)=>sum+n,0),400);
 console.log('PASS: 100 simulated independent browsers, 2,000 rapid view loads => 100 office queries, unchanged six-second ballot recovery');
})().catch(error=>{console.error(error);process.exitCode=1});
