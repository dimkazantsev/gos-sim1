/* Isolated SQL regression for final documents. Production remains untouched. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const raw=fs.readFileSync('supabase/migrations/20261018050000_all_stage_final_documents_guard.sql','utf8');
const policy=raw.match(/CREATE OR REPLACE FUNCTION private\.stage_required_final_documents[\s\S]*?\$finals\$;/)?.[0];
const guard=raw.match(/CREATE OR REPLACE FUNCTION private\.guard_stage_finalization[\s\S]*?\$guard\$;/)?.[0];
assert(policy&&guard,'Both SQL functions exist');
assert(raw.includes('v_stage.stage_no'),'Expired stages 1–16 must be checked individually');
assert(raw.includes('v_required_missing'),'Historical override may not clear document blockers');
const uuid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'create schema private;create role anon;create role authenticated;',
   "create table formal_documents(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no integer,doc_type text,subject_key text,title text,status_code text,metadata jsonb default '{}'::jsonb);",
   "create table game_stages(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no integer,status text);",
   policy,
   "create function private.stage_readiness_json(p_game uuid,p_stage integer) returns jsonb language sql stable as $ready$ select jsonb_build_object('ready',not exists(select 1 from jsonb_array_elements(private.stage_required_final_documents(p_game,p_stage)) d where (d->>'fulfilled')::boolean=false),'blockers',jsonb_build_array('Не опубликован итоговый документ')) $ready$;",
   guard,
   'create trigger stage_final_document_readiness_guard before update of status on game_stages for each row execute function private.guard_stage_finalization();'
  ].join('\n'));
  const req=async(game,stage)=>(await db.query('select private.stage_required_final_documents($1,$2) as rows',[game,stage])).rows[0].rows;
  const game=uuid(1);
  const expected={1:0,2:1,3:1,4:2,5:2,6:0,7:1,8:2,9:2,10:2,11:1,12:0,13:0,14:1,15:1,16:0};
  for(const [stage,count] of Object.entries(expected))assert.equal((await req(game,Number(stage))).length,count,'Expected requirements for stage '+stage);
  await db.query("insert into game_stages(game_id,stage_no,status) values($1,4,'open')",[game]);
  const finish=()=>db.query("update game_stages set status='completed' where game_id=$1 and stage_no=4",[game]);
  await assert.rejects(finish,/Нельзя завершить этап/,'No empty-document finish');
  await db.query("insert into formal_documents(game_id,stage_no,doc_type,subject_key,title,status_code) values($1,4,'gd_resolution','gd','Постановление ГД','draft')",[game]);
  assert.equal((await req(game,4)).filter(x=>x.fulfilled).length,0,'Draft does not complete');
  await db.query("update formal_documents set status_code='published' where game_id=$1",[game]);
  await assert.rejects(finish,/Нельзя завершить этап/,'Resolution alone is insufficient');
  await db.query("insert into formal_documents(game_id,stage_no,doc_type,subject_key,title,status_code,metadata) values($1,4,'other','gd','Протокол заседания Государственной Думы','published',$2)",[game,JSON.stringify({template_key:'minutes'})]);
  assert.equal((await req(game,4)).filter(x=>x.fulfilled).length,2,'Both documents published');
  await finish();
  await db.query("delete from formal_documents where game_id=$1",[game]);
  await db.query("update game_stages set status='completed' where game_id=$1",[game]);
  for(let i=0;i<40;i++)await db.query("insert into game_stages(game_id,stage_no,status) values($1,4,'open')",[uuid(100+i)]);
  const attempts=await Promise.allSettled(Array.from({length:40},(_,i)=>db.query("update game_stages set status='completed' where game_id=$1 and stage_no=4",[uuid(100+i)])));
  assert.equal(attempts.filter(a=>a.status==='rejected').length,40);
  assert.equal((await db.query("select count(*)::int n from game_stages where stage_no=4 and status='open'")).rows[0].n,40);
  console.log('PASS: stages 1–16 mapped; resolution+minutes required; drafts rejected; 40 parallel unready closures denied; completed historical stages kept.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
