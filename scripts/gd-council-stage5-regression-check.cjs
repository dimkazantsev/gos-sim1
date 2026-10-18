const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261018145500_stage5_registration_and_gd_council_chat.sql','utf8');
const extract=name=>{
 const re=new RegExp('CREATE OR REPLACE FUNCTION '+name.replace(/\./g,'\\.')+'\\([\\s\\S]*?\\$function\\$;','i');
 const part=sql.match(re);assert(part,name+' must be present');return part[0];
};
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite(),game=uid(1),people=Array.from({length:40},(_,i)=>uid(101+i));
 try{
  await db.exec([
   'CREATE SCHEMA private;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;',
   'CREATE TABLE identity(uid uuid,held boolean,teacher boolean);',
   "INSERT INTO identity VALUES('10000000-0000-0000-0000-000000000101',false,false);",
   'CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$SELECT uid FROM identity$f$;',
   'CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$SELECT teacher FROM identity$f$;',
   'CREATE FUNCTION private.has_prior_stage_document_hold(uuid,uuid,integer) RETURNS boolean LANGUAGE sql STABLE AS $f$SELECT held FROM identity$f$;',
   'CREATE TABLE games(id uuid PRIMARY KEY);',
   'CREATE TABLE game_stages(game_id uuid,stage_no integer,status text,PRIMARY KEY(game_id,stage_no));',
   'CREATE TABLE institution_session_registrations(game_id uuid,stage_no integer,institution_key text,user_id uuid,present_mandates integer);',
   "CREATE TABLE formal_documents(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,game_id uuid,stage_no integer,doc_type text,subject_key text,metadata jsonb DEFAULT '{}'::jsonb,current_owner_key text,current_step integer,status_code text,workflow_steps jsonb,title text,registry_no text);",
   'CREATE FUNCTION private.stage4_legal_act_can_finalize(formal_documents,formal_documents,uuid) RETURNS boolean LANGUAGE sql AS $f$SELECT false$f$;',
   'CREATE FUNCTION private.can_reapprove_returned_gd_minutes(formal_documents,formal_documents,uuid) RETURNS boolean LANGUAGE sql AS $f$SELECT false$f$;',
   'CREATE FUNCTION private.can_remediate_stage_final_document(uuid,integer,uuid,text,text,jsonb) RETURNS boolean LANGUAGE sql AS $f$SELECT false$f$;',
   'CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);',
   'CREATE TABLE game_parties(id uuid DEFAULT gen_random_uuid(),game_id uuid,leader_user_id uuid,registration_status text);',
   'CREATE TABLE game_office_assignments(id uuid DEFAULT gen_random_uuid(),game_id uuid,user_id uuid,status text,role_title text);',
   "CREATE TABLE chat_channels(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,kind text,name text,created_by uuid);",
   'CREATE TABLE channel_members(channel_id uuid,user_id uuid,PRIMARY KEY(channel_id,user_id));',
   'CREATE TABLE chat_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,channel_id uuid,author_id uuid,kind text,text text,created_at timestamptz DEFAULT now());'
  ].join('\n'));
  await db.exec(extract('private.guard_stage_document_hold_write'));
  await db.exec('CREATE TRIGGER debt_guard BEFORE INSERT OR UPDATE ON institution_session_registrations FOR EACH ROW EXECUTE FUNCTION private.guard_stage_document_hold_write();');
  await db.query('INSERT INTO institution_session_registrations VALUES($1,5,$2,$3,225)',[game,'gd',people[0]]);
  await db.query('UPDATE institution_session_registrations SET present_mandates=180');
  assert.equal((await db.query('SELECT present_mandates FROM institution_session_registrations')).rows[0].present_mandates,180,'Stage 5 registration succeeds');
  await db.query('UPDATE identity SET held=true');
  await assert.rejects(()=>db.query('UPDATE institution_session_registrations SET present_mandates=190'),/обязательные итоговые документы/);
  await db.query('UPDATE identity SET held=false');
  await db.exec(sql.match(/CREATE UNIQUE INDEX IF NOT EXISTS gd_council_one_private_chat_per_game[\s\S]*?;/)[0]);
  for(const name of ['private.sync_gd_council_chat','private.sync_gd_council_chat_trigger'])await db.exec(extract(name));
  await db.exec(sql.match(/DROP TRIGGER IF EXISTS gd_council_chat_stage4[\s\S]*?CREATE TRIGGER gd_council_chat_membership[\s\S]*?;/)[0]);
  await db.query('INSERT INTO games VALUES($1)',[game]);
  await db.query("INSERT INTO game_stages VALUES($1,4,'open')",[game]);
  for(const person of people)await db.query("INSERT INTO game_members VALUES($1,$2,'student',null)",[game,person]);
  await db.query("INSERT INTO game_parties(game_id,leader_user_id,registration_status) VALUES($1,$2,'registered'),($1,$3,'registered')",[game,people[0],people[1]]);
  for(const [person,role] of [[people[2],'Председатель Государственной Думы'],[people[3],'Заместитель Председателя Государственной Думы №1'],[people[4],'Заместитель Председателя Государственной Думы №2']])
   await db.query("INSERT INTO game_office_assignments(game_id,user_id,status,role_title) VALUES($1,$2,'active',$3)",[game,person,role]);
  assert.equal((await db.query('SELECT count(*)::int n FROM chat_channels')).rows[0].n,0,'No channel before stage 4');
  await db.query("UPDATE game_stages SET status='completed' WHERE stage_no=4");
  const channels=(await db.query('SELECT id,kind,name FROM chat_channels')).rows;
  assert.equal(channels.length,1);assert.equal(channels[0].kind,'private');assert.equal(channels[0].name,'Совет ГД');
  const channel=channels[0].id;
  const members=async()=>(await db.query('SELECT user_id FROM channel_members WHERE channel_id=$1 ORDER BY user_id',[channel])).rows.map(x=>x.user_id);
  assert.deepEqual(await members(),people.slice(0,5));
  await Promise.all(Array.from({length:40},()=>db.query('SELECT private.sync_gd_council_chat($1)',[game])));
  assert.equal((await members()).length,5,'40 parallel syncs keep unique membership');
  await db.query('UPDATE game_parties SET leader_user_id=$2 WHERE leader_user_id=$1',[people[0],people[5]]);
  assert.deepEqual(await members(),people.slice(1,6),'New party leader replaces old');
  await db.query('UPDATE game_members SET roster_archived_at=now() WHERE user_id=$1',[people[3]]);
  assert(!(await members()).includes(people[3]),'Archived deputy loses access');
  await db.exec(sql.match(/CREATE TABLE IF NOT EXISTS private\.gd_council_chat_document_delivery[\s\S]*?;/)[0]);
  for(const name of ['private.post_gd_council_document_arrival','private.notify_gd_council_document_trigger'])await db.exec(extract(name));
  await db.exec(sql.match(/DROP TRIGGER IF EXISTS gd_council_chat_document_arrival[\s\S]*?EXECUTE FUNCTION private\.notify_gd_council_document_trigger\(\);/)[0]);
  const document=uid(900);
  await db.query("INSERT INTO formal_documents(id,game_id,stage_no,doc_type,current_owner_key,title,registry_no,status_code) VALUES($1,$2,5,'other','gd_council','Постановление о повестке','ГОС.ID-900','under_review')",[document,game]);
  const count=async()=>(await db.query('SELECT count(*)::int n FROM chat_messages WHERE channel_id=$1',[channel])).rows[0].n;
  assert.equal(await count(),1,'First document arrival announces');
  assert.deepEqual((await db.query('SELECT kind,author_id FROM chat_messages')).rows,[{kind:'system',author_id:null}]);
  await Promise.all(Array.from({length:40},()=>db.query('UPDATE formal_documents SET current_step=coalesce(current_step,0)+1 WHERE id=$1',[document])));
  assert.equal(await count(),1,'40 replayed updates do not repeat notices');
  await db.query("UPDATE formal_documents SET current_owner_key='author' WHERE id=$1",[document]);
  await db.query("UPDATE formal_documents SET current_owner_key='gd_council' WHERE id=$1",[document]);
  assert.equal(await count(),2,'Return to council announces again');
  await db.query('SELECT private.post_gd_council_document_arrival($1,$2,$3,$4,true)',[game,document,'Постановление о повестке','ГОС.ID-900']);
  assert.equal(await count(),2,'Backfill is idempotent');
  assert(sql.includes("c.name='Совет ГД'"),'Chat overview includes a private Council with more than two participants');
  await db.query("UPDATE game_stages SET status='open' WHERE stage_no=4");
  assert.equal((await members()).length,0,'Reopened stage suspends chat without losing history');
  console.log('PASS: stage 5 registration and document hold; five authorised Council members; 40 syncs; arrival, return and 40 duplicate updates; backfill; stage reset.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});