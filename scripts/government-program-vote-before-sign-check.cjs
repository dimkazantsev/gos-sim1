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
assert(session.includes("item.vote_id&&<button")&&session.includes("onOpenVotes(item.vote_id!)"),'Every eligible member can open the ballot from Government session');
assert(session.includes("sign_adopted_state_program"),'PM can sign after vote even if session is closed');
assert(session.includes("item.vote_id&&<button")&&session.includes("Открыть результаты голосования"),'Result remains reachable after session closing');
assert(model.includes("Принята · Ожидает подписи"),'Adoption does not mean publication');
assert(css.includes('.programWorkspace .programApprovalSteps'),'Uses scoped ГОС.ID styling');
assert(migration.includes('REVOKE ALL ON FUNCTION public.sign_adopted_state_program(uuid) FROM PUBLIC,anon;'),'No anonymous signature permission');
const compat=fs.readFileSync('supabase/migrations/20261021210700_legacy_signed_program_agenda_ballot_compatibility.sql','utf8');
for(const guard of [
 "p.status='government_vote'",
 "p.signed_at is not null",
 "v.status='open'",
 "v.procedure_key='state_program'",
 "not exists(select 1 from public.game_ballots",
 "not exists(select 1 from public.government_program_agenda",
 "a.vote_id=v.id and a.status='decision'",
 "s.status='open' and s.stage_no=11",
 "government_vote_id",
])assert(compat.includes(guard),'Historical one-vote pathway guard missing: '+guard);
assert(session.includes("p.status==='government_vote'")&&session.includes("!g.ballots.some"),'Signed legacy programme shown only with empty open vote');
assert(compat.includes("v_vote:=p.government_vote_id")===false,'Preserve locked original ballot through verified SELECT');
assert(compat.includes("for update;"),'Legacy ballot is locked during reuse');
console.log('PASS: current and historical Government programme votes, agenda, no duplicate ballots, 3-step PM signature and role checks');
