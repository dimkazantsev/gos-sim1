const assert = require('node:assert/strict');
const fs = require('node:fs');
const {PGlite} = require('@electric-sql/pglite');
const migration = fs.readFileSync('supabase/migrations/20261020001000_stage10_ministry_collaboration_and_version_guard.sql','utf8');
const lab = fs.readFileSync('components/game/StateProgramLab.tsx','utf8');
const editor = fs.readFileSync('components/game/StateProgramEditor.tsx','utf8');
assert(lab.includes("institution_assignments").valueOf());
assert(lab.includes("appointedColleague"));
assert(lab.includes("selected.responsible_minister_id"));
assert(editor.includes("expected_updated_at:program.updated_at"));
assert(migration.includes("p_payload ? ''expected_updated_at''"));
assert(migration.includes("FOR UPDATE"));
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');

(async()=>{
const db=new PGlite();
try{
 await db.exec(`
 CREATE SCHEMA auth; CREATE SCHEMA private;
 CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
 CREATE TABLE public.institution_units(id uuid PRIMARY KEY,game_id uuid,unit_kind text,head_user_id uuid);
 CREATE TABLE public.institution_assignments(unit_id uuid,game_id uuid,unit_kind text,user_id uuid);
 CREATE TABLE public.state_programs(id uuid PRIMARY KEY,game_id uuid,status text,signed_at timestamptz,created_by uuid,responsible_minister_id uuid,updated_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
 CREATE FUNCTION private.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $fn$ SELECT false $fn$;
 CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=g AND user_id=auth.uid() AND kind='teacher' AND roster_archived_at IS NULL) $fn$;
 CREATE FUNCTION private.is_game_observer(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=g AND user_id=auth.uid() AND kind='observer') $fn$;
 CREATE FUNCTION private.role_is_available(g uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=g AND user_id=u AND roster_archived_at IS NULL) $fn$;
 `);
 const fn=migration.slice(0,migration.indexOf('-- Defensive concurrency guard'));
 await db.exec(fn);
 const game=id(1), outsider=id(99), teacher=id(90);
 const heads=[id(20),id(21),id(22),id(23),id(24)];
 for(let i=0;i<5;i++){
   await db.query('INSERT INTO institution_units VALUES($1,$2,$3,$4)',[id(30+i),game,'ministry',heads[i]]);
   await db.query("INSERT INTO game_members VALUES($1,$2,'student',NULL)",[game,heads[i]]);
   await db.query("INSERT INTO state_programs VALUES($1,$2,'draft',NULL,$3,$3,now())",[id(50+i),game,heads[i]]);
 }
 for(let i=0;i<40;i++){
   const member=id(100+i),unit=id(30+(i%5));
   await db.query("INSERT INTO game_members VALUES($1,$2,'student',NULL)",[game,member]);
   await db.query("INSERT INTO institution_assignments VALUES($1,$2,'ministry',$3)",[unit,game,member]);
 }
 await db.query("INSERT INTO game_members VALUES($1,$2,'student',NULL)",[game,outsider]);
 await db.query("INSERT INTO game_members VALUES($1,$2,'teacher',NULL)",[game,teacher]);
 const authorize=async uid=>{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);};
 const can=async(program,actor)=>(await db.query('SELECT private.can_edit_state_program($1,$2) AS allowed',[program,actor])).rows[0].allowed;
 for(let i=0;i<40;i++){
  const member=id(100+i),ours=id(50+(i%5)),another=id(50+((i+1)%5));
  await authorize(member);
  assert.equal(await can(ours,member),true,'appointed member may edit their draft');
  assert.equal(await can(another,member),false,'other ministry must stay isolated');
 }
 await authorize(outsider);assert.equal(await can(id(50),outsider),false);
 await authorize(heads[0]);assert.equal(await can(id(50),heads[0]),true);
 await authorize(teacher);assert.equal(await can(id(50),teacher),true);
 await db.query("UPDATE state_programs SET status='minister_review' WHERE id=$1",[id(50)]);
 await authorize(id(100));assert.equal(await can(id(50),id(100)),false,'staff cannot approve or change minister review');
 await authorize(heads[0]);assert.equal(await can(id(50),heads[0]),true,'minister can review');
 await db.query("UPDATE state_programs SET status='draft', signed_at=now() WHERE id=$1",[id(50)]);
 assert.equal(await can(id(50),heads[0]),false,'signed text is immutable');
 await db.query("UPDATE state_programs SET status='draft', signed_at=NULL WHERE id=$1",[id(50)]);
 await db.query("UPDATE game_members SET roster_archived_at=now() WHERE user_id=$1",[id(100)]);
 await authorize(id(100));assert.equal(await can(id(50),id(100)),false,'archived user cannot edit');
 await db.query("UPDATE institution_assignments SET game_id=$1 WHERE user_id=$2",[id(2),id(105)]);
 await authorize(id(105));assert.equal(await can(id(50),id(105)),false);
 console.log('PASS: 40 appointed staff, 5 ministries, foreign/archived exclusion, minister and teacher rights, signed and review locks.');
}finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
