'use strict';
const fs=require('node:fs');const assert=require('node:assert/strict');
const migration=fs.readFileSync('supabase/migrations/20261021175329_stage10_president_approved_goals_and_registry_sync.sql','utf8');
const lab=fs.readFileSync('components/game/StateProgramLab.tsx','utf8');
const editor=fs.readFileSync('components/game/StateProgramEditor.tsx','utf8');
const css=fs.readFileSync('components/game/StageForms.module.css','utf8');
const rights=fs.readFileSync('supabase/migrations/20261021181110_stage10_president_authored_goals_and_office_rights.sql','utf8');
const rlsGrant=fs.readFileSync('supabase/migrations/20261021184405_stage10_presidential_rls_function_execute_grant.sql','utf8');
assert(rlsGrant.includes('GRANT EXECUTE ON FUNCTION private.can_manage_presidential_policy(uuid, uuid) TO authenticated;'),'RLS policy helper needs EXECUTE for authenticated reads');
assert(rlsGrant.includes('REVOKE EXECUTE ON FUNCTION private.can_manage_presidential_policy(uuid, uuid) FROM anon, PUBLIC;'),'The policy helper must remain unavailable to anonymous callers');
assert(!rlsGrant.includes('GRANT ALL'),'Never escalate table access to hide an RLS function permission error');
assert(!lab.includes('nationalGoals.map('),'Presidential goals must be authored, not selected from a preset list');
assert(lab.includes('p_body_text:addressBody.trim()'),'RPC argument must match save_presidential_address signature');
assert(rights.includes("private.can_manage_presidential_policy(p_game uuid,p_user uuid)"),'Correct authorized RPC scope');
assert(rights.includes("public.game_office_assignments"),'President in active offices retains authority');
assert(rights.includes("m.roster_archived_at IS NULL"),'Archived students cannot approve');
assert(rights.includes("lower(trim(o.role_title))='президент российской федерации'"),'Office title must match President exactly');
assert(rights.includes("length(btrim(g)) NOT BETWEEN 12 AND 500"),'Prevent empty or unbounded authored goals');
assert(rights.includes("count(DISTINCT lower(btrim(g)))"),'Reject duplicate authored goals');
assert(rights.includes("v_n NOT BETWEEN 5 AND 6"),'Five to six authored goals');
for(const statement of [
'CREATE OR REPLACE FUNCTION public.set_presidential_address_goals',
'v_uid IS NULL OR NOT private.can_manage_presidential_policy',
'coalesce(array_length(p_goals,1),0) NOT BETWEEN 5 AND 6',
'count(DISTINCT goal)',
'IF a.status<>\'draft\'',
'REVOKE ALL ON FUNCTION public.set_presidential_address_goals',
'GRANT EXECUTE ON FUNCTION public.set_presidential_address_goals',
'v_count NOT BETWEEN 5 AND 6',
'CREATE UNIQUE INDEX IF NOT EXISTS formal_stage10_program_source_uq',
'CREATE UNIQUE INDEX IF NOT EXISTS formal_presidential_address_source_uq',
'private.sync_presidential_address_registry(a.id,v_uid)',
'private.sync_state_program_registry(v_program_id)',
'private.formal_workflow(\'government_act\')',
'private.formal_workflow(\'generic\')',
'INSERT INTO public.formal_document_revisions',
'd.metadata->>\'auto_synced\'=\'true\'',
'd.status_code IN (\'draft\',\'revision\')',
'Для направления программы выберите цель, утверждённую Президентом'
])assert(migration.includes(statement),'Missing database control: '+statement);
assert(!migration.includes('DROP TABLE'),'Never remove historical documents or votes');
assert(!migration.includes('DELETE FROM public.formal_documents'),'No destructive document removal');
for(const statement of [
'formulatedGoals.every(x=>x.length>=12&&x.length<=500)',
"onClick={()=>void saveGoals()}",
"set_presidential_address_goals",
"publish_presidential_address",
'selectedGoals.map((goal,index)=>',
'textarea rows={2} maxLength={500}',
'goalsDirty',
'activeAddress?.status===\'published\'',
'styles.programGoalChoices',
'styles.goalInputGroup',
'Добавить шестую цель',
'Убрать шестую цель'
])assert(lab.includes(statement),'Goal approval form missing: '+statement);
for(const statement of [
'approvedGoals=priorities.filter',
'!approvedGoals.length',
'Национальная цель, утверждённая Президентом',
"changePassport('presidential_priority_id'",
'Сохранить всю форму',
'Подтвердить программу и направить министру'
])assert(editor.includes(statement),'Editor link lost: '+statement);
assert(!editor.includes('...nationalGoals.map(x=>({value:x,label:x}))'),'Must not allow unapproved goals');
assert(css.includes('.programWorkspace .programGoalChoice'),'Scoped branded goal choice');
assert(css.includes('@media(max-width:700px)'),'Responsive mobile style');
console.log('PASS: Presidential RLS helper EXECUTE is granted only to authenticated; 5–6 independently authored goals, RPC argument names, exact President roles, published-goal program filter, formal-document history and responsive design');
