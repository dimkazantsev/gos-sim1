const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const work=path.resolve(__dirname,'..');
const {PGlite}=require('@electric-sql/pglite');
const previous=fs.readFileSync(path.join(work,'supabase/changes/20261002_achievement_visibility.sql'),'utf8');
const originalRead=previous.slice(previous.indexOf('create or replace function public.get_game_achievements('),previous.indexOf('revoke all on function public.get_teacher_achievements'));
const migration=path.join(work,'supabase/migrations/20261025124344_achievement_nightly_snapshots.sql');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const game=id(1000),foreignGame=id(1001),teacher=id(100),observer=id(101);
async function main(){
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA private;CREATE SCHEMA cron;
   CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE public.games(id uuid PRIMARY KEY);
   CREATE TABLE public.game_members(game_id uuid REFERENCES public.games,user_id uuid REFERENCES auth.users,kind text,roster_archived_at timestamptz,PRIMARY KEY(game_id,user_id));
   CREATE TABLE private.achievement_catalog(id text PRIMARY KEY,title text,description text,hidden boolean,conditions jsonb,sort_order integer);
   CREATE TABLE public.game_achievements(game_id uuid,user_id uuid,achievement_id text,earned_at timestamptz NOT NULL DEFAULT clock_timestamp(),notified_at timestamptz,PRIMARY KEY(game_id,user_id,achievement_id));
   CREATE TABLE public.game_achievement_settings(game_id uuid,achievement_id text,hidden boolean,PRIMARY KEY(game_id,achievement_id));
   CREATE TABLE private.fixture_facts(user_id uuid PRIMARY KEY,facts jsonb NOT NULL DEFAULT '{}',error_code text);
   CREATE TABLE private.fixture_calls(user_id uuid,called_at timestamptz NOT NULL DEFAULT clock_timestamp());
   CREATE TABLE cron.job(jobname text PRIMARY KEY,schedule text,command text);
   CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE plpgsql AS $$BEGIN INSERT INTO cron.job VALUES($1,$2,$3) ON CONFLICT(jobname) DO UPDATE SET schedule=excluded.schedule,command=excluded.command;RETURN 1;END$$;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   CREATE FUNCTION private.is_game_member(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=$1 AND user_id=auth.uid())$$;
   CREATE FUNCTION private.achievement_facts(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
   DECLARE v jsonb;e text;BEGIN
    INSERT INTO private.fixture_calls(user_id) VALUES($2);
    SELECT facts,error_code INTO v,e FROM private.fixture_facts WHERE user_id=$2;
    IF e IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE=e,MESSAGE='synthetic fixture failure';END IF;
    RETURN coalesce(v,'{}');END$$;
   REVOKE ALL ON FUNCTION private.achievement_facts(uuid,uuid) FROM PUBLIC,anon,authenticated;
   GRANT USAGE ON SCHEMA auth TO authenticated,anon;
   GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;`);
  await db.query('INSERT INTO public.games VALUES($1),($2)',[game,foreignGame]);
  for(let n=1;n<=40;n++){
   await db.query('INSERT INTO auth.users VALUES($1);',[id(n)]);
   await db.query("INSERT INTO public.game_members(game_id,user_id,kind) VALUES($1,$2,'student')",[game,id(n)]);
   await db.query('INSERT INTO private.fixture_facts(user_id) VALUES($1)',[id(n)]);
  }
  for(const [user,kind] of [[teacher,'teacher'],[observer,'observer']]){
   await db.query('INSERT INTO auth.users VALUES($1)',[user]);
   await db.query('INSERT INTO public.game_members(game_id,user_id,kind) VALUES($1,$2,$3)',[game,user,kind]);
  }
  await db.query('INSERT INTO auth.users VALUES($1)',[id(102)]);
  await db.query("INSERT INTO public.game_members VALUES($1,$2,'student','2026-10-01T00:00:00Z')",[game,id(102)]);
  await db.exec(fs.readFileSync(path.join(work,'supabase/changes/20261002_achievement_catalog.sql'),'utf8'));
  await db.exec(originalRead);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
  await db.query('SELECT public.get_game_achievements($1)',[game]);
  await db.query('SELECT public.get_game_achievements($1)',[game]);
  assert.equal((await db.query('SELECT count(*)::int n FROM private.fixture_calls')).rows[0].n,2,'Reproduction: the old read recalculates facts on every request');
  if(process.argv.includes('--reproduce-only')){
   console.log('REPRODUCED: two ordinary achievement reads invoke expensive facts twice. No live calls.');return;
  }
  await db.exec(fs.readFileSync(migration,'utf8'));
  const preEarned='medal-061';
  await db.query("INSERT INTO public.game_achievements VALUES($1,$2,$3,'2026-10-01T00:00:00Z','2026-10-02T00:00:00Z')",[game,id(1),preEarned]);
  async function read(user=id(1)){return(await db.query('SELECT public.get_game_achievements($1,$2) result',[game,user])).rows[0].result}
  const before=await read();
  assert.equal(before.length,61,'60 open awards plus the already earned hidden award');
  assert.equal(before.find(a=>a.id===preEarned).progress,100,'Existing awards remain complete before the first nightly snapshot');
  assert(before.filter(a=>!a.earned_at).every(a=>a.progress===0&&a.checked_at===null),'No fabricated progress before the first night');
  await db.exec('SET ROLE authenticated');
  for(let i=0;i<100;i++){
   await read();
   assert.equal((await db.query('SELECT public.evaluate_game_achievements($1) n',[game])).rows[0].n,0);
  }
  await assert.rejects(db.query('SELECT * FROM private.achievement_snapshots'),/permission denied/);
  await assert.rejects(db.query('SELECT private.run_nightly_achievements()'),/permission denied/);
  await assert.rejects(db.query('SELECT private.achievement_facts($1,$2)',[game,id(1)]),/permission denied/);
  await assert.rejects(db.query('SELECT public.get_game_achievements($1,$2)',[foreignGame,id(1)]),/Награды этого профиля недоступны/);
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int n FROM private.fixture_calls')).rows[0].n,2,'New daytime reads and compatibility calls never collect facts');
  for(const user of [teacher,observer]){
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
   assert.equal((await db.query('SELECT public.evaluate_game_achievements($1) n',[game])).rows[0].n,0);
  }
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(read(),/Награды этого профиля недоступны/);
  const fullFacts={};
  for(const {conditions} of (await db.query('SELECT conditions FROM private.achievement_catalog')).rows)
   for(const [key,value] of Object.entries(conditions))fullFacts[key]=Math.max(fullFacts[key]||0,Number(value));
  await db.query('UPDATE private.fixture_facts SET facts=$1',[JSON.stringify(fullFacts)]);
  async function tick(iso){return(await db.query('SELECT private.run_nightly_achievements($1::timestamptz) n',[iso])).rows[0].n}
  assert.equal(await tick('2026-10-25T19:59:00Z'),0,'No work before 03:00 Novosibirsk');
  assert.equal(await tick('2026-10-25T21:00:00Z'),0,'No work at or after 04:00 Novosibirsk');
  const started=performance.now();
  for(let minute=1;minute<=40;minute++){
   assert.equal(await tick(`2026-10-25T20:${String(minute).padStart(2,'0')}:00Z`),1,'One student per batch');
   assert.equal((await db.query('SELECT count(*)::int n FROM private.achievement_snapshots WHERE checked_at IS NOT NULL')).rows[0].n,minute,'Bounded, nonduplicated progress through the roster');
  }
  const measuredMs=performance.now()-started;
  assert.equal((await db.query('SELECT count(*)::int n FROM public.game_achievements')).rows[0].n,4000,'All 100 rules per synthetic eligible student');
  assert.equal((await db.query('SELECT count(*)::int n FROM private.fixture_calls')).rows[0].n,42,'Forty students require exactly forty nightly calculations');
  assert.equal(await tick('2026-10-25T20:50:00Z'),0,'Completed students are not recalculated that night');
  assert.equal((await db.query('SELECT count(*)::int n FROM private.achievement_snapshots WHERE user_id=ANY($1::uuid[])',[[teacher,observer,id(102)]])).rows[0].n,0,'Teachers, observers and archived members do not consume nightly slots');
  assert.deepEqual((await db.query('SELECT earned_at,notified_at FROM public.game_achievements WHERE game_id=$1 AND user_id=$2 AND achievement_id=$3',[game,id(1),preEarned])).rows[0],{earned_at:new Date('2026-10-01T00:00:00Z'),notified_at:new Date('2026-10-02T00:00:00Z')},'Old earn and notification timestamps survive');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
  const morning=await read();assert.equal(morning.length,100);assert(morning.every(a=>a.progress===100&&a.checked_at),'Morning reads expose the completed snapshot and earned hidden awards');
  await db.query('INSERT INTO public.game_achievement_settings VALUES($1,$2,true)',[game,'medal-001']);
  assert.equal((await read()).find(a=>a.id==='medal-001').hidden,true,'Teacher visibility applies immediately to cached progress');
  await db.query("UPDATE private.fixture_facts SET error_code='42703' WHERE user_id=$1",[id(1)]);
  await db.query("UPDATE private.fixture_facts SET error_code='57014' WHERE user_id=$1",[id(2)]);
  assert.equal(await tick('2026-10-26T20:01:00Z'),0,'A failing student is isolated');
  assert.equal(await tick('2026-10-26T20:02:00Z'),0,'Query cancellation is recorded rather than poisoning the whole queue');
  for(let minute=3;minute<=40;minute++)assert.equal(await tick(`2026-10-26T20:${String(minute).padStart(2,'0')}:00Z`),1);
  assert.equal((await db.query("SELECT count(*)::int n FROM private.achievement_snapshots WHERE checked_at>='2026-10-26T20:00:00Z'")).rows[0].n,38,'Other students finish despite both failure types');
  await tick('2026-10-26T20:41:00Z');await tick('2026-10-26T20:42:00Z');
  assert.equal(await tick('2026-10-26T20:43:00Z'),0,'Retries wait five minutes');
  await tick('2026-10-26T20:46:00Z');await tick('2026-10-26T20:47:00Z');
  assert.equal(await tick('2026-10-26T20:55:00Z'),0,'Only three attempts per student and night');
  const failures=(await db.query('SELECT attempts,last_error FROM private.achievement_snapshots WHERE user_id=ANY($1::uuid[]) ORDER BY user_id',[[id(1),id(2)]])).rows;
  assert.deepEqual(failures,[{attempts:3,last_error:'42703'},{attempts:3,last_error:'57014'}]);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.game_achievements')).rows[0].n,4000,'Failed or repeated checks never revoke or duplicate earned awards');
  await db.query('UPDATE private.fixture_facts SET error_code=NULL,facts=$1',[JSON.stringify({documents:1})]);
  assert.equal(await tick('2026-10-27T20:01:00Z'),1,'Retry budget resets on a new local day');
  assert.equal((await read()).find(a=>a.id==='medal-001').progress,100,'Earned progress stays complete when current facts decrease');
  const job=(await db.query('SELECT * FROM cron.job')).rows;
  assert.equal(job.length,1);assert.equal(job[0].jobname,'gos_id_achievement_nightly');
  assert.equal(job[0].schedule,'1-10,12-30,32-50,52-59 20 * * *');
  assert.match(job[0].command,/statement_timeout\s*=\s*'15s'/);
  await db.exec(fs.readFileSync(migration,'utf8'));
  assert.equal((await db.query('SELECT count(*)::int n FROM cron.job')).rows[0].n,1,'Applying the migration again keeps one named job');
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','private.achievement_snapshots','SELECT') allowed")).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_function_privilege('authenticated','private.run_nightly_achievements(timestamptz)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await db.query("SELECT relrowsecurity enabled FROM pg_class WHERE oid='private.achievement_snapshots'::regclass")).rows[0].enabled,true);
  console.log(JSON.stringify({result:'PASS',reproduction_old_reads:2,old_facts_calls:2,new_daytime_reads:100,new_daytime_facts_calls:0,synthetic_students:40,nightly_calculations:40,eligible_awards:4000,simulated_batch_ms:Math.round(measuredMs),checks:['night-window','one-student-per-batch','private-data-and-worker','cross-game-and-anonymous','hidden-awards','existing-earned-preserved','three-attempt-cap','five-minute-retry-gap','query-cancellation-isolation','next-day-retry-reset','idempotent-awards-and-cron'],environment:'PGlite synthetic fixtures; no production or concurrency claim'}));
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
