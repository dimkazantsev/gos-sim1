const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261017190000_gd_reported_attendance_and_capacity.sql','utf8');
const panel=fs.readFileSync('components/game/InstitutionRegistrationPanel.tsx','utf8');
const votes=fs.readFileSync('components/game/VotesView.tsx','utf8');
const game=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const duma=fs.readFileSync('components/game/DumaLeadershipElection.tsx','utf8');
const committee=fs.readFileSync('components/game/CommitteeChairElectionPanel.tsx','utf8');
const css=fs.readFileSync('app/meeting-agenda-canonical.css','utf8');
for(const rpc of ['get_gd_session_attendance','set_gd_session_attendance'])assert(panel.includes("'"+rpc+"'"));
assert(votes.includes('present_mandates')&&votes.includes('gdPresentWeight(v)'),'Vote UI caps weight to declared presence');
assert(game.includes("gdMandateCapacity")&&game.includes('present_mandates'),'Quorum and ballot share the capacity');
assert(duma.includes('myPresent')&&committee.includes('myPresent'),'Leadership and committee elections use reported presence');
assert(!css.includes('!important'),'Canonical agenda has no forced layout overrides');
for(const section of ['civicMeetingDocuments','civicMeetingSteps','civicAttendanceNumbers','civicGdPresenceForm'])
 assert(css.includes('.'+section),'Canonical style missing '+section);
(async()=>{
 const db=new PGlite();
 const gameId='10000000-0000-0000-0000-000000000001';
 const ids=Array.from({length:40},(_,i)=>'20000000-0000-0000-0000-'+String(i+1).padStart(12,'0'));
 const setUser=async id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
 const cap=async id=ids[0]=>(await db.query('select private.gd_member_capacity($1,$2) value',[gameId,id])).rows[0].value;
 const report=async()=>(await db.query('select public.get_gd_session_attendance($1,4) value',[gameId])).rows[0].value;
 const save=async value=>(await db.query('select public.set_gd_session_attendance($1,4,$2)',[gameId,value]));
 try{
  await db.exec("create role anon;create role authenticated;create schema private;create schema auth;"+
   "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
   "create table game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz,joined_at timestamptz);"+
   "create table game_stages(game_id uuid,stage_no integer,status text);"+
   "create table party_member_mandates(game_id uuid,party_id uuid,user_id uuid,base_mandates integer,effective_mandates integer);"+
   "create table institution_session_registrations(game_id uuid,stage_no integer,institution_key text,user_id uuid,registered_at timestamptz default now(), primary key(game_id,stage_no,institution_key,user_id));"+
   "create table formal_documents(id uuid,game_id uuid,status_code text);"+
   "create table institution_meeting_records(game_id uuid,stage_no integer,institution_key text,agenda_document_id uuid,agenda_approved_at timestamptz,agenda_body text);"+
   "create function private.is_game_member(p_game uuid) returns boolean language sql stable as $$select exists(select 1 from game_members where game_id=p_game and user_id=auth.uid())$$;"+
   "create function private.vote_member_has_office(p_game uuid,p_user uuid,p_body text) returns boolean language sql stable as $$select exists(select 1 from game_members where game_id=p_game and user_id=p_user and kind='student' and roster_archived_at is null) and p_body='gd'$$;"+
   "create function public.register_institution_session_at_stage(p_game uuid,p_body text,p_stage integer) returns void language plpgsql as $$begin insert into institution_session_registrations(game_id,stage_no,institution_key,user_id) values(p_game,p_stage,p_body,auth.uid()) on conflict do nothing;end$$;");
  await db.query("insert into game_stages values($1,4,'open')",[gameId]);
  const agendaId='40000000-0000-0000-0000-000000000001';
  await db.query("insert into formal_documents values($1,$2,'published')",[agendaId,gameId]);
  await db.query("insert into institution_meeting_records values($1,4,'gd',$2,now(),$3)",[gameId,agendaId,'Регламент заседания Государственной Думы утверждён и опубликован в реестре НПА.']);
  for(const [i,id] of ids.entries())if(i<2)await db.query("insert into game_members values($1,$2,'student',null,$3)",[gameId,id,new Date(Date.UTC(2026,0,1,i)).toISOString()]);
  const core=sql.slice(0,sql.indexOf('CREATE OR REPLACE FUNCTION private.vote_member_has_office'));
  assert(core.includes("CREATE OR REPLACE FUNCTION public.set_gd_session_attendance"));
  await db.exec(core);
  assert.equal(await cap(ids[0]),225);
  assert.equal(await cap(ids[1]),225);
  await setUser(ids[0]);
  await assert.rejects(()=>save(226),/от 0 до 225/);
  await save(180);
  let rows=await report();
  assert.equal(rows.registered.length,1);
  assert.equal(rows.registered[0].present,180);
  await setUser(ids[1]);await save(45);
  rows=await report();
  assert.equal(rows.registered.reduce((a,r)=>a+r.present,0),225,'Not yet quorum');
  await save(46);
  rows=await report();
  assert.equal(rows.registered.reduce((a,r)=>a+r.present,0),226,'Quorum only with reported deputies');
  await setUser(ids[0]);await save(120);
  rows=await report();assert.equal(rows.registered.reduce((a,r)=>a+r.present,0),166,'Re-registration updates without duplicate');
  let count=(await db.query('select count(*)::int c from institution_session_registrations where game_id=$1',[gameId])).rows[0].c;
  assert.equal(count,2);
  await db.query('insert into game_members values($1,$2,$3,null,now())',[gameId,ids[2],'student']);
  assert.equal(await cap(ids[0]),150);
  assert.equal(await cap(ids[1]),150);
  assert.equal(await cap(ids[2]),150);
  rows=await report();
  assert.equal(rows.registered.find(r=>r.user_id===ids[0]).present,120);
  await db.query('insert into party_member_mandates values($1,$2,$3,225,180)',[gameId,'30000000-0000-0000-0000-000000000001',ids[0]]);
  await db.query('insert into party_member_mandates values($1,$2,$3,225,225)',[gameId,'30000000-0000-0000-0000-000000000002',ids[1]]);
  assert.equal(await cap(ids[0]),180,'GV penalty reduces permitted seats');
  assert.equal(await cap(ids[1]),225);
  assert.equal(await cap(ids[2]),0,'No fallback once party seats have been assigned');
  await setUser(ids[0]);await assert.rejects(()=>save(181),/от 0 до 180/);
  await save(180);
  await setUser(ids[2]);await assert.rejects(()=>save(1),/от 0 до 0/);
  await db.query('delete from party_member_mandates where game_id=$1',[gameId]);
  for(let i=3;i<40;i++)await db.query("insert into game_members values($1,$2,'student',null,$3)",[gameId,ids[i],new Date(Date.UTC(2026,0,1,i)).toISOString()]);
  const weights=await Promise.all(ids.map(cap));
  assert.equal(weights.reduce((a,b)=>a+b,0),450,'40 players must control 450 seats exactly');
  assert.equal(weights.filter(x=>x===12).length,10);
  assert.equal(weights.filter(x=>x===11).length,30);
  await setUser('99999999-0000-0000-0000-000000000001');
  await assert.rejects(()=>save(1),/Нет доступа/);
  console.log('PASS GD: 2 × 225; 3 × 150; 40 players 450; factual 180+46 quorum; saved updates; GV penalties; forged claim and foreign account denied.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
