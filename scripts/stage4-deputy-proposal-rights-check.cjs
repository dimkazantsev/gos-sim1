/* Stage-4 authority tests for registered deputy proposals and meeting coordination.
 * Runs against an isolated in-memory PostgreSQL, never production data.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261017235000_stage4_registered_deputy_motions.sql','utf8');
const jsx=fs.readFileSync('components/game/DumaLeadershipElection.tsx','utf8');
assert(jsx.includes('get_my_institution_meeting_permissions'),'UI checks server-derived coordination rights');
assert(jsx.includes('canPropose')&&jsx.includes('Предложить утверждение порядка'),'Any registered deputy has procedural proposal control');
assert(jsx.includes('canNominate')&&jsx.includes('canManage'),'Nomination and election management have distinct permissions');
assert(jsx.includes('isStageWorkOpen'),'Stage closure disables student proposal UI');
const open=migration.split('CREATE OR REPLACE FUNCTION public.open_duma_leadership_procedure_vote')[1];
assert(open&&open.includes('INSERT INTO public.game_votes(')&&open.includes('p_game_id,4,'),'A deputy can open a stage-scoped motion directly, without teacher-only generic RPC');
assert(migration.includes("v_cast<226"),'Chair cannot close a ballot below 226 votes');
assert(migration.includes("p_office_key IN ('gd_chair','gd_deputy_1','gd_deputy_2')"),'Ordinary deputy nominations are limited to GD leadership offices');
assert(migration.includes('registration_status=')&&migration.includes("'registered'"),'Student nominations require a registered faction');
(async()=>{
 const db=new PGlite();
 const game='10000000-0000-0000-0000-000000000001';
 const member='20000000-0000-0000-0000-000000000001';
 const unregistered='20000000-0000-0000-0000-000000000002';
 try{
  await db.exec('create schema private;create role anon;create role authenticated;'+
   "create table games(id uuid primary key,status text,turn_open boolean,turn_ends_at timestamptz);"+
   "create table game_stages(game_id uuid,stage_no integer,status text,deadline timestamptz);"+
   "create table institution_meeting_records(game_id uuid,stage_no integer,institution_key text,agenda_document_id uuid,agenda_approved_at timestamptz,agenda_body text);"+
   "create table formal_documents(game_id uuid,id uuid,status_code text);"+
   "create table game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);"+
   "create table institution_session_registrations(game_id uuid,user_id uuid,stage_no integer,institution_key text);"+
   "create function private.role_is_available(uuid,uuid) returns boolean language sql stable as $$select true$$;"+
   "create function private.gd_member_capacity(uuid,uuid) returns int language sql stable as $$select 225$$;"+
   "create function private.is_game_teacher(uuid) returns boolean language sql stable as $$select false$$;"+
   "create function private.can_manage_duma_committees(uuid,uuid) returns boolean language sql stable as $$select false$$;"+
   "create function private.can_coordinate_stage_meeting(uuid,int,text,uuid) returns boolean language sql stable as $$select true$$;");
  const helperSQL=migration.slice(0,migration.indexOf('CREATE OR REPLACE FUNCTION public.open_duma_leadership_procedure_vote'));
  assert(helperSQL.includes('gd_stage4_meeting_active'),'Helper SQL is present');
  await db.exec(helperSQL);
  await db.query("insert into games values($1,'running',true,null)",[game]);
  await db.query("insert into game_stages values($1,4,'open',null)",[game]);
  await db.query("insert into formal_documents values($1,$2,'published')",[game,'30000000-0000-0000-0000-000000000001']);
  await db.query("insert into institution_meeting_records values($1,4,'gd',$2,now(),$3)",[game,'30000000-0000-0000-0000-000000000001','Утверждённая повестка заседания Государственной Думы с подробным содержанием']);
  await db.query("insert into game_members values($1,$2,'student',null),($1,$3,'student',null)",[game,member,unregistered]);
  await db.query("insert into institution_session_registrations values($1,$2,4,'gd')",[game,member]);
  async function allowed(uid){return (await db.query('select private.gd_stage4_deputy_can_propose($1,$2) result',[game,uid])).rows[0].result}
  async function manage(uid){return (await db.query("select private.gd_stage4_can_manage($1,$2,'gd_chair') result",[game,uid])).rows[0].result}
  assert.equal(await allowed(member),true,'Registered deputy may propose');
  assert.equal(await manage(member),true,'Registered coordinating deputy may create election');
  assert.equal(await allowed(unregistered),false,'A nonregistered student may not propose');
  await db.query("update games set turn_open=false where id=$1",[game]);
  assert.equal(await allowed(member),false,'Paused turn revokes procedural action');
  await db.query("update games set turn_open=true where id=$1",[game]);
  await db.query("update game_stages set status='completed' where game_id=$1",[game]);
  assert.equal(await allowed(member),false,'Completed stage is immutable');
  await db.query("update game_stages set status='open' where game_id=$1",[game]);
  await db.query("update institution_meeting_records set agenda_approved_at=null where game_id=$1",[game]);
  assert.equal(await allowed(member),false,'Unapproved agenda cannot open procedures');
  await db.query("update institution_meeting_records set agenda_approved_at=now() where game_id=$1",[game]);
  await db.query("update formal_documents set status_code='draft' where game_id=$1",[game]);
  assert.equal(await allowed(member),false,'Unpublished document does not authorize proposal');
  await db.query("update formal_documents set status_code='published' where game_id=$1",[game]);
  assert.equal(await allowed(member),true);
  console.log('PASS Duma stage 4: deputy proposal, coordinator role, no registration/paused/completed/unapproved/unpublished denial.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
