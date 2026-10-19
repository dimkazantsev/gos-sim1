const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261019235950_presidential_party_campaign_submission_and_assets.sql','utf8');
const ui=fs.readFileSync('components/game/PresidentialElectionStage7.tsx','utf8');
assert(ui.includes('p.name===me.team'));
assert(ui.includes('!me.roster_archived_at'));
assert(ui.includes('selectedCandidate=mine.find'));
const uuid=x=>'10000000-0000-0000-0000-'+String(x).padStart(12,'0');
(async()=>{
const db=new PGlite();
try{
await db.exec([
"CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE SCHEMA private;CREATE SCHEMA storage;",
"CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;",
"CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,team text,roster_archived_at timestamptz);",
"CREATE TABLE game_parties(id uuid PRIMARY KEY,game_id uuid,name text,leader_user_id uuid,registration_status text);",
"CREATE TABLE presidential_candidates(id uuid PRIMARY KEY,game_id uuid,party_id uuid,nomination_type text,registration_status text,user_id uuid,created_by uuid,archived_at timestamptz);",
"CREATE TABLE presidential_campaign_materials(id uuid DEFAULT gen_random_uuid(),game_id uuid,candidate_id uuid,author_id uuid,title text,body text,material_type text,print_run integer,publisher_name text,production_date date,imprint_text text,external_url text,files jsonb,status text DEFAULT 'pending');",
"CREATE TABLE storage.objects(bucket_id text,name text,owner_id text);",
"CREATE FUNCTION private.is_game_member(g uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $f$ SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=g AND user_id=auth.uid() AND roster_archived_at IS NULL) $f$;",
"CREATE FUNCTION private.can_manage_presidential_candidate(c uuid,u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;",
"CREATE FUNCTION private.can_upload_presidential_candidate_document(cand uuid,actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $f$ SELECT actor=auth.uid() AND EXISTS(SELECT 1 FROM presidential_candidates c JOIN game_parties p ON p.id=c.party_id WHERE c.id=cand AND (c.user_id=actor OR c.created_by=actor OR p.leader_user_id=actor OR (p.registration_status='registered' AND EXISTS(SELECT 1 FROM game_members m WHERE m.game_id=c.game_id AND m.user_id=actor AND m.kind='student' AND m.roster_archived_at IS NULL AND m.team=p.name)))) $f$;",
"CREATE FUNCTION public.submit_presidential_campaign_material(p_candidate_id uuid,p_title text,p_body text,p_material_type text,p_print_run integer,p_publisher_name text,p_production_date date,p_imprint_text text,p_external_url text,p_files jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $f$",
"DECLARE c public.presidential_candidates%rowtype;v_uid uuid:=auth.uid();v_id uuid;BEGIN",
"SELECT * INTO c FROM public.presidential_candidates WHERE id=p_candidate_id AND archived_at IS NULL;",
"IF c.id IS NULL OR c.registration_status<>'registered' THEN RAISE EXCEPTION 'Only registered candidate may submit campaign materials';END IF;",
"if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate campaign access required';end if;",
"insert into public.presidential_campaign_materials(game_id,candidate_id,author_id,title,body,material_type,print_run,publisher_name,production_date,imprint_text,external_url,files)",
"values(c.game_id,c.id,v_uid,p_title,p_body,p_material_type,p_print_run,p_publisher_name,p_production_date,p_imprint_text,p_external_url,p_files) returning id into v_id;RETURN v_id;END;$f$;",
"CREATE ROLE tester_role NOLOGIN;",
"GRANT USAGE ON SCHEMA public,private,auth,storage TO authenticated;",
"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public,private,auth TO authenticated;"
].join('\n'));
await db.exec(migration);
const game=uuid(1),p1=uuid(2),p2=uuid(3),c1=uuid(4),c2=uuid(5),owner=uuid(6),stranger=uuid(7);
await db.query("INSERT INTO game_parties VALUES($1,$2,'Партия А',$3,'registered'),($4,$2,'Партия Б',$5,'registered')",[p1,game,owner,p2,stranger]);
await db.query("INSERT INTO presidential_candidates(id,game_id,party_id,nomination_type,registration_status,user_id,created_by) VALUES($1,$2,$3,'party','registered',$4,$4),($5,$2,$6,'party','registered',$7,$7)",[c1,game,p1,owner,c2,p2,stranger]);
for(let i=0;i<40;i++)await db.query("INSERT INTO game_members VALUES($1,$2,'student','Партия А',NULL)",[game,uuid(100+i)]);
await db.query("INSERT INTO game_members VALUES($1,$2,'student','Партия Б',NULL)",[game,stranger]);
await db.query("INSERT INTO game_members VALUES($1,$2,'student','Партия А',now())",[game,uuid(900)]);
const auth=id=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);
const allowed=async c=>(await db.query("SELECT private.can_submit_presidential_campaign_material($1,auth.uid()) AS yes",[c])).rows[0].yes;
for(let i=0;i<40;i++){await auth(uuid(100+i));assert.equal(await allowed(c1),true);assert.equal(await allowed(c2),false);
await db.query("SELECT public.submit_presidential_campaign_material($1,'Текст','Текст','news',0,NULL,NULL,NULL,NULL,'[]')",[c1]);}
await auth(stranger);assert.equal(await allowed(c1),false);
await auth(uuid(900));assert.equal(await allowed(c1),false);
await auth(uuid(100));
await assert.rejects(()=>db.query("SELECT public.submit_presidential_campaign_material($1,'Чужая агитация','Текст','news',0,NULL,NULL,NULL,NULL,'[]')",[c2]),/Candidate campaign access required/);
const path=game+'/presidential/'+c1+'/campaign/'+uuid(555)+'.png';
await db.query("INSERT INTO storage.objects VALUES('game-assets',$1,$2)",[path,uuid(100)]);
await db.query("SELECT public.submit_presidential_campaign_material($1,'С файлом','Текст','poster',100,NULL,NULL,'Тираж и изготовитель',NULL,$2::jsonb)",[c1,JSON.stringify([{storage_path:path}])]);
await auth(uuid(101));
await assert.rejects(()=>db.query("SELECT public.submit_presidential_campaign_material($1,'Чужой файл','Текст','other',0,NULL,NULL,NULL,NULL,$2::jsonb)",[c1,JSON.stringify([{storage_path:path}])]),/Файл должен быть загружен участником/);
assert.equal(Number((await db.query("SELECT count(*) AS n FROM presidential_campaign_materials WHERE candidate_id=$1",[c1])).rows[0].n),41);
console.log('PASS: 40 party participants may submit, archived/foreign are denied; unrelated files cannot be reused.');
}finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});