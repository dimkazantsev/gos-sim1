/* Stage 4: real readiness blocks both automatic and manual closure.
 * Isolated PGlite database; never touches production.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261018000500_stage4_readiness_before_completion.sql','utf8');
assert(migration.includes("private.stage_readiness_json(g,4)"),'Automatic expiry checks canonical stage-4 readiness');
assert(migration.includes("private.stage_readiness_json(p_game_id,4)"),'Manual close verifies canonical readiness');
assert(migration.includes("where game_id=g and status='open'"),'Other stages retain expiry behavior');
assert(migration.includes("update public.stage_deadline_rules"),'Extended deadline stays synchronized with stored rules');
assert(migration.includes("v_total>0 or v_extended>0"),'Expired stage renewal refreshes the game clock');
const ids=[
 '10000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000003',
 '10000000-0000-0000-0000-000000000004'
];
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'create schema private;',
   'create schema auth;',
   'create table games(id uuid primary key,status text,turn_open boolean,turn_ends_at timestamptz,current_round int);',
   'create table game_stages(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no int,status text,deadline timestamptz,opened_at timestamptz,completed_at timestamptz);',
   'create table stage_deadline_rules(game_id uuid,stage_no int,deadline_at timestamptz,updated_by uuid,updated_at timestamptz);',
   'create table audit_log(game_id uuid,actor_id uuid,action text,entity_type text,payload jsonb);',
   'create table test_ready(game_id uuid primary key,ready boolean);',
   "create function auth.uid() returns uuid language sql stable as $$select '20000000-0000-0000-0000-000000000001'::uuid$$;",
   'create function private.is_game_teacher(uuid) returns boolean language sql stable as $$select true$$;',
   "create function private.stage_readiness_json(p_game uuid,p_stage int) returns jsonb language sql stable as $$select jsonb_build_object('ready',coalesce((select ready from test_ready where game_id=p_game),false))$$;"
  ].join('\n'));
  for(const id of ids){
   await db.query("insert into games values($1,'running',true,now()-interval '1 minute',4)",[id]);
  }
  await db.query('insert into test_ready values($1,false),($2,true),($3,false),($4,false)',ids);
  for(let i=0;i<4;i++){
   await db.query("insert into game_stages(game_id,stage_no,status,deadline) values($1,4,'open',now()-interval '1 minute')",[ids[i]]);
   await db.query("insert into stage_deadline_rules(game_id,stage_no,deadline_at) values($1,4,now()-interval '1 minute')",[ids[i]]);
  }
  await db.query("insert into game_stages(game_id,stage_no,status,deadline) values($1,5,'open',now()-interval '1 minute')",[ids[2]]);
  await db.exec(migration);
  const closed=(await db.query('select public.close_expired_game_stages() as closed')).rows[0].closed;
  assert.equal(closed,2,'Only ready stage 4 and expired stage 5 complete');
  async function stage(id,number=4){
   return (await db.query('select status,deadline,completed_at from game_stages where game_id=$1 and stage_no=$2',[id,number])).rows[0];
  }
  assert.equal((await stage(ids[0])).status,'open','Incomplete stage 4 stays open');
  assert.equal((await stage(ids[1])).status,'completed','Ready stage 4 expires normally');
  assert.equal((await stage(ids[2])).status,'open','Incomplete stage 4 survives a simultaneous stage 5 expiry');
  assert.equal((await stage(ids[2],5)).status,'completed','Unrelated expired stage completes unchanged');
  for(const id of [ids[0],ids[2],ids[3]]){
   const s=await stage(id);
   assert(new Date(s.deadline).getTime()>Date.now()+1200000,'Incomplete stage has a new future deadline');
   const game=(await db.query('select status,turn_open,turn_ends_at from games where id=$1',[id])).rows[0];
   assert.equal(game.status,'running');
   assert.equal(game.turn_open,true);
   assert.equal(new Date(game.turn_ends_at).getTime(),new Date(s.deadline).getTime(),'Game clock follows renewed deadline');
   const rule=(await db.query('select deadline_at from stage_deadline_rules where game_id=$1 and stage_no=4',[id])).rows[0];
   assert.equal(new Date(rule.deadline_at).getTime(),new Date(s.deadline).getTime(),'Deadline rule follows renewed deadline');
  }
  assert.equal((await db.query('select public.close_expired_game_stages() as closed')).rows[0].closed,0,'Cron retry is idempotent');
  let blocked=false;
  try{await db.query("select public.manage_game_stage($1,4,'close',30)",[ids[0]])}catch(error){
   blocked=String(error.message).includes('Нельзя завершить этап 4');
  }
  assert(blocked,'Teacher cannot close incomplete stage 4');
  assert.equal((await stage(ids[0])).status,'open','Manual rejected close does not change status');
  await db.query('update test_ready set ready=true where game_id=$1',[ids[0]]);
  await db.query("select public.manage_game_stage($1,4,'close',30)",[ids[0]]);
  assert.equal((await stage(ids[0])).status,'completed','Teacher may close genuinely ready stage 4');
  await db.query("insert into game_stages(game_id,stage_no,status,deadline) values($1,3,'open',now()+interval '20 minutes')",[ids[3]]);
  await db.query("select public.manage_game_stage($1,3,'close',30)",[ids[3]]);
  assert.equal((await stage(ids[3],3)).status,'completed','Other teacher stage transitions unchanged');
  console.log('PASS stage4 completion gate: 4 games, ready/incomplete expiry, simultaneous other-stage expiry, synchronized clocks, repeat cron, denied manual close, permitted ready close, unrelated teacher close.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
