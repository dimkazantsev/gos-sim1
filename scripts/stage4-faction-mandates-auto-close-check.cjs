/* Isolated regression: faction mandate packages close only once after complete
   eligible registered faction participation and 226-mandate quorum. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync('supabase/migrations/20261018022000_stage4_faction_office_ballot_auto_finish.sql','utf8');
assert(source.includes('eligible_parties<>complete_parties'),'All registered mandate-holding factions required');
assert(source.includes('present_mandates<226 or submitted_mandates<226'),'Statutory quorum required');
assert(source.includes('private.finish_office_election_locked(e.id)'),'Existing finalizer is reused');
assert(source.includes("gp.registration_status='registered'"),'Only registered factions qualify');
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 const game=uuid(1),lowGame=uuid(2),game40=uuid(3);
 const actor=async id=>db.query('update current_actor set user_id=$1',[id]);
 try {
  await db.exec([
   'create schema auth; create schema private; create role authenticated;create role anon;',
   'create table current_actor(user_id uuid); insert into current_actor values(null);',
   'create function auth.uid() returns uuid language sql stable as $uid$select user_id from current_actor$uid$;',
   'create table game_parties(id uuid primary key,game_id uuid,name text,leader_user_id uuid,registration_status text);',
   'create table game_members(game_id uuid,user_id uuid,team text,kind text,roster_archived_at timestamptz);',
   'create table party_member_mandates(game_id uuid,party_id uuid,effective_mandates integer);',
   'create table institution_session_registrations(game_id uuid,user_id uuid,stage_no integer,institution_key text);',
   'create table office_elections(id uuid primary key,game_id uuid,stage_no integer,ballot_mode text,status text);',
   'create table office_candidates(id uuid primary key,election_id uuid);',
   'create table office_ballots(id uuid primary key default gen_random_uuid(),election_id uuid,game_id uuid,party_id uuid,candidate_id uuid,votes integer,submitted_by uuid,updated_at timestamptz,unique(election_id,party_id,candidate_id));',
   'create table finalized(election_id uuid);',
   'create function private.finish_office_election_locked(p_election_id uuid) returns jsonb language plpgsql as $f$begin update office_elections set status=\\'finished\\' where id=p_election_id and status=\\'open\\';if found then insert into finalized values(p_election_id);end if;return jsonb_build_object(\\'status\\',\\'finished\\');end$f$;',
   'create function private.party_led_by(p_game uuid,p_user uuid) returns uuid language sql stable as $p$select id from game_parties where game_id=p_game and leader_user_id=p_user limit 1$p$;',
   'create function private.require_game_meeting_registration(p_game uuid,p_user uuid,p_stage integer,p_body text) returns void language plpgsql as $p$begin if not exists(select 1 from institution_session_registrations where game_id=p_game and user_id=p_user and stage_no=p_stage and institution_key=p_body) then raise exception \\'Регистрация обязательна\\';end if;end$p$;'
  ].join('\n'));
  await db.exec(source);
  const addParty=async(g,n,mandates,registered=true)=>{
   const pid=uuid(n),user=uuid(n+10000),name='Фракция '+n;
   await db.query('insert into game_parties values($1,$2,$3,$4,$5)',[pid,g,name,user,'registered']);
   await db.query("insert into game_members values($1,$2,$3,'student',null)",[g,user,name]);
   await db.query('insert into party_member_mandates values($1,$2,$3)',[g,pid,mandates]);
   if(registered)await db.query("insert into institution_session_registrations values($1,$2,4,'gd')",[g,user]);
   return {pid,user};
  };
  const addElection=async(g,n)=>{
   const election=uuid(n),c1=uuid(n+1000),c2=uuid(n+1001);
   await db.query("insert into office_elections values($1,$2,4,'faction','open')",[election,g]);
   await db.query('insert into office_candidates values($1,$2),($3,$2)',[c1,election,c2]);
   return {election,c1,c2};
  };
  const vote=async(user,election,cid,mandates)=>{await actor(user);await db.query('select public.set_office_ballot($1,$2,$3)',[election,cid,mandates])};
  const status=async(eid)=>(await db.query('select status from office_elections where id=$1',[eid])).rows[0].status;
  const {pid:p1,user:u1}=await addParty(game,200,225);
  const {user:u2}=await addParty(game,201,225);
  const v1=await addElection(game,300);
  const v2=await addElection(game,310);
  await vote(u1,v1.election,v1.c1,100);
  await vote(u2,v1.election,v1.c2,225);
  assert.equal(await status(v1.election),'open','Partial package must not close voting');
  await vote(u1,v1.election,v1.c2,125);
  assert.equal(await status(v1.election),'finished','All registered leaders exhaust package, quorum met');
  assert.equal(await status(v2.election),'open','Independent ballot stays open');
  await assert.rejects(()=>vote(u1,v1.election,v1.c1,99),/not open/i,'Late votes rejected');
  assert.equal((await db.query('select count(*)::int n from finalized where election_id=$1',[v1.election])).rows[0].n,1,'Exactly-once finalization');
  const uNot=await addParty(lowGame,210,200,false);
  const vLow=await addElection(lowGame,320);
  await assert.rejects(()=>vote(uNot.user,vLow.election,vLow.c1,200),/Регистрация/,'Unregistered leader rejected');
  await db.query("insert into institution_session_registrations values($1,$2,4,'gd')",[lowGame,uNot.user]);
  await vote(uNot.user,vLow.election,vLow.c1,200);
  assert.equal(await status(vLow.election),'open','200 mandates do not establish quorum');
  const players=[];
  for(let i=0;i<40;i++)players.push(await addParty(game40,500+i,i<10?12:11));
  const vMany=await addElection(game40,900);
  for(let i=0;i<39;i++)await vote(players[i].user,vMany.election,vMany.c1,i<10?12:11);
  assert.equal(await status(vMany.election),'open','39 of 40 registered mandate leaders never finalize');
  await vote(players[39].user,vMany.election,vMany.c2,11);
  assert.equal(await status(vMany.election),'finished','40th leader auto-finalizes after 450 mandates');
  console.log('PASS stage 4 mandate-package office voting: two factions, partial allocations, quorum, missing registration, independent elections, exactly-once, 40 faction leaders.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
