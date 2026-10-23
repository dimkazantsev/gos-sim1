'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const read=path=>fs.readFileSync(path,'utf8');
const screen=read('components/game/ElectoralArchitectureLab.tsx');
const shared=read('components/game/useRepublicGame.ts');
const hook=read('components/game/useGameTableSync.ts');
const migration=read('supabase/migrations/20261024053000_ksrf_proposals_shared_realtime.sql');
assert(!screen.includes("supabase.channel('electoral-architecture:"),'No separate websocket for the KSRF widget');
assert(screen.includes("const proposalSubmitLock=useRef(false)"),'Prevent concurrent duplicate proposals');
assert(screen.includes("proposalLoadVersion.current"),'Do not overwrite newer proposals with stale reads');
assert(screen.includes("setRRules(previous=>previous.some(item=>item.id===row.id)?previous:[row,...previous])"),'Instant local regional result');
assert(screen.includes("setPRules(previous=>previous.some(item=>item.id===row.id)?previous:[row,...previous])"),'Instant local parliamentary result');
assert(screen.includes("void loadProposalRules();"),'Refresh in the background without delaying acknowledgement');
assert(screen.includes(".limit(100)"),'Bound per-client proposal queries');
assert(screen.includes("stageNo===2?'parliamentary_election_rules':'regional_election_rules'"),'Read only the current stage proposals');
assert(hook.includes("(!onlyTable||detail.table===onlyTable)"),'Ignore unrelated game changes');
assert(hook.includes('KSRF_PROPOSAL_REFRESH_EVENT'),'Send proposal invalidations on a distinct event');
assert(hook.includes('const eventName=onlyTable?KSRF_PROPOSAL_REFRESH_EVENT:GAME_DATA_REFRESH_EVENT'),'Do not wake unrelated stage panels');
assert(hook.includes('window.addEventListener(eventName,local)'),'Subscribe to scoped event only');
assert(shared.includes("notifyGameDataRefresh(gameId,table)"),'Shared game socket carries proposal table identity');
assert(shared.includes("'parliamentary_election_rules','regional_election_rules'"),'Subscribe to both game-scoped rule tables');
assert(migration.includes('pg_publication_tables'),'Avoid duplicate publication registration');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec("CREATE SCHEMA IF NOT EXISTS public;CREATE TABLE public.parliamentary_election_rules(game_id uuid);CREATE TABLE public.regional_election_rules(game_id uuid);CREATE PUBLICATION supabase_realtime;");
  await db.exec(migration);
  await db.exec(migration);
  const rows=(await db.query("SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename")).rows.map(row=>row.tablename);
  assert.deepEqual(rows,['parliamentary_election_rules','regional_election_rules'],'Only two proposal tables are published; migration is idempotent');
  console.log('PASS KSRF: 2 published tables, 0 dedicated channels, scoped and bounded refresh, immediate proposal rendering');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
