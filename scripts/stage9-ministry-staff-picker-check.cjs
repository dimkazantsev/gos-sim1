'use strict';
// Stage 9: one registered student may hold independent positions in many
// ministries. Pure UI contract: no HTTP calls or production mutations.
const assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync('components/game/InstitutionStaffingLab.tsx','utf8');
const migration=fs.readFileSync('supabase/migrations/20261120151810_stage9_allow_parallel_ministry_staff_roles.sql','utf8');
const expression="students.filter(s=>!aa.some(a=>a.user_id===s.user_id))";
assert(src.includes(expression),'Same-unit duplicates excluded; other ministries do not block');
assert(!src.includes('ministryStaff.has('),'No global one-ministry staff restriction');
assert(src.includes("const students=members.filter(m=>m.kind==='student')"),'Registered students only');
assert(src.includes('Один участник может занимать несколько разных должностей'),'Explain combined offices');
assert(migration.includes('DROP INDEX IF EXISTS public.institution_assignments_one_staff_ministry_per_student'),'Old unique cross-ministry index removed');
assert(migration.includes('UNIQUE(unit_id,user_id)'),'Retain one membership per unit');
const candidates=(students,assignments,unit)=>students.filter(s=>!assignments.some(a=>a.unit_id===unit&&a.user_id===s.user_id)).map(s=>s.user_id);
const students=[{user_id:'ivan',kind:'student'},{user_id:'testov',kind:'student'}];
const heads=[
 ['economic','ivan'],['foreign','ivan'],['internal','ivan'],['social','testov'],['defence','testov']
].map(([unit_id,user_id])=>({unit_id,user_id,assignment_role:'head'}));
assert.deepEqual(candidates(students,heads,'economic'),['testov']);
assert.deepEqual(candidates(students,heads,'social'),['ivan']);
const staffed=[...heads,{unit_id:'economic',user_id:'testov',assignment_role:'member'}];
assert.deepEqual(candidates(students,staffed,'economic'),[],'Do not insert the same employee twice in one ministry');
assert.deepEqual(candidates(students,staffed,'foreign'),['testov'],'Allow the same employee in a second ministry');
assert.deepEqual(candidates(students,staffed,'internal'),['testov'],'Allow a third ministry');
const deputy=[...staffed,{unit_id:'defence',user_id:'ivan',assignment_role:'deputy'}];
assert.deepEqual(candidates(students,deputy,'social'),['ivan'],'A deputy can serve in another ministry');
assert(src.includes("a.assignment_role==='deputy'?'Заместитель министра'"),'Correctly distinguish deputy office');

assert(src.includes("nomination?.status==='appointed'?nomination:null"),'Approval alone must not grant minister powers');
assert(src.includes(".in('status',['submitted','vote_open','approved','consultation_pending','consulted','appointed'])"),'Existing nomination read must include pending statuses in the same query');
assert(src.includes("Кандидатура утверждена Государственной Думой. Ожидается указ Президента."),'Explain why the Duma-approved candidate is not yet a minister');
assert(src.includes("Консультация с Советом Федерации завершена. Ожидается указ Президента."),'Consultation must not grant minister powers');
const government=fs.readFileSync('components/game/GovernmentFormationWorkspace.tsx','utf8');
assert(government.includes("nomination.status==='approved'||nomination.status==='consulted'?' · ожидается указ Президента'"),'Top cards must show the pending presidential decree');
assert(government.includes("nomination.status==='approved'&&canPresident"),'Appointment is actionable by the President, not the teacher or a candidate');
console.log('PASS Stage 9 picker: multiple ministries, deputy, minister, no own-unit duplicates and student-only roster');
