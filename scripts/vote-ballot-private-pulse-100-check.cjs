/* Virtual-time integration against the actual useRepublicGame hook.
 * No network, real session, database writes or simulated secret ballots. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {harness}=require('./republic-game-resilience-check.cjs');
const source=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20261105170000_vote_ballot_private_throttled_invalidation.sql','utf8');

assert(source.includes("channel.on('broadcast',{event:'ballots_changed'}"),'Use existing game socket for ballot notifications');
assert(source.includes("supabase.channel('gos-id-live:'+gameId,{config:{private:true}})"),'Keep existing authenticated private game socket');
assert(!source.includes("table:'game_ballots'"),'Do not subscribe to personally identifiable ballot rows');
assert(source.includes("if(ballotBurstTimer!==undefined)return;"),'First pulse starts one bounded client burst');
assert(source.includes("},5000);"),'Wait past the four-second server throttle to avoid trailing-update loss');
assert(source.includes("if(openVotes.length)reconcileTables.add('vote_ballots')"),'Keep existing three-minute reconciliation');
assert(source.includes("clearTimeout(ballotBurstTimer)"),'Dispose pending ballot reads when switching game/user');
assert(!source.slice(source.indexOf('const recoverVisibleChatAndBallots'),source.indexOf('const recoverVisibleChatAndBallots')+340).includes('vote_ballots'),'No six-second ballot interval');
assert(migration.includes("SET search_path TO ''"),'Harden SECURITY DEFINER path');
assert(migration.includes("ENABLE ROW LEVEL SECURITY"),'Do not expose pulse cache');
assert(migration.includes("REVOKE ALL ON TABLE private.vote_ballot_pulse_window"),'No RPC or data API permissions');
assert(migration.includes("interval '4 seconds'"),'One notification per vote in a four-second window');
assert(migration.includes("ON CONFLICT (vote_id) DO UPDATE"),'Atomic pulse throttle under concurrent casts');
assert(migration.includes("REFERENCES public.game_votes(id) ON DELETE CASCADE"),'No orphan pulse rows after deleting a vote');
assert(migration.includes("jsonb_build_object('vote_id',v_vote)"),'Only vote ID may appear in notification payload');
assert(!/jsonb_build_object\('[^']*(voter_id|choice|weight)/i.test(migration),'Never reveal ballot choices or voters');
assert(migration.includes("'gos-id-live:'||v_game::text")&&migration.includes('    true'),'Private game-scoped delivery');
assert(migration.includes('EXCEPTION WHEN OTHERS THEN'),'Realtime outage must not undo a recorded vote');
assert(!/cron\.schedule|cron\.unschedule|CREATE PUBLICATION|ADD TABLE public\.game_ballots/i.test(migration),'No new recurring jobs or ballot row publication');

const openVote={id:'vote',game_id:'game-a',status:'open',opened_at:'2026-11-05T10:00:00Z',institution_key:'gd'};
function setup(){
 const h=harness({effects:true});
 h.fixture('game_votes',[openVote]);
 h.fixture('game_ballots',[{vote_id:'vote',voter_id:'teacher-a',choice:'yes',weight:1,yes_weight:1,no_weight:0,abstain_weight:0}]);
 return h;
}
async function main(){
 const clients=Array.from({length:100},setup);
 try{
  for(const h of clients){await h.settle();h.render().setActiveView('votes');await h.settle();}
  assert(clients.every(h=>h.render().votes.some(v=>v.id==='vote'&&v.status==='open')),'All 100 viewers know the open vote');
  assert(clients.every(h=>h.channelsInfo().length===1&&h.channelsInfo()[0].private),'100 clients keep just one private socket each');

  const before=clients.map(h=>h.readCount('game_ballots'));
  for(const h of clients)await h.advance(65000);
  assert(clients.every((h,i)=>h.readCount('game_ballots')===before[i]),'No six-second ballot reads even after 65 seconds with an open vote');

  for(const h of clients){
   h.broadcast('gos-id-live:another-game','ballots_changed',{vote_id:'vote'});
   h.broadcast('gos-id-live:game-a','ballots_changed',{vote_id:'different-vote'});
   for(let n=0;n<100;n++)h.broadcast('gos-id-live:game-a','ballots_changed',{vote_id:'vote'});
  }
  assert(clients.every((h,i)=>h.readCount('game_ballots')===before[i]),'All 10,000 duplicate signals cause zero immediate HTTP reads');
  for(const h of clients)await h.advance(4900);
  assert(clients.every((h,i)=>h.readCount('game_ballots')===before[i]),'Do not read before the server batching window completes');
  for(const h of clients)await h.advance(1300);
  assert(clients.every((h,i)=>h.readCount('game_ballots')===before[i]+1),'100 clients issue only 100 scoped reads, not 10,000');
  assert(clients.every(h=>h.stats().queryLog.filter(q=>q.table==='game_ballots').at(-1)?.ins.vote_id?.includes('vote')),'Read is limited to affected vote IDs');
  for(const h of clients)h.dispose();
  console.log('PASS: 100 open-vote clients; 65s without polling; 10,000 synthetic signals -> exactly 100 scoped reads.');

  const fallback=setup();
  await fallback.settle();fallback.render().setActiveView('votes');await fallback.settle();
  const count=fallback.readCount('game_ballots');
  await fallback.advance(195000);
  assert(fallback.readCount('game_ballots')>=count+1,'Existing 3-minute connected recovery handles lost pulses');
  fallback.dispose();
  console.log('PASS: connected three-minute missed-message fallback; private payload and lifecycle guards.');
 }finally{for(const h of clients)h.dispose();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
