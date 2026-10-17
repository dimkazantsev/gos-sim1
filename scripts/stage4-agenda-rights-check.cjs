/* Isolated stage-four authority regression; never writes to production. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261017230000_stage4_party_chair_agenda_bridge.sql','utf8');
const ui=fs.readFileSync('components/game/InstitutionRegistrationPanel.tsx','utf8');
const stage=fs.readFileSync('components/game/GovernanceStageWorkspace.tsx','utf8');
const election=fs.readFileSync('components/game/DumaLeadershipElection.tsx','utf8');
assert(stage.includes('<InstitutionRegistrationPanel'),'Keep top stage registration');
assert(!election.includes('<InstitutionRegistrationPanel'),'No duplicate in Duma election');
assert(ui.includes("'office_elections'")&&ui.includes('rightsVersion'),'Re-fetch permissions on leadership changes');
for(const name of ['get_my_institution_meeting_permissions','save_institution_meeting_document','approve_institution_meeting_agenda','assign_institution_meeting_secretary','approve_institution_meeting_minutes']){
 const start=migration.indexOf('FUNCTION public.'+name+'(');
 assert(start>=0,'Missing RPC '+name);
 const next=migration.indexOf('CREATE OR REPLACE FUNCTION public.',start+1);
 const body=migration.slice(start,next<0?undefined:next);
 assert(body.includes('private.can_coordinate_stage_meeting(p_game_id,p_stage_no,p_institution,'),
  'One authority function must guard both reading and writing: '+name);
}
(async()=>{
 const db=new PGlite();
 const game='00000000-0000-0000-0000-000000000100';
 const teacher='00000000-0000-0000-0000-000000000101';
 const leader='00000000-0000-0000-0000-000000000102';
 const chair='00000000-0000-0000-0000-000000000103';
 const council='00000000-0000-0000-0000-000000000104';
 const outsider='00000000-0000-0000-0000-000000000105';
 const otherLeader='00000000-0000-0000-0000-000000000106';
 const electionId='00000000-0000-0000-0000-000000000107';
 const candidateId='00000000-0000-0000-0000-000000000108';
 try{
  await db.exec("create role anon; create role authenticated; create schema private; create schema auth;"+
   "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
   "create table game_stages(game_id uuid,stage_no integer,status text);"+
   "create table game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz,role_title text);"+
   "create table game_parties(game_id uuid,leader_user_id uuid,registration_status text);"+
   "create table office_elections(id uuid,game_id uuid,stage_no integer,office_key text,status text,winner_candidate_id uuid);"+
   "create table office_candidates(id uuid,election_id uuid,game_id uuid,user_id uuid);"+
   "create table game_office_assignments(game_id uuid,user_id uuid,status text,role_title text);"+
   "create function private.is_game_teacher(uuid) returns boolean language sql stable as $$select auth.uid()='00000000-0000-0000-0000-000000000101'::uuid$$;"+
   "create function private.role_is_available(uuid,uuid) returns boolean language sql stable as $$select true$$;"+
   "create function private.can_coordinate_institution_meeting(uuid,text,uuid) returns boolean language sql stable as $$select false$$;"+
   "create function private.can_manage_duma_session(p_game uuid,p_uid uuid) returns boolean language sql stable as $$select exists(select 1 from game_office_assignments a where a.game_id=p_game and a.user_id=p_uid and a.status='active' and lower(a.role_title) like '%совет%дум%')$$;");
  await db.query("insert into game_stages values($1,4,'open'),($1,12,'open')",[game]);
  for(const id of [leader,chair,council,outsider,otherLeader])
   await db.query("insert into game_members(game_id,user_id,kind) values($1,$2,'student')",[game,id]);
  for(const id of [leader,otherLeader])
   await db.query("insert into game_parties values($1,$2,'registered')",[game,id]);
  await db.exec(migration.slice(0,migration.indexOf('CREATE OR REPLACE FUNCTION public.get_my_institution_meeting_permissions')));
  const can=async(uid,step=4,body='gd')=>{
   const r=await db.query("select private.can_coordinate_stage_meeting($1,$2,$3,$4) as allowed",[game,step,body,uid]);
   return r.rows[0].allowed;
  };
  assert(await can(leader)&&await can(otherLeader),'Both party chairs can prepare the initial agenda');
  assert(!await can(outsider),'Ordinary student may not approve');
  assert(!await can(leader,12)&&!await can(leader,4,'ksrf'),'Only GD stage 4 gets temporary rights');
  await db.query("insert into office_elections values($1,$2,4,'gd_chair','finished',$3)",[electionId,game,candidateId]);
  await db.query("insert into office_candidates values($1,$2,$3,$4)",[candidateId,electionId,game,chair]);
  assert(await can(chair)&&await can(leader),'Elected chair acts immediately, parties remain until Council exists');
  await db.query("insert into game_office_assignments values($1,$2,'active','Член Совета Государственной Думы')",[game,council]);
  assert(await can(chair)&&await can(council),'Chair and Council have full coordination');
  assert(!await can(leader)&&!await can(otherLeader),'Party privilege expires after leadership transfer');
  await db.exec("update game_stages set status='completed' where stage_no=4");
  assert(!await can(chair),'Completed stage blocks non-teacher edits');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[teacher]);
  assert(await can(teacher),'Teacher retains coordinator authority');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec("update game_stages set status='open' where stage_no=4");
  assert((await Promise.all(Array.from({length:40},()=>can(chair)))).every(Boolean),
   '40 simultaneous permission reads remain consistent');
  console.log('PASS stage 4: single registration, party chair interim rights, Duma handoff, 40 permission reads.');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
