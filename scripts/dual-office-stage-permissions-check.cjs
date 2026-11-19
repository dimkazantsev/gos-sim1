'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const a=fs.readFileSync('supabase/migrations/20261119121314_cross_stage_parallel_office_role_gate_20261119.sql','utf8');
const b=fs.readFileSync('supabase/migrations/20261119121332_duma_coofficial_role_authorization_20261119.sql','utf8');
const ui=fs.readFileSync('components/game/stageRoles.ts','utf8');
const routes=[
  "assign_institution_member",
  "remove_institution_member",
  "set_institution_head",
  "create_budget_document_from_scenario",
  "delete_budget_program_allocation",
  "finalize_budget_scenario",
  "save_budget_scenario",
  "set_budget_program_allocation",
  "save_state_program",
  "propose_ghost_voting_policy",
  "create_presidential_election_appointment_resolution",
  "review_government_structure",
  "submit_government_nomination",
  "appoint_government_nominee",
  "appoint_government_nominee_after_three_rejections"
];
const roleBased=routes.slice(0,11);
for(const name of routes){
 const start=a.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');
 assert(start>=0,'Stage role route missing: '+name);
 const next=a.indexOf('CREATE OR REPLACE FUNCTION ',start+1);
 const body=a.slice(start,next<0?a.length:next);
 assert(body.includes(roleBased.includes(name)?'private.has_effective_role_like':'private.can_manage_presidential_policy'),
   'Role check must accept authorized co-appointments: '+name);
}
assert(b.includes('private.can_manage_duma_session(p_game,p_user)'),'Duma chair authority in the presidential-system decision');
assert(b.includes('private.role_is_available(p_game,p_user)'),'Suspended Duma chair is denied');
assert(ui.includes("officeAssignments.filter(o=>o.user_id===g.me?.user_id&&o.status==='active')"),
 'Student UI must read active secondary office assignments');
const match=a.match(/CREATE OR REPLACE FUNCTION private\.has_effective_role_like[\s\S]*?\$f\$;/);
assert(match,'Reusable office-role helper definition missing');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE SCHEMA auth; CREATE SCHEMA private;
   CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,role_title text,roster_archived_at timestamptz);
   CREATE TABLE game_office_assignments(game_id uuid,user_id uuid,role_title text,status text);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
     SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
   CREATE FUNCTION private.role_is_available(g uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
     SELECT coalesce(current_setting('test.suspended',true),'off')<>'on' $$;
   CREATE FUNCTION private.formal_user_roles(g uuid,u uuid) RETURNS SETOF text LANGUAGE sql STABLE AS $$
     SELECT lower(coalesce(role_title,'')) FROM game_members WHERE game_id=g AND user_id=u AND kind<>'observer'
     UNION SELECT lower(role_title) FROM game_office_assignments WHERE game_id=g AND user_id=u AND status='active' $$;
  `);
  await db.exec(match[0]);
  const gid='10000000-0000-4000-8000-000000000001';
  const pm='20000000-0000-4000-8000-000000000001';
  const deputy='20000000-0000-4000-8000-000000000002';
  const other='20000000-0000-4000-8000-000000000003';
  await db.query("INSERT INTO game_members VALUES($1,$2,'student','Депутат Государственной Думы',null),($1,$3,'student','Председатель политической партии',null),($1,$4,'student','Депутат Государственной Думы',null)",[gid,pm,deputy,other]);
  await db.query("INSERT INTO game_office_assignments VALUES($1,$2,'Председатель Правительства Российской Федерации','active'),($1,$3,'Председатель Государственной Думы','active')",[gid,pm,deputy]);
  const actor=id=>db.query("SELECT set_config('test.actor',$1,false)",[id]);
  const allowed=(u,pat)=>db.query("SELECT private.has_effective_role_like($1,$2,ARRAY[$3]) AS ok",[gid,u,pat]).then(r=>r.rows[0].ok);
  await actor(pm);
  assert.equal(await allowed(pm,'%председател%правительств%'),true,'PM with primary deputy role');
  assert.equal(await allowed(pm,'%президент%'),false,'PM cannot act as President');
  assert.equal(await allowed(deputy,'%председател%дум%'),false,'Cannot use another actor account');
  await actor(deputy);
  assert.equal(await allowed(deputy,'%председател%дум%'),true,'Duma chair with party chair main role');
  assert.equal(await allowed(deputy,'%председател%правительств%'),false,'Duma chair is not PM');
  await actor(other);
  assert.equal(await allowed(other,'%председател%правительств%'),false,'Unrelated student denied');
  await actor(pm);
  await db.exec("SELECT set_config('test.suspended','on',false)");
  assert.equal(await allowed(pm,'%председател%правительств%'),false,'Suspended office denied');
  await db.exec("SELECT set_config('test.suspended','off',false)");
  await db.query('UPDATE game_members SET roster_archived_at=now() WHERE user_id=$1',[pm]);
  assert.equal(await allowed(pm,'%председател%правительств%'),false,'Archived student denied');
  await db.query('UPDATE game_members SET roster_archived_at=NULL WHERE user_id=$1',[pm]);
  await db.query("UPDATE game_office_assignments SET status='ended' WHERE user_id=$1",[pm]);
  assert.equal(await allowed(pm,'%председател%правительств%'),false,'Ended appointment denied');
  console.log('PASS: all cross-stage role contracts and co-appointed, suspended, archived, expired, wrong-actor checks');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
