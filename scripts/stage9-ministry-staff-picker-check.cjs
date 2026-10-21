'use strict';
/* Stage 9 staffing dropdown regression: evaluate the exact React eligibility expression.
 * Pure local test; no HTTP/Supabase calls or test-user mutations. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('components/game/InstitutionStaffingLab.tsx','utf8');
const m=src.match(/const ministryStaff=(new Set\(assignments\.filter\(a=>a\.unit_kind==='ministry'&&a\.assignment_role!=='head'\)\.map\(a=>a\.user_id\)\));/);
assert(m,'Only non-head ministry assignments must occupy a staff position');
const expression="students.filter(s=>!ministryStaff.has(s.user_id)&&!aa.some(a=>a.user_id===s.user_id))";
assert(src.includes(expression),'Dropdown must use actual eligible students');
assert(src.includes("const students=members.filter(m=>m.kind==='student')"),'Use registered students, not guests');
const candidates=new Function('students','assignments','aa',
 'const ministryStaff='+m[1]+';return '+expression+';');
const ivan={user_id:'ivan',kind:'student',full_name:'Иванов Иван Иванович'};
const testov={user_id:'testov',kind:'student',full_name:'Тестов Тест Тестович'};
const students=[ivan,testov];
const heads=[
 ['economic',ivan],['foreign',ivan],['internal',ivan],
 ['social',testov],['defence',testov]
].map(([unit,user])=>({unit_id:unit,unit_kind:'ministry',user_id:user.user_id,assignment_role:'head'}));
const options=(unit,assignments=heads)=>candidates(students,assignments,assignments.filter(a=>a.unit_id===unit)).map(s=>s.user_id);
assert.deepEqual(options('economic'),['testov'],'Current Ivan-led ministry must offer Testov');
assert.deepEqual(options('foreign'),['testov'],'Minister can be an ordinary employee of a different ministry');
assert.deepEqual(options('defence'),['ivan'],'Current Testov-led ministry must offer Ivan');
assert.deepEqual(options('social'),['ivan'],'Do not hide multiple-office leaders');
const withOneEmployee=[...heads,{unit_id:'economic',unit_kind:'ministry',user_id:'testov',assignment_role:'member'}];
assert.deepEqual(options('economic',withOneEmployee),[],'Cannot add member already in this ministry');
assert.deepEqual(options('foreign',withOneEmployee),[],'Only one ordinary staff ministry, even for a minister');
assert.deepEqual(options('defence',withOneEmployee),['ivan'],'Unrelated minister remains available');
const withDeputy=[...heads,{unit_id:'defence',unit_kind:'ministry',user_id:'ivan',assignment_role:'deputy'}];
assert.deepEqual(options('social',withDeputy),[],'Deputy counts as ordinary staff');
const sql=fs.readFileSync('supabase/migrations/20261021144730_stage9_registered_multi_ministry_heads.sql','utf8');
assert(sql.includes("WHERE unit_kind='ministry' AND assignment_role<>'head'"),'Database uniquely limits only ordinary staff');
assert(sql.includes("v_uid is distinct from u.head_user_id"),'Server permits ministry head to recruit');
assert(sql.includes('private.is_game_observer'),'Server rejects guest participation');
console.log('PASS: two active student ministers, five departments, one ordinary staff position, own-unit and guest restrictions.');
