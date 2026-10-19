const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261019210000_party_candidate_photo_upload.sql','utf8');
const previous=fs.readFileSync('supabase/migrations/20261019101000_exclusive_presidential_decision_party_candidate_upload.sql','utf8');
const ui=fs.readFileSync('components/game/PresidentialElectionLab.tsx','utf8');
const helperGrant=fs.readFileSync('supabase/migrations/20261019220000_presidential_candidate_storage_helper_execute.sql','utf8');
const memberFn=previous.match(/CREATE OR REPLACE FUNCTION private\.can_upload_presidential_candidate_document\([\s\S]*?\$fn\$;/);
const photoFn=sql.match(/CREATE OR REPLACE FUNCTION public\.set_presidential_candidate_photo\([\s\S]*?\$photo\$;/);
assert(memberFn&&photoFn,'Both candidate authorization and photo RPC required');
assert(sql.includes('CREATE POLICY gos_party_candidate_photo_upload'),'Storage insertion policy required');
assert(sql.includes('CREATE POLICY gos_party_presidential_candidate_read'),'Same-party candidate drafts must be visible');
assert(sql.includes('CREATE POLICY gos_party_presidential_documents_read'),'Same-party documents must be readable');
assert(sql.includes('CREATE POLICY gos_party_presidential_program_read'),'Programme completeness is visible only to the nominating party');
assert(sql.includes('presidential_candidates.party_id')&&sql.includes('presidential_candidate_documents.game_id'),'RLS scoped to the exact party, candidate and game');
assert(sql.includes("c.registration_status<>'registered'"),'Registered candidate files are immutable');
assert(sql.includes("split_part(name,'/',3)"),'Storage upload is bound to candidate');
assert(ui.includes('{canUploadDocuments&&<section className="candidatePhotoBlock">'),'Party members see the photo upload UI');
assert(ui.includes('{canManage&&<section className="candidatePrivateProfile">'),'Private profile remains restricted');
const uuid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 const game=uuid(1),party=uuid(2),otherParty=uuid(3),candidate=uuid(4);
 const leader=uuid(100),outsider=uuid(200),archived=uuid(201);
 const photo=(index)=>game+'/presidential/'+candidate+'/photo-'+uuid(index)+'.png';
 async function actor(id){
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);
 }
 async function save(id,filepath){
  await actor(id);
  await db.query("INSERT INTO storage.objects VALUES ('game-assets',$1) ON CONFLICT DO NOTHING",[filepath]);
  return db.query('SELECT public.set_presidential_candidate_photo($1,$2)',[candidate,filepath]);
 }
 try{
  await db.exec(`
CREATE SCHEMA private;CREATE SCHEMA auth;CREATE SCHEMA storage;
CREATE ROLE authenticated;CREATE ROLE anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
 SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
CREATE TABLE game_parties(id uuid,game_id uuid,name text,leader_user_id uuid,registration_status text);
CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,team text,roster_archived_at timestamptz);
CREATE TABLE presidential_candidates(id uuid,game_id uuid,user_id uuid,created_by uuid,party_id uuid,nomination_type text,archived_at timestamptz,registration_status text,photo_path text,updated_at timestamptz);
CREATE TABLE storage.objects(bucket_id text,name text PRIMARY KEY);
CREATE FUNCTION private.can_manage_presidential_candidate(p_candidate uuid,p_user uuid)
 RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS(
 SELECT 1 FROM presidential_candidates WHERE id=p_candidate
 AND (user_id=p_user OR created_by=p_user)) $f$;
`);
  await db.exec(memberFn[0]);
  await db.exec('REVOKE ALL ON FUNCTION private.can_upload_presidential_candidate_document(uuid,uuid) FROM PUBLIC,anon,authenticated;');
  assert.match(helperGrant,/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+private\.can_upload_presidential_candidate_document\s*\(uuid,\s*uuid\)\s+TO\s+authenticated\s*;/i,'Restore execute permission for the Storage RLS helper');
  await db.exec(helperGrant);
  const rights=(await db.query("SELECT has_function_privilege('authenticated','private.can_upload_presidential_candidate_document(uuid,uuid)','EXECUTE') AS authenticated, has_function_privilege('anon','private.can_upload_presidential_candidate_document(uuid,uuid)','EXECUTE') AS anonymous")).rows[0];
  assert.equal(rights.authenticated,true,'Authenticated may execute helper from Storage policy');
  assert.equal(rights.anonymous,false,'Anonymous must not execute helper');
  await db.exec(photoFn[0]);
  await db.query("INSERT INTO game_parties VALUES ($1,$2,'Партия А',$3,'registered'),($4,$2,'Партия Б',$5,'registered')",[party,game,leader,otherParty,outsider]);
  await db.query("INSERT INTO presidential_candidates(id,game_id,user_id,created_by,party_id,nomination_type,registration_status) VALUES($1,$2,$3,$3,$4,'party','submitted')",[candidate,game,leader,party]);
  const members=Array.from({length:40},(_,i)=>uuid(300+i));
  for(const id of [leader,...members,archived,outsider]){
   const memberParty=id===outsider?'Партия Б':'Партия А';
   await db.query("INSERT INTO game_members VALUES($1,$2,'student',$3,$4)",[game,id,memberParty,id===archived?new Date():null]);
  }
  for(let i=0;i<40;i++)await save(members[i],photo(500+i));
  assert.equal((await db.query("SELECT photo_path FROM presidential_candidates WHERE id=$1",[candidate])).rows[0].photo_path,photo(539));
  for(const id of [outsider,archived]){
   await assert.rejects(()=>save(id,photo(700)),/Нет полномочий/);
  }
  await assert.rejects(()=>save(members[0],game+'/presidential/'+uuid(98)+'/photo-'+uuid(99)+'.png'),/Некорректный путь/);
  await actor(members[0]);await assert.rejects(()=>db.query('SELECT public.set_presidential_candidate_photo($1,$2)',[candidate,photo(999)]),/не найдена/);
  await db.query("UPDATE presidential_candidates SET registration_status='registered' WHERE id=$1",[candidate]);
  await assert.rejects(()=>save(members[0],photo(800)),/закрыто/);
  await db.query("UPDATE presidential_candidates SET registration_status='submitted' WHERE id=$1",[candidate]);
  await db.query("UPDATE game_parties SET registration_status='rejected' WHERE id=$1",[party]);
  await assert.rejects(()=>save(members[0],photo(801)),/Нет полномочий/);
  console.log('PASS: 40 party members upload photo; outsider/archived/unregistered/registered denied; path and missing file rejected; private profile unchanged.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
