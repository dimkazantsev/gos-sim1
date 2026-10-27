/* 100 isolated real game-hook instances; virtual time and fake Supabase transport. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {harness}=require('./republic-game-resilience-check.cjs');
const source=fs.readFileSync(path.join(__dirname,'../components/game/useRepublicGame.ts'),'utf8');
const expected="from('game_ballots').select(GAME_BALLOT_COLUMNS)";
assert.equal(source.split(expected).length-1,3,'All three ballot reads must use the bounded seven-column projection');
assert(source.includes("const GAME_BALLOT_COLUMNS='vote_id,voter_id,choice,weight,yes_weight,no_weight,abstain_weight'"));
const N=100;
const vote={id:'active-ballot',game_id:'game-a',status:'open',opened_at:'2026-10-28T00:00:00Z',stage_no:1,title:'Active ballot'};
async function main(){
 const clients=Array.from({length:N},(_,i)=>{
  const h=harness({effects:true});
  h.setUser('student-'+i);
  h.fixture('game_votes',[vote]);
  return h;
 });
 try{
  await Promise.all(clients.map(async h=>{await h.settle();h.render().setActiveView('votes');await h.settle()}));
  const counts=clients.map(h=>h.readCount('game_ballots'));
  const perSecond=[];
  for(let second=1;second<=6;second++){
   await Promise.all(clients.map(h=>h.advance(1000)));
   const increments=clients.map((h,i)=>{const current=h.readCount('game_ballots');const diff=current-counts[i];counts[i]=current;return diff});
   perSecond.push(increments.reduce((a,b)=>a+b,0));
  }
  const total=perSecond.reduce((a,b)=>a+b,0);
  assert.equal(total,N,'Every visible voter must get a complete ballot refresh within six seconds: '+JSON.stringify(perSecond));
  const peak=Math.max(...perSecond);
  assert(peak<=30,'Too many simultaneous reads in one second: '+JSON.stringify(perSecond));
  const hidden=clients.slice(0,50),visible=clients.slice(50);
  hidden.forEach(h=>h.visible('hidden'));
  const hiddenBefore=hidden.map(h=>h.readCount('game_ballots'));
  const visibleBefore=visible.map(h=>h.readCount('game_ballots'));
  await Promise.all(clients.map(h=>h.advance(6000)));
  assert(hidden.every((h,i)=>h.readCount('game_ballots')===hiddenBefore[i]),'Hidden tabs must not poll ballots');
  assert(visible.every((h,i)=>h.readCount('game_ballots')===visibleBefore[i]+1),'Visible tabs must keep six-second recovery without gaps');
  console.log(JSON.stringify({status:'PASS',clients:N,windowSeconds:6,ballotReads:total,readsBySecond:perSecond,peakReadsInOneSecond:peak,hiddenClients:50,transport:'synthetic',liveDatabaseReads:0},null,2));
 }finally{clients.forEach(h=>h.dispose())}
}
const watchdog=setTimeout(()=>{console.error('FAIL: 100-client ballot pacing test timed out');process.exitCode=1},110000);
main().then(()=>clearTimeout(watchdog),error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1});
