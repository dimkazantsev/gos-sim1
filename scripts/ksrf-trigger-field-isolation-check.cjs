/* Isolated PostgreSQL trigger reproduction: party_id/doc_type are table-specific. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const file=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261017165000_ksrf_meeting_stage_guard_scope.sql'),'utf8');
const start=file.indexOf('CREATE OR REPLACE FUNCTION private.guard_stage_submission()');
const end=file.indexOf('CREATE OR REPLACE FUNCTION public.save_institution_meeting_document(',start);
assert(start>=0&&end>start,'Exact shared trigger body included');
const guard=file.slice(start,end);
const user='00000000-0000-0000-0000-000000000003',game='00000000-0000-0000-0000-000000000050',
party='00000000-0000-0000-0000-000000000099';
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create schema auth;create schema private;
   create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function private.is_game_teacher(uuid) returns boolean language sql stable as $$select false$$;
   create table public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
   create table public.game_stages(game_id uuid,stage_no integer,status text,deadline timestamptz);
   create table public.game_parties(id uuid,game_id uuid,leader_user_id uuid);
   create table public.party_documents(game_id uuid,party_id uuid,body text);
   create table public.formal_documents(game_id uuid,stage_no integer,doc_type text,metadata jsonb);
   insert into game_members values ('${game}','${user}','student',null);
   insert into game_stages values ('${game}',1,'open',null),('${game}',2,'completed',null);
   insert into game_parties values ('${party}','${game}','${user}');
   select set_config('request.jwt.claim.sub','${user}',false);`);
  await db.exec(guard);
  await db.exec(`create trigger gd before insert on formal_documents for each row execute function private.guard_stage_submission();
   create trigger pd before insert on party_documents for each row execute function private.guard_stage_submission();`);
  await db.query(`insert into party_documents values($1,$2,'Устав зарегистрированной партии')`,[game,party]);
  await assert.rejects(()=>db.query(`insert into party_documents values($1,'00000000-0000-0000-0000-000000000088','Без председателя')`,[game]),/Сначала изберите председателя партии/);
  await assert.rejects(()=>db.query(`insert into formal_documents values($1,2,'gd_resolution','{}'::jsonb)`,[game]),/Этап завершён|ещё не открыт/);
  await db.query(`select set_config('app.gos_meeting_document_scope',$1,true)`,[game+':2:ksrf:agenda']);
  await assert.rejects(()=>db.query(`insert into formal_documents values($1,2,'gd_resolution','{}'::jsonb)`,[game]),/Этап завершён|ещё не открыт/);
  await db.query(`insert into formal_documents values($1,2,'meeting_agenda',$2::jsonb)`,[game,JSON.stringify({document_kind:'institution_meeting_agenda',institution_key:'ksrf'})]);
  assert.equal((await db.query(`select count(*)::integer n from formal_documents where doc_type='meeting_agenda'`)).rows[0].n,1);
  console.log('PASS: parties require elected chair, no cross-record field errors, only scoped agenda bypasses completed stage.');
 }finally{await db.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
