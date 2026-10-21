'use strict';
const fs=require('node:fs');const assert=require('node:assert/strict');
const migration=fs.readFileSync('supabase/migrations/20261021175329_stage10_president_approved_goals_and_registry_sync.sql','utf8');
const lab=fs.readFileSync('components/game/StateProgramLab.tsx','utf8');
const editor=fs.readFileSync('components/game/StateProgramEditor.tsx','utf8');
const css=fs.readFileSync('components/game/StageForms.module.css','utf8');
const model=fs.readFileSync('components/game/stateProgramModel.ts','utf8');
const match=model.match(/export const nationalGoals=\[([\s\S]*?)\];/);
assert(match,'National goal source list must remain available');
const count=(match[1].match(/^ '/gm)||[]).length;assert.equal(count,7,'Only the seven approved national goal labels may be listed');
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
'selectedGoals.length<5','selectedGoals.length>6',
"onClick={()=>void saveGoals()}",
"set_presidential_address_goals",
"publish_presidential_address",
'nationalGoals.map(goal=>',
'type="checkbox"',
'goalsDirty',
'activeAddress?.status===\'published\'',
'styles.programGoalChoices'
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
console.log('PASS: 5–6 goals, president-only publication, published-goal program filter, identity authorization, linked formal-document history and responsive design');
