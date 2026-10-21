const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261021152000_preserve_president_permissions_on_minister_appointment.sql','utf8');
const [funcs,repair]=migration.split('-- Correct only a current Presidential primary profile backed by the active office register.');
assert(funcs.includes("a.status='active'"),'Only active offices may protect incumbent presidential role');
assert((funcs.match(/update public\.game_members m/g)||[]).length===2,'Both normal and 3-rejection appointments must preserve presidential office');
assert(funcs.includes("v_role not like '%президент%'"),'No bypass of existing President authorization');
assert(repair.includes("IF v_count<>1"),'Must uniquely resolve the active President');
assert(repair.includes("v_changes=1"),'At most one profile correction');
assert(!migration.includes('UPDATE public.game_office_assignments'),'Office register is authoritative, not altered');
const game='52297def-d24d-4ba9-8049-5078b1b3bd45',u=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
const db=new PGlite();
try{
await db.exec([
'CREATE SCHEMA auth;CREATE SCHEMA private;',
"CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.test_user',true),'')::uuid $$;",
"CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,role_title text,roster_archived_at timestamptz)",
"CREATE TABLE public.game_office_assignments(game_id uuid,user_id uuid,role_title text,status text)",
"CREATE TABLE public.government_nominations(id uuid PRIMARY KEY,game_id uuid,stage_no int,office_key text,office_title text,office_kind text,route text,status text,appointment_document_id uuid,candidate_user_id uuid,candidate_name text,appointed_at timestamptz,decided_at timestamptz,updated_at timestamptz,note text)",
"CREATE TABLE public.institution_units(game_id uuid,unit_kind text,unit_key text,head_user_id uuid)",
"CREATE TABLE public.game_events(game_id uuid,round_no int,category text,severity text,title text,body text,created_by uuid)",
"CREATE TABLE public.formal_documents(id uuid,game_id uuid,nomination_id uuid,workflow_key text,doc_type text,CONSTRAINT decree_route CHECK(doc_type='president_decree' AND workflow_key='president_act'))",
"CREATE TABLE public.audit_log(game_id uuid,actor_id uuid,action text,entity_type text,payload jsonb)",
"CREATE FUNCTION private.is_game_member(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=g AND m.user_id=auth.uid() AND m.roster_archived_at IS NULL) $$",
"CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$",
"CREATE FUNCTION private.game_role(g uuid,u uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT lower(coalesce((SELECT role_title FROM public.game_members WHERE game_id=g AND user_id=u LIMIT 1),'')) $$",
"CREATE FUNCTION private.stage8_create_appointment_decree(p_nomination_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE d uuid:=gen_random_uuid(); g uuid; BEGIN SELECT game_id INTO g FROM public.government_nominations WHERE id=p_nomination_id; INSERT INTO public.formal_documents VALUES(d,g,p_nomination_id,'president_act','president_decree'); RETURN d; END $$"
].join(';\n')+';');
const seedUser=async(id,role)=>db.query("INSERT INTO public.game_members(game_id,user_id,kind,role_title) VALUES($1,$2,'student',$3)",[game,id,role]);
await seedUser(u(1),'Министерство по экономической политике');
await seedUser(u(2),'Депутат Государственной Думы');
await seedUser(u(3),'Депутат Государственной Думы');
await db.query("INSERT INTO public.game_office_assignments VALUES($1,$2,'Президент Российской Федерации','active')",[game,u(1)]);
await db.query("INSERT INTO public.game_office_assignments VALUES($1,$2,'Президент Российской Федерации','ended')",[game,u(2)]);
const nominate=async(i,kind,route,status,candidate=null,key='ministry_foreign')=>db.query(
 "INSERT INTO public.government_nominations(id,game_id,stage_no,office_key,office_title,office_kind,route,status,candidate_user_id,candidate_name) VALUES($1,$2,9,$3,$4,$5,$6,$7,$8,'Тестовая кандидатура')",
 [u(i),game,key,'Министерство по внешней политике',kind,route,status,candidate]);
await nominate(11,'duma_minister','pm_to_duma','approved',null,'ministry_foreign');
await nominate(12,'security_minister','president_after_sf','consulted',null,'ministry_internal');
await nominate(13,'security_minister','president_after_sf','consultation_pending',null,'ministry_defence');
await nominate(14,'duma_minister','pm_to_duma','approved',u(1),'ministry_economic');
await nominate(15,'duma_minister','pm_to_duma','rejected',u(3),'ministry_social');
await nominate(16,'duma_minister','pm_to_duma','rejected',u(3),'ministry_social');
await nominate(17,'duma_minister','pm_to_duma','rejected',u(3),'ministry_social');
await db.query("INSERT INTO public.institution_units(game_id,unit_kind,unit_key) VALUES($1,'ministry','economic')",[game]);
await db.exec(funcs);
const setActor=id=>db.query("select set_config('app.test_user',$1,false)",[id]);
const appoint=id=>db.query("select public.appoint_government_nominee($1)",[u(id)]);
const fallback=id=>db.query("select public.appoint_government_nominee_after_three_rejections($1)",[u(id)]);
await setActor(u(2)); // Former President office ended => no privileged access.
await assert.rejects(()=>appoint(11),/President role required/);
await setActor(u(1)); // The primary title was incorrectly overwritten before the repair.
await assert.rejects(()=>appoint(11),/President role required/);
await db.exec('-- Correct only a current Presidential primary profile backed by the active office register.'+repair);
let roles=(await db.query("SELECT user_id,role_title FROM public.game_members WHERE game_id=$1",[game])).rows;
assert.equal(roles.find(x=>x.user_id===u(1)).role_title,'Президент Российской Федерации');
assert.equal(roles.find(x=>x.user_id===u(2)).role_title,'Депутат Государственной Думы','Ended offices must not regain power');
await appoint(11);
await appoint(12);
await assert.rejects(()=>appoint(13),/consultation must be recorded first/);
const status=(await db.query("SELECT office_key,status,appointment_document_id FROM public.government_nominations")).rows;
for(const k of ['ministry_foreign','ministry_internal']) {
const row=status.find(x=>x.office_key===k);
assert.equal(row.status,'appointed');assert(row.appointment_document_id);
}
assert.equal(status.find(x=>x.office_key==='ministry_defence').status,'consultation_pending');
const docs=(await db.query("SELECT workflow_key,doc_type FROM public.formal_documents")).rows;
assert.equal(docs.length,2);
assert(docs.every(x=>x.doc_type==='president_decree'&&x.workflow_key==='president_act'));
await appoint(14); // Existing presidential office must not be replaced by a ministry title.
const role=(await db.query("SELECT role_title FROM public.game_members WHERE user_id=$1",[u(1)])).rows[0].role_title;
assert.equal(role,'Президент Российской Федерации');
await fallback(17);
assert.equal((await db.query("SELECT status FROM public.government_nominations WHERE id=$1",[u(17)])).rows[0].status,'appointed');
assert.equal((await db.query("SELECT role_title FROM public.game_members WHERE user_id=$1",[u(3)])).rows[0].role_title,'Министерство по внешней политике','Ordinary ministers still receive their approved title');
assert.equal((await db.query('SELECT count(*)::int n FROM public.audit_log')).rows[0].n,1);
await db.exec('-- Correct only a current Presidential primary profile backed by the active office register.'+repair);
assert.equal((await db.query('SELECT count(*)::int n FROM public.audit_log')).rows[0].n,1,'Repair idempotent');
console.log('PASS: Stage 9 President retains office in two appointment RPCs, ended President denied, guest denied, approved/consulted conditions, decrees, 3-rejections, corrected historic profile, idempotence');
}finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});