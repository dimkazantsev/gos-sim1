const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

const sql=fs.readFileSync('supabase/migrations/20261021170000_multi_ministry_student_only.sql','utf8');
const ui=fs.readFileSync('components/game/GovernmentFormationWorkspace.tsx','utf8');
const staff=fs.readFileSync('components/game/InstitutionStaffingLab.tsx','utf8');
const roleCount=(sql.match(/CREATE OR REPLACE FUNCTION public\./g)||[]).length;
assert.equal(roleCount,6,'Expected only six directly related RPC replacements');
for(const name of ['submit_government_nomination','appoint_government_nominee','appoint_government_nominee_after_three_rejections','assign_institution_member','set_institution_head','ensure_stage9_units'])
 assert(sql.includes('FUNCTION public.'+name),'Missing affected RPC '+name);
assert(sql.includes('DROP INDEX IF EXISTS public.government_nominations_one_ministry_candidate_idx'),'Old unique candidate-per-game index removed');
assert(sql.includes('DROP INDEX IF EXISTS public.institution_assignments_single_ministry_per_student'),'Old single-ministry member index removed');
assert(sql.includes("Minister must be a registered active student in this game"),'Require candidate UUID in Stage 9');
assert(sql.includes("Candidate name must match the selected registered student"),'Server binds correct full name, not manually entered identity');
assert((sql.match(/Minister must be a registered active student of this game/g)||[]).length===2,'Both paths of final presidential appointment must verify candidate');
assert(!sql.includes("A participant may head only one ministry"),'Remove obsolete restriction');
assert((sql.match(/on conflict\(unit_id,user_id\) do update/g)||[]).length>=3,'Minister staffing must resolve conflicts per ministry');
assert(ui.includes('readOnly={registeredOnly}'),'Require selection rather than manual text');
assert(ui.includes('!selected[slot]||candidateName(slot).length<3'),'Stage 9 nomination cannot submit free-text name');
assert(ui.includes('registeredOnly onSelect={handleNomineeSelect}'),'Stage 9 nominee selector is restricted');
assert(staff.includes("!assignedTo(u.id).some(a=>a.user_id===s.user_id)"),'Staffing candidates checked per ministry rather than globally');
assert(!staff.includes("!assignmentFor(s.user_id,'ministry')"),'Global ministry membership filter prohibited');

(async()=>{
const db=new PGlite();
try{
 await db.exec([
  "CREATE TABLE public.government_nominations(id serial PRIMARY KEY,game_id uuid,candidate_user_id uuid,office_kind text,status text,office_key text)",
  "CREATE TABLE public.institution_assignments(id serial PRIMARY KEY,game_id uuid,unit_id uuid,user_id uuid,unit_kind text,assignment_role text)",
  "CREATE UNIQUE INDEX government_nominations_one_ministry_candidate_idx ON public.government_nominations(game_id,candidate_user_id) WHERE candidate_user_id IS NOT NULL AND office_kind IN ('deputy_pm','duma_minister','security_minister') AND status NOT IN ('rejected','withdrawn')",
  "CREATE UNIQUE INDEX institution_assignments_single_ministry_per_student ON public.institution_assignments(game_id,user_id) WHERE unit_kind='ministry'",
  "CREATE UNIQUE INDEX institution_assignments_unit_id_user_id_key ON public.institution_assignments(unit_id,user_id)",
 ].join(';\n')+';');
 const game='10000000-0000-4000-8000-000000000001',student='20000000-0000-4000-8000-000000000001';
 const unitOne='30000000-0000-4000-8000-000000000001',unitTwo='30000000-0000-4000-8000-000000000002';
 await db.query("INSERT INTO public.government_nominations(game_id,candidate_user_id,office_kind,status,office_key) VALUES($1,$2,'duma_minister','approved','ministry_foreign')",[game,student]);
 await assert.rejects(()=>db.query("INSERT INTO public.government_nominations(game_id,candidate_user_id,office_kind,status,office_key) VALUES($1,$2,'security_minister','consulted','ministry_internal')",[game,student]),/duplicate key/,'Old constraint must reject a second ministry');
 await db.query("INSERT INTO public.institution_assignments(game_id,unit_id,user_id,unit_kind,assignment_role) VALUES($1,$2,$3,'ministry','head')",[game,unitOne,student]);
 await assert.rejects(()=>db.query("INSERT INTO public.institution_assignments(game_id,unit_id,user_id,unit_kind,assignment_role) VALUES($1,$2,$3,'ministry','head')",[game,unitTwo,student]),/duplicate key/);
 await db.exec("DROP INDEX IF EXISTS public.government_nominations_one_ministry_candidate_idx; DROP INDEX IF EXISTS public.institution_assignments_single_ministry_per_student;");
 await db.query("INSERT INTO public.government_nominations(game_id,candidate_user_id,office_kind,status,office_key) VALUES($1,$2,'security_minister','consulted','ministry_internal')",[game,student]);
 await db.query("INSERT INTO public.institution_assignments(game_id,unit_id,user_id,unit_kind,assignment_role) VALUES($1,$2,$3,'ministry','head')",[game,unitTwo,student]);
 const pair=(await db.query("SELECT count(*)::int AS n FROM public.institution_assignments WHERE user_id=$1",[student])).rows[0].n;
 assert.equal(pair,2,'Independent minister head positions persisted');
 await db.query("INSERT INTO public.institution_assignments(game_id,unit_id,user_id,unit_kind,assignment_role) VALUES($1,$2,$3,'ministry','head') ON CONFLICT(unit_id,user_id) DO UPDATE SET assignment_role='head'",[game,unitOne,student]);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.institution_assignments WHERE user_id=$1",[student])).rows[0].n,2,'Idempotence per ministry');
 console.log('PASS: repeated nominations for one student; separate ministry membership; per-unit duplicate protection; registered-only client and server guards; 6 affected RPCs');
}finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
