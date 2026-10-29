'use strict';
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {bootstrap,prepareRuns,studentId,gameId,voteId,fortyId,raceId,latencies,assertDisposable}=require('./ballot-concurrency-postgres-check.cjs');
assert.throws(()=>assertDisposable({}),/isolated/);
assert.throws(()=>assertDisposable({GITHUB_ACTIONS:'true',GOS_BALLOT_DISPOSABLE:'YES',PGHOST:'db.example.com',PGDATABASE:'gos_vote_concurrency_fixture'}),/isolated/);
assert.deepEqual(latencies(Array.from({length:100},(_,i)=>i+1)),{n:100,p95_ms:95,p99_ms:99});
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(bootstrap(100));
  await db.exec(prepareRuns());
  for(let i=1;i<=40;i++){
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[studentId(i)]);
   await db.query('select public.cast_vote_allocation($1,1,0,0)',[fortyId]);
  }
  const result=await db.query('select status,result_yes,result_cast from public.game_votes where id=$1',[fortyId]);
  assert.deepEqual(result.rows,[{status:'closed',result_yes:'40',result_cast:'40'}]);
  const ballots=await db.query('select count(*)::int as n from public.game_ballots where vote_id=$1',[fortyId]);
  assert.equal(ballots.rows[0].n,40);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[studentId(1)]);
  await assert.rejects(db.query('select public.cast_vote_allocation($1,1,0,0)',[fortyId]),/Голосование завершено/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[studentId(1)]);
  await db.query('select public.cast_vote_allocation($1,1,0,0)',[raceId]);
  await db.exec("create or replace function private.can_close_procedural_vote(g uuid,u uuid,body text,doc uuid) returns boolean language sql stable as $$ select true $$");
  const completed=await db.query('select public.close_procedural_vote($1,null) as result',[fortyId]);
  assert.equal(completed.rows[0].result.result,'passed','An authorised chairman can close when everyone has voted');
  await assert.rejects(db.query('select public.close_procedural_vote($1,null)',[raceId]),/ещё не все зарегистрированные участники проголосовали/,'A chairman cannot close before all eligible registered voters have voted');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[studentId(101)]);
  const closed=await db.query('select public.close_procedural_vote($1,null) as result',[raceId]);
  assert.equal(closed.rows[0].result.yes,1);assert.equal(closed.rows[0].result.cast,1);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[studentId(2)]);
  await assert.rejects(db.query('select public.cast_vote_allocation($1,1,0,0)',[raceId]),/Голосование завершено/);
  assert(gameId&&voteId);
  console.log('PASS: actual ballot and automatic close on synthetic fixture; sequential PGlite only, not a concurrent load test.');
 }finally{await db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
