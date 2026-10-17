/* Isolated PostgreSQL test for auto-completion of personal office elections.
 * No production reads/writes and no authenticated session secrets.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261018012000_stage4_auto_close_personal_office_elections.sql','utf8');
assert(migration.includes("cast_count<>eligible_count"),'Every eligible registered voter must cast');
assert(migration.includes('quorum_mandates<226 or cast_mandates<226'),'Registered and cast mandate quorum required');
assert(migration.includes("e.stage_no<>4 or e.ballot_mode<>'personal'"),'Do not affect unrelated office elections');
assert(migration.includes('FOR UPDATE')||migration.includes('for update'),'Automatic completion must be serialized');

const uuid=n=>'00000000-0000-0000-0000-'+n.toString(16).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'create schema auth;',
   'create schema private;',
   'create role anon;',
   'create role authenticated;',
   'create table mock_auth(actor uuid,teacher boolean);',
   'insert into mock_auth values(null,false);',
   'create table game_members(game_id uuid,user_id uuid,team text,kind text,roster_archived_at timestamptz);',
   'create table game_parties(id uuid,game_id uuid,name text);',
   'create table seat_counts(game_id uuid,user_id uuid,seats integer);',
   'create table institution_session_registrations(game_id uuid,stage_no integer,institution_key text,user_id uuid,present_mandates integer);',
   "create table office_elections(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no integer,office_key text,office_title text,round_no integer,vote_mode text,status text,parent_election_id uuid,winner_candidate_id uuid,created_by uuid,opened_at timestamptz,closed_at timestamptz,created_at timestamptz default now(),ballot_mode text);",
   'create table office_candidates(id uuid primary key default gen_random_uuid(),election_id uuid,game_id uuid,user_id uuid,party_id uuid,nominated_by uuid,created_at timestamptz default now());',
   'create table office_ballots(election_id uuid,candidate_id uuid,votes int);',
   'create table office_personal_ballots(election_id uuid,game_id uuid,voter_id uuid,party_id uuid,candidate_id uuid,created_at timestamptz default now(),updated_at timestamptz default now(),unique(election_id,voter_id));',
   'create function auth.uid() returns uuid language sql stable as $auth$select actor from mock_auth$auth$;',
   'create function private.is_game_teacher(uuid) returns boolean language sql stable as $teacher$select teacher from mock_auth$teacher$;',
   'create function private.gd_stage4_can_manage(uuid,uuid,text) returns boolean language sql stable as $teacher$select teacher from mock_auth$teacher$;',
   'create function private.role_is_available(uuid,uuid) returns boolean language sql stable as $teacher$select true$teacher$;',
   'create function private.gd_member_capacity(p_game uuid,p_user uuid) returns integer language sql stable as $seats$select coalesce((select seats from seat_counts where game_id=p_game and user_id=p_user),0)$seats$;',
   'create function private.gd_effective_present(p_game uuid,p_user uuid,p_declared integer) returns integer language sql stable as $seats$select greatest(0,least(private.gd_member_capacity(p_game,p_user),coalesce(p_declared,private.gd_member_capacity(p_game,p_user))))$seats$;',
   'create function private.vote_member_has_office(p_game uuid,p_user uuid,p_institution text) returns boolean language sql stable as $seats$select private.gd_member_capacity(p_game,p_user)>0$seats$;',
   "create function private.require_game_meeting_registration(p_game uuid,p_user uuid,p_stage integer,p_institution text) returns void language plpgsql as $require$begin if not exists(select 1 from institution_session_registrations r where r.game_id=p_game and r.user_id=p_user and r.stage_no=p_stage and r.institution_key=p_institution) then raise exception 'Not registered';end if;end$require$;",
   "create function private.office_candidate_vote_weight(p_election uuid,p_candidate uuid) returns integer language sql stable as $weight$select coalesce(sum(private.gd_effective_present(b.game_id,b.voter_id,r.present_mandates)),0)::int from office_personal_ballots b join institution_session_registrations r on r.game_id=b.game_id and r.user_id=b.voter_id and r.stage_no=4 and r.institution_key='gd' where b.election_id=p_election and b.candidate_id=p_candidate$weight$;"
  ].join('\n'));
  await db.exec(migration);
  async function actor(id,teacher=false){await db.query('update mock_auth set actor=$1,teacher=$2',[id,teacher]);}
  async function voter(game,number,seat,team='Фракция',register=true){
   const user=uuid(number);
   await db.query("insert into game_members values($1,$2,$3,'student',null)",[game,user,team]);
   await db.query("insert into seat_counts values($1,$2,$3)",[game,user,seat]);
   if(register)await db.query("insert into institution_session_registrations values($1,4,'gd',$2,$3)",[game,user,seat]);
   return user;
  }
  async function party(game,number,team='Фракция'){
   const partyId=uuid(number);
   await db.query('insert into game_parties values($1,$2,$3)',[partyId,game,team]);
   return partyId;
  }
  async function election(game,number,partyId,voters,nomineeCount=2,officeKey='committee:example'){
   const id=uuid(number),owner=voters[0];
   await db.query("insert into office_elections(id,game_id,stage_no,office_key,office_title,round_no,vote_mode,status,created_by,ballot_mode) values($1,$2,4,$3,'Председатель комитета',1,'open','open',$4,'personal')",[id,game,officeKey,owner]);
   const candidates=[];
   for(let i=0;i<nomineeCount;i++){
    const candidate=uuid(number+100+i);
    candidates.push(candidate);
    await db.query('insert into office_candidates(id,election_id,game_id,user_id,party_id,nominated_by) values($1,$2,$3,$4,$5,$6)',[candidate,id,game,voters[i%voters.length],partyId,owner]);
   }
   return {id,candidates};
  }
  async function status(eid){return (await db.query('select status,winner_candidate_id from office_elections where id=$1',[eid])).rows[0];}
  async function cast(user,eid,candidate){await actor(user);await db.query('select public.cast_personal_office_ballot($1,$2)',[eid,candidate]);}
  async function mustFail(fn,label){let failed=false;try{await fn()}catch(e){failed=true}assert(failed,label);}

  const gameA=uuid(1),pA=await party(gameA,200);
  const a=await voter(gameA,10,225),b=await voter(gameA,11,225);
  const voteA=await election(gameA,300,pA,[a,b]);
  const voteA2=await election(gameA,301,pA,[a,b],1,'committee:other');
  await cast(a,voteA.id,voteA.candidates[0]);
  assert.equal((await status(voteA.id)).status,'open','One of two registered voters cannot close voting');
  await cast(a,voteA.id,voteA.candidates[0]);
  assert.equal((await db.query('select count(*)::int c from office_personal_ballots where election_id=$1',[voteA.id])).rows[0].c,1,'Same voter has one ballot only');
  await mustFail(()=>cast(a,voteA.id,uuid(9999)),'Candidate from another vote cannot be submitted');
  await cast(b,voteA.id,voteA.candidates[0]);
  assert.equal((await status(voteA.id)).status,'finished','The last eligible vote closes and declares winner');
  assert.equal((await status(voteA.id)).winner_candidate_id,voteA.candidates[0]);
  assert.equal((await status(voteA2.id)).status,'open','Another election remains open until its own voters cast');
  await mustFail(()=>cast(a,voteA.id,voteA.candidates[1]),'No late votes after automatic closure');
  await cast(a,voteA2.id,voteA2.candidates[0]);
  assert.equal((await status(voteA2.id)).status,'open');
  await cast(b,voteA2.id,voteA2.candidates[0]);
  assert.equal((await status(voteA2.id)).status,'finished');

  const gameLow=uuid(2),pLow=await party(gameLow,201);
  const low=await voter(gameLow,12,200);
  const lowVote=await election(gameLow,302,pLow,[low],1);
  await cast(low,lowVote.id,lowVote.candidates[0]);
  assert.equal((await status(lowVote.id)).status,'open','Everyone voted but quorum 200 is insufficient');
  const late=await voter(gameLow,13,200);
  await cast(late,lowVote.id,lowVote.candidates[0]);
  assert.equal((await status(lowVote.id)).status,'finished','Eligible late registered voter with quorum completes election');

  const gameRunoff=uuid(3),pRunoff=await party(gameRunoff,202);
  const ra=await voter(gameRunoff,14,225),rb=await voter(gameRunoff,15,225);
  const runoff=await election(gameRunoff,303,pRunoff,[ra,rb],3);
  await cast(ra,runoff.id,runoff.candidates[0]);
  assert.equal((await status(runoff.id)).status,'open');
  await cast(rb,runoff.id,runoff.candidates[1]);
  assert.equal((await status(runoff.id)).status,'closed','Tie after all eligible ballots closes first round');
  const runoffs=(await db.query('select id,status from office_elections where parent_election_id=$1',[runoff.id])).rows;
  assert.equal(runoffs.length,1,'Exactly one second round created');
  assert.equal(runoffs[0].status,'open','Second round opens with unchanged rules');
  assert.equal((await db.query('select count(*)::int c from office_candidates where election_id=$1',[runoffs[0].id])).rows[0].c,2);

  const game40=uuid(4),p40=await party(game40,203);
  const players=[];
  for(let i=0;i<40;i++)players.push(await voter(game40,100+i,i<10?12:11));
  const many=await election(game40,304,p40,players,1);
  for(let i=0;i<39;i++)await cast(players[i],many.id,many.candidates[0]);
  assert.equal((await status(many.id)).status,'open','39 of 40 participants do not close vote prematurely');
  await cast(players[39],many.id,many.candidates[0]);
  assert.equal((await status(many.id)).status,'finished','40th registered voter automatically closes election');
  const votes=await db.query('select count(*)::int c from office_personal_ballots where election_id=$1',[many.id]);
  assert.equal(votes.rows[0].c,40,'40 ballots persisted without loss');

  const gameUnregistered=uuid(5),pOther=await party(gameUnregistered,204);
  const notRegistered=await voter(gameUnregistered,200,450,'Фракция',false);
  const unregisteredElection=await election(gameUnregistered,305,pOther,[notRegistered],1);
  await mustFail(()=>cast(notRegistered,unregisteredElection.id,unregisteredElection.candidates[0]),'Unregistered voter cannot vote');
  assert.equal((await status(unregisteredElection.id)).status,'open','No quorum from unregistered voters');
  await actor(uuid(400),true);
  await db.query('select public.close_office_election($1)',[unregisteredElection.id]);
  assert.equal((await status(unregisteredElection.id)).status,'closed','Existing teacher manual emergency close still works');
  console.log('PASS automatic stage4 personal office close: quorum, all registered deputies, duplicate ballots, late registration, 40 voters, tie/runoff, separate elections, invalid user/candidate, teacher manual close.');
 }finally{await db.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
