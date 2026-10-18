const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const original=fs.readFileSync('supabase/migrations/20261018050000_all_stage_final_documents_guard.sql','utf8');
const sql=fs.readFileSync('supabase/migrations/20261018072000_stage_final_document_debts.sql','utf8');
const fn=(source,name)=>{const re=new RegExp('CREATE OR REPLACE FUNCTION '+name.replace(/\./g,'\\.')+'\\([\\s\\S]*?\\$fn\\$;');const x=source.match(re);assert(x,name+' function exists');return x[0]};
const uuid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
const db=new PGlite();
try{
 await db.exec([
  'create schema private;create schema auth;create role anon;create role authenticated;',
  'create table identity(id uuid,teacher boolean);',
  "insert into identity values('10000000-0000-0000-0000-000000000101',false);",
  'create function auth.uid() returns uuid language sql stable as $q$select id from identity$q$;',
  'create function private.is_game_member(uuid) returns boolean language sql stable as $q$select id is not null from identity$q$;',
  'create function private.is_game_teacher(uuid) returns boolean language sql stable as $q$select teacher from identity$q$;',
  'create table games(id uuid primary key);',
  'create table game_stages(game_id uuid,stage_no integer,status text,primary key(game_id,stage_no));',
  "create table game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);",
  "create table formal_documents(game_id uuid,stage_no integer,doc_type text,status_code text,subject_key text,title text,metadata jsonb default '{}'::jsonb);",
  'create table stage_debriefs(game_id uuid,stage_no integer,user_id uuid,note text);',
  "create function private.can_create_formal_subject(uuid,uuid,text) returns boolean language sql stable as $q$select $2='10000000-0000-0000-0000-000000000101'::uuid and $3='gd'$q$;",
  "create function private.can_coordinate_institution_meeting(uuid,text,uuid) returns boolean language sql stable as $q$select $3='10000000-0000-0000-0000-000000000101'::uuid$q$;",
  original.match(/CREATE OR REPLACE FUNCTION private\.stage_required_final_documents[\s\S]*?\$finals\$;/)[0]
 ].join('\n'));
 const match=sql.match(/CREATE TABLE IF NOT EXISTS public\.stage_final_document_obligations[\s\S]*?ALTER TABLE public\.stage_final_document_obligations ENABLE ROW LEVEL SECURITY;/);
 assert(match,'Assignment table migration should create obligation ledger');
 await db.exec(match[0]);
 const game=uuid(1),chair=uuid(101),other=uuid(102);
 await db.query('insert into games(id) values($1)',[game]);
 await db.query("insert into game_stages values($1,4,'completed'),($1,5,'open')",[game]);
 for(let i=101;i<141;i++)await db.query("insert into game_members values($1,$2,'student',null)",[game,uuid(i)]);
 for(const name of ['private.capture_stage_document_obligations','private.stage_document_debts','private.stage_document_penalty_points','private.has_prior_stage_document_hold','public.get_my_stage_document_holds','private.guard_stage_document_hold_write'])await db.exec(fn(sql,name));
 await db.query('select private.capture_stage_document_obligations($1,4)',[game]);
 const counts=(await db.query('select user_id,count(*)::int n from stage_final_document_obligations group by user_id')).rows;
 assert.deepEqual(counts,[{user_id:chair,n:2}],'Only the elected authorised leader is held accountable');
 const d=(await db.query('select private.stage_document_debts($1,$2,4) d',[game,chair])).rows[0].d;
 assert.equal(d.length,2,'Both GD documents remain due');
 const penalty=(await db.query('select private.stage_document_penalty_points($1,$2,4) penalty',[game,chair])).rows[0].penalty;
 assert.equal(Number(penalty),1);
 assert.equal((await db.query('select private.stage_document_penalty_points($1,$2,4) penalty',[game,other])).rows[0].penalty,'0');
 const current=(await db.query('select public.get_my_stage_document_holds($1) h',[game])).rows[0].h;
 assert.equal(current.length,1);assert.equal(current[0].blocked_stage,5);
 await db.exec("create trigger stage_document_member_progress_guard before insert on stage_debriefs for each row execute function private.guard_stage_document_hold_write()");
 const add=(user)=>db.query('insert into stage_debriefs values($1,5,$2,\\'test\\')',[game,user]);
 const tasks=await Promise.allSettled(Array.from({length:40},()=>add(chair)));
 assert.equal(tasks.filter(t=>t.status==='rejected').length,40,'No writes during held next stage');
 await db.query('update identity set id=$1',[other]);
 await add(other);
 assert.equal((await db.query('select count(*)::int n from stage_debriefs')).rows[0].n,1,'Unrelated deputy proceeds');
 await db.query('update identity set id=$1',[chair]);
 for(const [type,title,meta] of [
  ['gd_resolution','Постановление Государственной Думы',{}],
  ['other','Протокол заседания Государственной Думы',{template_key:'minutes'}]
 ])await db.query("insert into formal_documents(game_id,stage_no,doc_type,status_code,subject_key,title,metadata) values($1,4,$2,'published','gd',$3,$4)",[game,type,title,JSON.stringify(meta)]);
 const post=(await db.query('select public.get_my_stage_document_holds($1) h',[game])).rows[0].h;
 assert.deepEqual(post,[],'Published final docs clear hold immediately');
 await add(chair);
 assert.equal((await db.query('select count(*)::int n from stage_debriefs')).rows[0].n,2,'Official proceeds after remediation');
 console.log('PASS stage debt: chair-only obligations, one-point pending grade deduction, 40 refused next-stage actions, other deputy allowed, instant unlock after both publications.');
}finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});