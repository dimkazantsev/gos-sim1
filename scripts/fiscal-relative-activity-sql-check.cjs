// Authoritative regression for manual baseline + automatic macro response.
// Entirely isolated PGlite fixture: no real users, services, or data modifications.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261113153000_fiscal_relative_activity_baseline.sql','utf8');
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const auto=(p,e,t)=>{const econ=e-p.baseline_economy,trust=t-p.baseline_trust;
 const fx=p.fx_rate*Math.max(.75,Math.min(1.3,1-econ*.001-trust*.001-(p.key_rate-16)*.0015));
 return Math.max(.65,Math.min(1.4,1-(p.key_rate-16)*.007+econ*.002+trust*.001-(fx/80-1)*.06));
};
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE SCHEMA auth','CREATE SCHEMA private','CREATE ROLE anon','CREATE ROLE authenticated',
   'CREATE TABLE public.game_fiscal_policy(game_id uuid PRIMARY KEY,key_rate numeric,fx_rate numeric,oil_price numeric,cutoff_price numeric,inflation numeric,federal_expenditure numeric,municipal_expenditure numeric,baseline_economy numeric,baseline_trust numeric,activity_override numeric,updated_at timestamptz)',
   'CREATE TABLE public.state_metrics(game_id uuid,metric_key text,value numeric,PRIMARY KEY(game_id,metric_key))',
   'CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,role_title text)',
   'CREATE TABLE public.fiscal_change_ledger(game_id uuid,source_type text,source_id text,note text,before_values jsonb,after_values jsonb,actor_id uuid)',
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$",
   "CREATE FUNCTION private.is_game_member(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM game_members m WHERE m.game_id=g AND m.user_id=auth.uid()) $f$",
   "CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM game_members m WHERE m.game_id=g AND m.user_id=auth.uid() AND m.kind='teacher') $f$",
   "CREATE FUNCTION private.role_is_available(g uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM game_members WHERE game_id=g AND user_id=u) $f$",
   "CREATE FUNCTION public.get_fiscal_context(g uuid) RETURNS jsonb LANGUAGE sql AS $f$ SELECT jsonb_build_object('metrics',COALESCE((SELECT jsonb_object_agg(metric_key,value) FROM state_metrics WHERE game_id=g),'{}'::jsonb)) $f$"
  ].join(';\n')+';');
  const game=uid(1),teacher=uid(2),student=uid(3),banker=uid(4);
  await db.query('INSERT INTO game_members(game_id,user_id,kind,role_title) VALUES ($1,$2,$3,$4),($1,$5,$6,$7),($1,$8,$9,$10)',[game,teacher,'teacher','Преподаватель',student,'student','Депутат',banker,'student','Банк России']);
  await db.query('INSERT INTO game_fiscal_policy VALUES ($1,16,79,59,40,16,100,40,16,12,79,now())',[game]);
  await db.query("INSERT INTO state_metrics VALUES($1,'economy',13.7),($1,'public_trust',12)",[game]);
  // Applying the migration must preserve the existing teacher-entered 79%.
  await db.exec(migration);
  const get=async()=>((await db.query('SELECT * FROM game_fiscal_policy WHERE game_id=$1',[game])).rows[0]);
  let row=await get(), ref=auto({key_rate:16,fx_rate:79,baseline_economy:16,baseline_trust:12},13.7,12);
  assert(Math.abs(Number(row.activity_reference)-ref)<1e-10,'Backfill captures the existing automatic reference');
  const shown=(p,e,t)=>p.activity_override===null?auto(p,e,t)*100:
   Math.min(1000,Math.max(0,Number(p.activity_override)*auto(p,e,t)/Number(p.activity_reference)));
  assert(Math.abs(shown(row,13.7,12)-79)<1e-9,'The saved 79% must not jump after deployment');
  const enter=async user=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
  const save=async(body,reason='Проверено расчётное решение')=>db.query('SELECT public.set_fiscal_policy($1,$2::jsonb,$3)',[game,JSON.stringify(body),reason]);
  await enter(teacher);
  await save({key_rate:21});
  row=await get();
  assert(Math.abs(Number(row.activity_reference)-ref)<1e-10,'Key rate alone never rebases teacher activity');
  const afterRate=shown(row,13.7,12);
  assert(afterRate<79,'Higher key rate decreases manual-based activity');
  await db.query("UPDATE state_metrics SET value=16 WHERE game_id=$1 AND metric_key='economy'",[game]);
  assert(shown(row,16,12)>afterRate,'A game economy improvement increases the manual-based activity');
  await save({activity_override:82,key_rate:22},'Новая исходная деловая активность');
  row=await get();
  assert.equal(Number(row.activity_override),82);
  assert(Math.abs(shown(row,16,12)-82)<1e-9,'Manual baseline + simultaneous rate change starts at exactly 82%');
  const savedRef=Number(row.activity_reference);
  await enter(banker);
  await save({key_rate:24},'Решение Банка России о ставке');
  row=await get();
  assert.equal(Number(row.activity_reference),savedRef,'Bank of Russia cannot rebase teacher activity');
  assert(shown(row,16,12)<82,'Bank rate change still moves activity');
  await assert.rejects(()=>save({activity_override:150},'Попытка установить активность'),/только преподаватель/i);
  await enter(student);
  await assert.rejects(()=>save({activity_override:0}),/Ключевую ставку меняет|только преподаватель/i);
  await enter(teacher);
  await save({activity_override:null},'Возврат к исходному автоматическому расчёту');
  row=await get();
  assert.equal(row.activity_override,null,'Clearing restores automatic mode');
  assert.equal(row.activity_reference,null,'Reference is cleared with manual value');
  assert(Math.abs(shown(row,16,12)-auto(row,16,12)*100)<1e-9,'Automatic mode remains unchanged');
  const ledger=(await db.query('SELECT COUNT(*)::int n FROM fiscal_change_ledger')).rows[0].n;
  assert.equal(ledger,4,'Each authorized action creates exactly one ledger entry');
  console.log('PASS fiscal relative baseline: 79% safe backfill, rate and event response, reset, teacher/bank permissions, one write per action.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
