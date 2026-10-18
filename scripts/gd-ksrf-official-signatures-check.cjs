const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261018230000_gd_acting_chair_and_multi_institution_signatures.sql','utf8');
const source=(name)=>{const re=new RegExp('CREATE OR REPLACE FUNCTION '+name.replace(/\./g,'\\.')+'\\([\\s\\S]*?\\$fn\\$;');const m=migration.match(re);assert(m,name+' declared');return m[0]};
const uuid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite(),game=uuid(1),chair=uuid(101),dep1=uuid(102),dep2=uuid(103),ks1=uuid(104),ks2=uuid(105),ks3=uuid(106),outsider=uuid(140);
 const as=async(id)=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);
 try{
 await db.exec([
  'CREATE SCHEMA private;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;',
  "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$f$;",
  'CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);',
  'CREATE TABLE game_parties(id uuid DEFAULT gen_random_uuid(),name text,game_id uuid,leader_user_id uuid,registration_status text);',
  'CREATE TABLE game_stages(game_id uuid,stage_no int,status text);',
  'CREATE TABLE game_office_assignments(game_id uuid,user_id uuid,role_title text,status text,created_at timestamptz DEFAULT now());',
  'CREATE TABLE institution_units(game_id uuid,id uuid,head_user_id uuid);',
  'CREATE TABLE institution_session_registrations(game_id uuid,stage_no int,institution_key text,user_id uuid,present_mandates int);',
  "CREATE TABLE formal_documents(id uuid PRIMARY KEY,game_id uuid,stage_no int,subject_key text,status_code text,metadata jsonb DEFAULT '{}'::jsonb,current_owner_key text);",
  'CREATE TABLE formal_document_history(id bigint GENERATED ALWAYS AS IDENTITY,document_id uuid,game_id uuid,actor_id uuid,action text,from_status text,to_status text,from_owner text,to_owner text,note text);',
  'CREATE TABLE formal_document_signatures(id uuid DEFAULT gen_random_uuid(),document_id uuid,game_id uuid,history_id bigint UNIQUE,signer_id uuid,signature_path text,signed_at timestamptz DEFAULT clock_timestamp());',
  'CREATE TABLE game_profiles(game_id uuid,user_id uuid,signature_path text);',
  'CREATE FUNCTION private.is_game_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=p AND user_id=auth.uid())$f$;',
  'CREATE FUNCTION private.is_game_teacher(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$SELECT false$f$;',
  'CREATE FUNCTION private.role_is_available(p uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=p AND user_id=u AND kind=\'student\' AND roster_archived_at IS NULL)$f$;',
  'CREATE FUNCTION private.gd_effective_present(p uuid,u uuid,n integer) RETURNS integer LANGUAGE sql STABLE AS $f$SELECT coalesce(n,225)$f$;',
  'CREATE FUNCTION private.party_led_by(p uuid,u uuid) RETURNS uuid LANGUAGE sql STABLE AS $f$SELECT id FROM game_parties WHERE game_id=p AND leader_user_id=u AND registration_status=\'registered\' LIMIT 1$f$;',
  'CREATE FUNCTION private.formal_user_roles(p uuid,u uuid) RETURNS SETOF text LANGUAGE sql STABLE AS $f$SELECT lower(role_title) FROM game_office_assignments WHERE game_id=p AND user_id=u AND status=\'active\'$f$;',
  'CREATE FUNCTION private.role_matches_voting_body(text,text) RETURNS boolean LANGUAGE sql STABLE AS $f$SELECT false$f$;'
 ].join('\n'));
 const capture=migration.match(/CREATE OR REPLACE FUNCTION private\\.capture_formal_document_signature\\([\\s\\S]*?\\$function\\$;/);
 assert(capture,'Official history trigger is included in migration');
 await db.exec(capture[0]);
 await db.exec('CREATE TRIGGER capture AFTER INSERT ON formal_document_history FOR EACH ROW EXECUTE FUNCTION private.capture_formal_document_signature()');
 await db.exec("CREATE FUNCTION private.reject_document_update_test() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN RAISE EXCEPTION 'Closed stage document cannot be changed';END$f$;");
 await db.exec('CREATE TRIGGER guard_closed_stage BEFORE UPDATE ON formal_documents FOR EACH ROW EXECUTE FUNCTION private.reject_document_update_test()');
 for(const n of ['private.gd_presiding_officer','private.can_coordinate_institution_meeting','private.institution_document_signers','public.get_institution_document_signers','public.sign_institution_document'])await db.exec(source(n));
 await db.query("INSERT INTO game_stages VALUES($1,5,'open')",[game]);
 for(const uid of [chair,dep1,dep2,ks1,ks2,ks3,outsider]){await db.query("INSERT INTO game_members VALUES($1,$2,'student',NULL)",[game,uid]);await db.query("INSERT INTO game_profiles VALUES($1,$2,'signatures/test.png')",[game,uid]);}
 for(const [u,role] of [[chair,'Председатель Государственной Думы'],[dep1,'Заместитель Председателя Государственной Думы №1'],[dep2,'Заместитель Председателя Государственной Думы №2']])await db.query("INSERT INTO game_office_assignments(game_id,user_id,role_title,status) VALUES($1,$2,$3,'active')",[game,u,role]);
 for(const [u,n] of [[ks1,1],[ks2,2],[ks3,3]])await db.query("INSERT INTO game_parties(name,game_id,leader_user_id,registration_status) VALUES($1,$2,$3,'registered')",['Фракция '+n,game,u]);
 const gd=uuid(201),ks=uuid(202),draft=uuid(203),gdDeputy=uuid(204);
 await db.query("INSERT INTO formal_documents(id,game_id,stage_no,subject_key,status_code,current_owner_key) VALUES($1,$2,5,'gd','published','system'),($3,$2,2,'ksrf','published','system'),($4,$2,5,'gd','draft','author')",[gd,game,ks,draft]);
 let preside=async()=>(await db.query('SELECT private.gd_presiding_officer($1,5) as id',[game])).rows[0].id;
 assert.equal(await preside(),chair,'Before a meeting, its chair coordinates');
 await as(dep1);await assert.rejects(()=>db.query('SELECT public.sign_institution_document($1)',[gd]),/другому/,'Deputy cannot forge chair signature');
 await as(chair);await db.query('SELECT public.sign_institution_document($1)',[gd]);
 assert.equal((await db.query('SELECT count(*)::int n FROM formal_document_signatures WHERE document_id=$1',[gd])).rows[0].n,1);
 await assert.rejects(()=>db.query('SELECT public.sign_institution_document($1)',[gd]),/уже подписана/,'Repeated same edition signing denied');
 await db.query("INSERT INTO institution_session_registrations VALUES($1,5,'gd',$2,225)",[game,dep2]);
 assert.equal(await preside(),dep2,'A present second deputy substitutes absent chair');
 await db.query("INSERT INTO institution_session_registrations VALUES($1,5,'gd',$2,225)",[game,dep1]);
 assert.equal(await preside(),dep1,'Present deputy No 1 has precedence');
 await as(dep1);await assert.rejects(()=>db.query('SELECT public.sign_institution_document($1)',[gd]),/другому/,'Deputy cannot replace an existing chair signature');
  await db.query("INSERT INTO formal_documents(id,game_id,stage_no,subject_key,status_code,current_owner_key) VALUES($1,$2,5,'gd','published','system')",[gdDeputy,game]);
  await db.query('SELECT public.sign_institution_document($1)',[gdDeputy]);
  assert.equal((await db.query('SELECT count(*)::int n FROM formal_document_signatures WHERE document_id=$1',[gdDeputy])).rows[0].n,1,'Absent chair represented by deputy, not by forged chair signature');
 await db.query("INSERT INTO institution_session_registrations VALUES($1,5,'gd',$2,0)",[game,chair]);
 assert.equal(await preside(),dep1,'Zero actual chair turnout retains deputy');
 await db.query('UPDATE institution_session_registrations SET present_mandates=225 WHERE user_id=$1',[chair]);
 assert.equal(await preside(),chair,'Chair return restores chair authority');
 await as(dep2);await assert.rejects(()=>db.query('SELECT public.sign_institution_document($1)',[gdDeputy]),/другому/);
  const gdSigner=(await db.query('SELECT public.get_institution_document_signers($1) data',[gdDeputy])).rows[0].data;
  assert.equal(gdSigner.required.length,1,'GD needs one personal signature');
  assert.equal(gdSigner.required[0].user_id,dep1,'Signed act keeps its deputy signature after chair returns');
 await as(chair);await assert.rejects(()=>db.query('SELECT public.sign_institution_document($1)',[draft]),/ещё не принят/);
 await as(ks1);await db.query('SELECT public.sign_institution_document($1)',[ks]);
 await as(ks2);await db.query('SELECT public.sign_institution_document($1)',[ks]);
 let states=(await db.query('SELECT public.get_institution_document_signers($1) data',[ks])).rows[0].data;
 assert.equal(states.required.length,3,'KSRF requires three existing party leaders');
 assert.equal(states.required.filter(s=>s.signed).length,2,'Two of three signatures shown, never fabricated');
 await as(outsider);await assert.rejects(()=>db.query('SELECT public.sign_institution_document($1)',[ks]),/другому/);
 await as(ks3);await db.query('SELECT public.sign_institution_document($1)',[ks]);
 states=(await db.query('SELECT public.get_institution_document_signers($1) data',[ks])).rows[0].data;
 assert.equal(states.required.filter(s=>s.signed).length,3);
 await Promise.allSettled(Array.from({length:40},()=>db.query('SELECT public.sign_institution_document($1)',[ks])));
 assert.equal((await db.query('SELECT count(*)::int n FROM formal_document_signatures WHERE document_id=$1',[ks])).rows[0].n,3,'40 repeats cannot forge extra signatures');
 await db.query('UPDATE game_parties SET registration_status=\'dissolved\' WHERE leader_user_id=$1',[ks3]);
 states=(await db.query('SELECT public.get_institution_document_signers($1) data',[ks])).rows[0].data;
 assert.equal(states.required.length,2,'After reduction, KSRF requires exactly two faction chair signatures');
 const paper=fs.readFileSync('components/game/DocumentPaper.tsx','utf8');
 const view=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
 const print=fs.readFileSync('components/game/officialDocumentPrint.ts','utf8');
 assert(paper.includes('formalSignatureList')&&paper.includes('Ожидает личной подписи'));
 assert(view.includes('sign_institution_document')&&view.includes('get_institution_document_signers'));
 assert(print.includes('.formalSignatureList'));
 console.log('PASS: GD absence and deputies 1/2; actual in-person participation; 3->2 KSRF signatures; 40 duplicate attempts rejected; print and UI controls.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});