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
  await db.query('select public.cast_vote_allocation($1,1,0,0)',[fortyId]); // exact retry after close is read-only
  await assert.rejects(db.query('select public.cast_vote_allocation($1,0,1,0)',[fortyId]),/Голосование завершено/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[studentId(1)]);
  await db.query('select public.cast_vote_allocation($1,1,0,0)',[raceId]);
  // Isolated audit counts actual physical row mutations rather than keys.
  await db.exec("create table public.qa_ballot_write_counts(vote_id uuid primary key, writes integer not null default 0);\ncreate function public.qa_track_ballot_write() returns trigger language plpgsql as $qa$\nbegin\n insert into public.qa_ballot_write_counts(vote_id,writes) values(new.vote_id,1)\n on conflict(vote_id) do update set writes=public.qa_ballot_write_counts.writes+1;\n return null;\nend;$qa$;\ncreate trigger qa_track_ballot_write after insert or update of choice,weight,yes_weight,no_weight,abstain_weight on public.game_ballots for each row execute function public.qa_track_ballot_write();");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[studentId(1)]);
  for(let n=0;n<30;n++)await db.query('select public.cast_vote_allocation($1,1,0,0)',[retryId]);
  let writes=(await db.query('select writes from public.qa_ballot_write_counts where vote_id=$1',[retryId])).rows[0].writes;
  assert.equal(writes,1,'Thirty identical requests must perform one INSERT and zero UPDATEs');
  await db.query('select public.cast_vote_allocation($1,0,1,0)',[retryId]);
  writes=(await db.query('select writes from public.qa_ballot_write_counts where vote_id=$1',[retryId])).rows[0].writes;
  assert.equal(writes,2,'An authorised changed vote remains a distinct recorded action');
  for(let voter=2;voter<=100;voter++){
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[studentId(voter)]);
   await db.query('select public.cast_vote_allocation($1,1,0,0)',[retryId]);
  }
  const tally=(await db.query('select status,result_yes,result_no,result_cast from public.game_votes where id=$1',[retryId])).rows[0];
  assert.deepEqual(tally,{status:'closed',result_yes:'99',result_no:'1',result_cast:'100'},'100 votes close coherently: 99 yes, 1 no');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[studentId(1)]);
  await db.query('select public.cast_vote_allocation($1,0,1,0)',[retryId]);
  await assert.rejects(db.query('select public.cast_vote_allocation($1,1,0,0)',[retryId]),/Голосование завершено/);
  writes=(await db.query('select writes from public.qa_ballot_write_counts where vote_id=$1',[retryId])).rows[0].writes;
  assert.equal(writes,101,'After closure: identical retry is read-only, different choice rejected');
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
