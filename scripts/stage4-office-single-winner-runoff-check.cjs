/* Stage 4: duplicate-result prevention and second-round notifications.
 * Executes actual migration SQL in isolated PGlite, not production.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const guard=fs.readFileSync('supabase/migrations/20261018024500_single_winner_office_guards.sql','utf8');
const notice=fs.readFileSync('supabase/migrations/20261018024600_office_runoff_system_notice.sql','utf8');
const ui=fs.readFileSync('components/game/DumaLeadershipElection.tsx','utf8');
const committees=fs.readFileSync('components/game/CommitteeChairElectionPanel.tsx','utf8');
for(const fragment of ['private.office_has_confirmed_winner','Должность уже занята','повторное выдвижение невозможно','повторный результат запрещён'])
 assert(guard.includes(fragment),'Missing DB closure guard: '+fragment);
assert(ui.includes('availableOffices.length===0')&&ui.includes('pendingSecondRounds.length'),'Leader: disabled repeat procedure and active second-round counter');
assert(committees.includes('!e&&!hasChair&&canCreate')&&committees.includes('unfinishedSecondRounds.length'),'Committee: duplicate elections hidden and runoff counter visible');
const uuid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'create schema auth; create schema private; create role anon;create role authenticated;',
   "create function auth.uid() returns uuid language sql stable as $uid$select '20000000-0000-0000-0000-000000000001'::uuid$uid$;",
   'create function private.gd_stage4_can_manage(uuid,uuid,text) returns boolean language sql stable as $ok$select true$ok$;',
   'create function private.is_game_teacher(uuid) returns boolean language sql stable as $ok$select true$ok$;',
   'create function private.gd_stage4_meeting_active(uuid) returns boolean language sql stable as $ok$select true$ok$;',
   'create function private.require_game_meeting_registration(uuid,uuid,integer,text) returns void language plpgsql as $ok$begin return;end$ok$;',
   'create function private.party_led_by(uuid,uuid) returns uuid language sql stable as $ok$select null::uuid$ok$;',
   'create function private.gd_stage4_deputy_can_propose(uuid,uuid) returns boolean language sql stable as $ok$select false$ok$;',
   'create function private.gd_member_capacity(uuid,uuid) returns integer language sql stable as $ok$select 225$ok$;',
   'create function private.vote_member_has_office(uuid,uuid,text) returns boolean language sql stable as $ok$select true$ok$;',
   'create function private.role_is_available(uuid,uuid) returns boolean language sql stable as $ok$select true$ok$;',
   'create function private.gd_effective_present(uuid,uuid,integer) returns integer language sql stable as $ok$select 225$ok$;',
   'create function private.office_candidate_vote_weight(uuid,uuid) returns integer language sql stable as $ok$select 0$ok$;',
   'create table games(id uuid primary key,owner_id uuid);',
   'create table game_votes(game_id uuid,stage_no integer,procedure_key text,status text,result_code text);',
   "create table office_elections(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no integer default 4,office_key text,office_title text,round_no integer default 1,vote_mode text,status text default 'nomination',parent_election_id uuid,winner_candidate_id uuid,created_by uuid,opened_at timestamptz,closed_at timestamptz,created_at timestamptz default now(),ballot_mode text);",
   'create table office_candidates(id uuid primary key default gen_random_uuid(),election_id uuid,game_id uuid,user_id uuid,party_id uuid,nominated_by uuid,created_at timestamptz default now(),unique(election_id,user_id));',
   'create table office_personal_ballots(election_id uuid,game_id uuid,voter_id uuid,party_id uuid,candidate_id uuid,updated_at timestamptz default now(),unique(election_id,voter_id));',
   'create table office_ballots(id uuid primary key default gen_random_uuid(),election_id uuid,game_id uuid,party_id uuid,candidate_id uuid,votes integer,submitted_by uuid,updated_at timestamptz default now(),unique(election_id,party_id,candidate_id));',
   'create table institution_units(id uuid primary key,game_id uuid,unit_kind text,head_user_id uuid,title text);',
   'create table institution_session_registrations(game_id uuid,stage_no integer,institution_key text,user_id uuid,present_mandates integer);',
   'create table game_members(game_id uuid,user_id uuid,team text,kind text,roster_archived_at timestamptz);',
   'create table game_parties(id uuid,game_id uuid,leader_user_id uuid,registration_status text,name text);',
   'create table party_member_mandates(game_id uuid,party_id uuid,effective_mandates integer);',
   'create table political_posts(game_id uuid,author_id uuid,process_type text,actor_key text,actor_label text,title text,body text,tags text[],internal_view text,internal_ref_id text,source_key text,context jsonb,unique(game_id,source_key));'
  ].join('\n'));
  const game=uuid(1),committee=uuid(2),candidate=uuid(3),winner=uuid(4),owner=uuid(5);
  await db.query('insert into games values($1,$2)',[game,owner]);
  await db.query("insert into game_votes values($1,4,'gd_leadership_procedure','closed','passed')",[game]);
  await db.query("insert into office_elections(id,game_id,office_key,office_title,status,winner_candidate_id,ballot_mode) values($1,$2,'gd_chair','Председатель Государственной Думы','finished',$3,'personal')",[uuid(10),game,candidate]);
  await db.query("insert into institution_units values($1,$2,'committee',$3,'Комитет по обороне')",[committee,game,winner]);
  await db.exec(guard);
  const exists=await db.query("select private.office_has_confirmed_winner($1,'gd_chair') yes,private.office_has_confirmed_winner($1,'gd_deputy_1') no",[game]);
  assert.equal(exists.rows[0].yes,true);assert.equal(exists.rows[0].no,false);
  async function rejected(fn,label){let failed=false;try{await fn()}catch(e){failed=/Должность уже занята|Председатель комитета уже избран/.test(String(e.message))}assert(failed,label)}
  await rejected(()=>db.query("select public.create_office_election($1,'gd_chair','open')",[game]),'Cannot recreate elected GD chair');
  await rejected(()=>db.query("select public.create_committee_chair_election($1,'open')",[committee]),'Cannot reelect committee with chair');
  const dup=uuid(11);
  await db.query("insert into office_elections(id,game_id,office_key,office_title,status,ballot_mode) values($1,$2,'gd_chair','Председатель Государственной Думы','nomination','personal')",[dup,game]);
  await rejected(()=>db.query('select public.open_office_election($1)',[dup]),'Stale nomination cannot be opened');
  await rejected(()=>db.query('select public.nominate_office_candidate($1,$2)',[dup,uuid(16)]),'Stale nomination cannot collect candidates');
  const deputy=(await db.query("select public.create_office_election($1,'gd_deputy_1','open') id",[game])).rows[0].id;
  assert(deputy,'An empty different office remains electable');
  await db.exec(notice);
  const second=uuid(20);
  await db.query("insert into office_elections(id,game_id,office_key,office_title,round_no,status,parent_election_id,ballot_mode) values($1,$2,'gd_deputy_1','Заместитель Председателя ГД',2,'open',$3,'personal')",[second,game,deputy]);
  let alerts=(await db.query("select source_key,context from political_posts where game_id=$1",[game])).rows;
  assert.equal(alerts.length,1,'Runoff generates one ГОС.ID notice');
  assert.equal(alerts[0].context.notice_kind,'runoff');
  await db.query("update office_elections set status='closed' where id=$1",[deputy]);
  alerts=(await db.query("select source_key,context from political_posts where game_id=$1",[game])).rows;
  assert.equal(alerts.length,2,'No-winner two-candidate procedure demands repeat elections; no phantom second tour');
  assert(alerts.some(p=>p.context.notice_kind==='repeat_required'));
  assert.equal((await db.query("select count(*)::int n from political_posts where source_key=$1",['office-runoff:'+second])).rows[0].n,1);
  console.log('PASS: confirmed office winner blocks new election, nomination and open; another office remains available; second-round and repeat-election notices are unique.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
