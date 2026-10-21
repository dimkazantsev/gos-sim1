'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const migration=fs.readFileSync('supabase/migrations/20261021204000_government_program_vote_then_pm_signature.sql','utf8');
const lab=fs.readFileSync('components/game/StateProgramLab.tsx','utf8');
const session=fs.readFileSync('components/game/GovernmentProgramSessionLab.tsx','utf8');
const css=fs.readFileSync('components/game/StageForms.module.css','utf8');
const model=fs.readFileSync('components/game/stateProgramModel.ts','utf8');
for(const required of [
 'public.sign_adopted_state_program',
 "p.status<>'adopted'",
 "v.result_code='passed'",
 "v.result_quorum_met",
 "p.government_vote_id",
 "p.signed_at is null",
 "app.gos_program_agenda_item",
 "a.status='presenting'",
 "s.status='open' and s.stage_no=11",
 "d.stage_no=11",
 "institution_meeting_records",
 "agenda_approved_at",
 "stage_required_final_documents",
 "p.status IN ('ready','government_vote','adopted')"
])assert(migration.includes(required),'Migration lacks state/role/agenda guard '+required);
assert(migration.includes('perform private.publish_signed_state_program(p.id,v_uid)'),'PM confirmation generates programme publication');
assert(migration.includes("d.status_code='published'"),'Resolution publication is separately guarded');
assert(!migration.includes("if p_action='pm_ready' then perform private.publish_signed_state_program"),'Cannot sign before meeting');
assert(!lab.includes("onClick={()=>void run('open_state_program_government_vote'"),'No direct programme vote outside presentation');
assert(lab.includes("p_action:'pm_ready'")&&lab.includes("Согласовать для включения в повестку"),'PM only pre-approves agenda entry');
assert(lab.includes("sign_adopted_state_program"),'Signed publication available after positive vote');
assert(session.includes("open_program_vote_from_agenda"),'Vote from presented agenda only');
assert(session.includes("i.vote_id&&<button"),'Every eligible member can open the ballot from Government session');
assert(session.includes("sign_adopted_state_program"),'PM can sign after vote even if session is closed');
assert(session.includes("!!i.vote_id||p?.status==='adopted'"),'Result remains reachable after session closing');
assert(model.includes("Принята · Ожидает подписи"),'Adoption does not mean publication');
assert(css.includes('.programWorkspace .programApprovalSteps'),'Uses scoped ГОС.ID styling');
assert(migration.includes('REVOKE ALL ON FUNCTION public.sign_adopted_state_program(uuid) FROM PUBLIC,anon;'),'No anonymous signature permission');
console.log('PASS: teacher/PM permissions, three-step presentation-vote-sign sequence, no premature publication, session registration and existing routes');
