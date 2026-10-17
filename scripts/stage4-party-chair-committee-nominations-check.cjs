/* Stage 4: committee nominations by registered party chairs.
 * Isolated PGlite database. Never writes to production.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261017235500_stage4_party_chair_committee_nominations.sql','utf8');
const ui=fs.readFileSync('components/game/CommitteeChairElectionPanel.tsx','utf8');
assert(ui.includes("p.leader_user_id===me?.user_id&&p.registration_status==='registered'"),'UI only recognizes chairs of registered parties');
assert(ui.includes('Председатели зарегистрированных партий выдвигают кандидатов'),'The interface explains who can nominate');
assert(sql.includes("e.office_key like 'committee:%'"),'The special permission applies only to committee elections');
assert(sql.includes('private.gd_stage4_meeting_active(e.game_id)'),'Closed stage/agenda guard remains');
assert(sql.includes('private.gd_member_capacity(e.game_id,p_user_id)<=0'),'Candidate mandates remain required');
assert(sql.includes("if e.status<>'nomination'"),'No nominations after the nomination window closes');
assert(sql.includes('private.require_game_meeting_registration(e.game_id,v_uid,e.stage_no'),'Existing registration requirements for other elections remain');

const GAME='10000000-0000-0000-0000-000000000001';
const OTHER_GAME='10000000-0000-0000-0000-000000000002';
const PARTY='20000000-0000-0000-0000-000000000001';
const OTHER_PARTY='20000000-0000-0000-0000-000000000002';
const OTHER_GAME_PARTY='20000000-0000-0000-0000-000000000003';
const LEADER='30000000-0000-0000-0000-000000000001';
const MEMBER='30000000-0000-0000-0000-000000000002';
const RIVAL_LEADER='30000000-0000-0000-0000-000000000003';
const NOMINEE='30000000-0000-0000-0000-000000000004';
const RIVAL='30000000-0000-0000-0000-000000000005';
const NO_SEATS='30000000-0000-0000-0000-000000000006';
const TEACHER='30000000-0000-0000-0000-000000000007';
const COMMITTEE='40000000-0000-0000-0000-000000000001';
const DUMA='40000000-0000-0000-0000-000000000002';
const FOREIGN='40000000-0000-0000-0000-000000000003';

(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'create schema auth;',
   'create schema private;',
   'create table test_context(id int primary key, actor uuid, active boolean, teacher boolean);',
   "insert into test_context values(1,'"+LEADER+"',true,false);",
   'create function auth.uid() returns uuid language sql stable as $$select actor from test_context where id=1$$;',
   'create table game_parties(id uuid primary key,game_id uuid,name text,leader_user_id uuid,registration_status text);',
   'create table game_members(game_id uuid,user_id uuid,team text,kind text,roster_archived_at timestamptz);',
   'create table office_elections(id uuid primary key,game_id uuid,stage_no integer,office_key text,status text);',
   'create table office_candidates(id uuid primary key default gen_random_uuid(),election_id uuid,game_id uuid,user_id uuid,party_id uuid,nominated_by uuid,unique(election_id,user_id));',
   'create table seat_counts(game_id uuid,user_id uuid,seats int);',
   'create table meeting_registrations(game_id uuid,user_id uuid,stage_no int,institution_key text);',
   "create function private.is_game_teacher(uuid) returns boolean language sql stable as $$select teacher from test_context where id=1$$;",
   "create function private.gd_stage4_meeting_active(uuid) returns boolean language sql stable as $$select active from test_context where id=1$$;",
   "create function private.party_led_by(p_game uuid,p_user uuid) returns uuid language sql stable as $select id from game_parties where game_id=p_game and leader_user_id=p_user limit 1$;",
   "create function private.gd_stage4_deputy_can_propose(uuid,uuid) returns boolean language sql stable as $select false$;",
   "create function private.gd_member_capacity(p_game uuid,p_user uuid) returns integer language sql stable as $$select coalesce((select seats from seat_counts where game_id=p_game and user_id=p_user),0)$$;",
   "create function private.require_game_meeting_registration(p_game uuid,p_user uuid,p_stage integer,p_institution text) returns void language plpgsql as $$begin if not exists(select 1 from meeting_registrations where game_id=p_game and user_id=p_user and stage_no=p_stage and institution_key=p_institution) then raise exception 'No meeting registration';end if;end$$;",
   "insert into game_parties values('"+PARTY+"','"+GAME+"','Партия А','"+LEADER+"','registered'),"+
    "('"+OTHER_PARTY+"','"+GAME+"','Партия Б','"+RIVAL_LEADER+"','registered'),"+
    "('"+OTHER_GAME_PARTY+"','"+OTHER_GAME+"','Партия В','"+RIVAL_LEADER+"','registered');",
   "insert into game_members values"+
    "('"+GAME+"','"+LEADER+"','Партия А','student',null),"+
    "('"+GAME+"','"+MEMBER+"','Партия А','student',null),"+
    "('"+GAME+"','"+RIVAL_LEADER+"','Партия Б','student',null),"+
    "('"+GAME+"','"+NOMINEE+"','Партия А','student',null),"+
    "('"+GAME+"','"+RIVAL+"','Партия Б','student',null),"+
    "('"+GAME+"','"+NO_SEATS+"','Партия А','student',null);",
   "insert into seat_counts values('"+GAME+"','"+NOMINEE+"',225),('"+GAME+"','"+RIVAL+"',225);",
   "insert into office_elections values('"+COMMITTEE+"','"+GAME+"',4,'committee:aaaaaaaa-0000-0000-0000-000000000001','nomination'),"+
    "('"+DUMA+"','"+GAME+"',4,'gd_chair','nomination'),"+
    "('"+FOREIGN+"','"+OTHER_GAME+"',4,'committee:aaaaaaaa-0000-0000-0000-000000000002','nomination');"
  ].join('\n'));
  await db.exec(sql);
  async function actor(id,active=true,teacher=false){
   await db.query('update test_context set actor=$1,active=$2,teacher=$3 where id=1',[id,active,teacher]);
  }
  async function nominate(election,candidate){
   return (await db.query('select public.nominate_office_candidate($1,$2) as id',[election,candidate])).rows[0].id;
  }
  async function denied(election,candidate,label){
   let rejected=false;
   try{await nominate(election,candidate)}catch(e){rejected=true}
   assert(rejected,label);
  }
  const id=await nominate(COMMITTEE,NOMINEE);
  assert(id,'Registered party chair may nominate their deputy without GD registration');
  assert.equal(await nominate(COMMITTEE,NOMINEE),id,'Repeat nomination is idempotent');
  await actor(MEMBER);
  await denied(COMMITTEE,NOMINEE,'Non-chair party member cannot propose');
  await actor(LEADER);
  await denied(COMMITTEE,RIVAL,'Chair cannot nominate candidate of another faction');
  await denied(COMMITTEE,NO_SEATS,'Chair cannot nominate a candidate with no mandates');
  await denied(FOREIGN,NOMINEE,'Chair from another game has no rights');
  await actor(RIVAL_LEADER);
  await db.query("update game_parties set registration_status='pending' where id=$1",[OTHER_PARTY]);
  await denied(COMMITTEE,RIVAL,'Chair of unregistered party cannot propose');
  await db.query("update game_parties set registration_status='registered' where id=$1",[OTHER_PARTY]);
  await db.query('update game_members set roster_archived_at=now() where game_id=$1 and user_id=$2',[GAME,RIVAL_LEADER]);
  await denied(COMMITTEE,RIVAL,'Archived chair cannot propose');
  await actor(LEADER,false);
  await denied(COMMITTEE,NO_SEATS,'Closed stage/agenda blocks nomination');
  await actor(LEADER,true);
  await denied(DUMA,NOMINEE,'Other GD elections still require personal registration');
  await db.query('insert into meeting_registrations values($1,$2,4,$3)',[GAME,LEADER,'gd']);
  const otherId=await nominate(DUMA,NOMINEE);
  assert(otherId,'Registered chair may also nominate in GD leadership election');
  await actor(TEACHER,true,true);
  const teacherId=await nominate(COMMITTEE,RIVAL);
  assert(teacherId,'Teacher retains existing exception for nomination from any faction');
  await db.query("update office_elections set status='open' where id=$1",[COMMITTEE]);
  await denied(COMMITTEE,NOMINEE,'An open ballot is no longer in nomination phase');
  console.log('PASS stage 4 committee nominations: party chair without GD registration, own party/mandates, registration status, archived accounts, stage gate, cross-game isolation, election phase, idempotency, unrelated GD registration and teacher rights.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
