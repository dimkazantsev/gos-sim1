'use strict';
// Minimal SQL trigger + offline regression. Does not touch production state.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261111130451_political_broadcast_idle_telegram.sql','utf8');
const game=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const budget=fs.readFileSync('components/game/useBudgetPulse.ts','utf8');
const freeze=fs.readFileSync('lib/featureFreeze.ts','utf8');
assert(freeze.includes('TELEGRAM_PAUSED = true'),'Only disable idle Telegram cron while paused');
assert(game.includes("channel.on('broadcast',{event:'political_posts_changed'}"),'Scoped broadcast subscribed');
assert(!game.includes("'formal_documents','political_posts','game_votes'"),'Legacy political per-subscriber RLS removed');
assert(game.includes("if(activeViewRef.current==='actions')reconcileTables.add('political_posts')"),'Only open wall refreshes contents');
assert(game.includes("if(!liveConnected)void loadChatOverview();"),'Healthy chat avoids duplicate overview query');
assert(game.includes("dirtyOverview=true;"),'Three-minute overview reconciliation preserved');
assert(game.includes("chatRecovery=setInterval(recoverVisibleChatAndBallots,6000)"),'Offline chat recovery retained');
assert(budget.includes('180000+Math.floor(Math.random()*30000)'), 'Budget check moves to 3–3.5 min');
assert(budget.includes("window.addEventListener(GAME_DATA_REFRESH_EVENT,changed)"),'Event-driven budget refresh stays immediate');
assert(!migration.includes('ALTER PUBLICATION')&&!migration.includes('DROP TABLE'),'No new replicated user tables');
assert(migration.includes('REVOKE ALL ON FUNCTION private.broadcast_political_posts_invalidation()'),'Trigger function not executable by clients');
async function run(){
 const db=new PGlite();
 try{
  await db.exec('CREATE SCHEMA private; CREATE SCHEMA realtime; CREATE SCHEMA cron; CREATE ROLE anon; CREATE ROLE authenticated;');
  await db.exec('CREATE TABLE realtime.messages(topic text,event text,payload jsonb,is_private boolean);');
  await db.exec("CREATE FUNCTION realtime.send(data jsonb,ev text,room text,priv boolean) RETURNS void LANGUAGE plpgsql AS $$BEGIN INSERT INTO realtime.messages(topic,event,payload,is_private) VALUES(room,ev,data,priv);END$$;");
  await db.exec('CREATE TABLE public.political_posts(id uuid PRIMARY KEY,game_id uuid,body text);');
  await db.exec('CREATE TABLE public.telegram_outbox(id uuid PRIMARY KEY,sent_at timestamptz,attempts integer);');
  await db.exec("CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text,active boolean,command text);");
  await db.exec("CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL,database text DEFAULT NULL,username text DEFAULT NULL,active boolean DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$BEGIN UPDATE cron.job SET active=$6 WHERE jobid=$1;END$$;");
  await db.exec("INSERT INTO cron.job VALUES(10,'gos_id_telegram_dispatch',true,'select private.request_telegram_dispatch()'),(9,'gos_stage_close',true,'select public.close_expired_game_stages()');");
  await db.exec(migration);
  const jobs=(await db.query("SELECT jobname,active FROM cron.job ORDER BY jobid")).rows;
  assert.equal(jobs.find(x=>x.jobname==='gos_id_telegram_dispatch').active,false,'Pause only Telegram dispatch');
  assert.equal(jobs.find(x=>x.jobname==='gos_stage_close').active,true,'Stage closure unaffected');
  const gameA='00000000-0000-4000-8000-000000000101';
  const gameB='00000000-0000-4000-8000-000000000102';
  const post='00000000-0000-4000-8000-000000000103';
  await db.query('INSERT INTO public.political_posts VALUES($1,$2,$3)',[post,gameA,'Секретный партийный материал']);
  await db.query('UPDATE public.political_posts SET body=$2 WHERE id=$1',[post,'Секретное обновление']);
  await db.query('UPDATE public.political_posts SET game_id=$2 WHERE id=$1',[post,gameB]);
  await db.query('DELETE FROM public.political_posts WHERE id=$1',[post]);
  const rows=(await db.query('SELECT topic,event,payload,is_private FROM realtime.messages ORDER BY ctid')).rows;
  assert.equal(rows.length,5,'Insert, update, cross-game update, delete send five notices');
  assert.deepEqual(rows.map(x=>x.topic),['gos-id-live:'+gameA,'gos-id-live:'+gameA,'gos-id-live:'+gameB,'gos-id-live:'+gameA,'gos-id-live:'+gameB]);
  assert(rows.every(x=>x.is_private&&x.event==='political_posts_changed'),'Never use public Realtime');
  assert(rows.every(x=>JSON.stringify(x.payload)==='{"table":"political_posts"}'),'Never broadcast contents or secrets');
  console.log('PASS: private metadata-only broadcast, moved games, saved posts, muted Telegram, unchanged stage cron, budget/chat guards.');
 }finally{await db.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1});
