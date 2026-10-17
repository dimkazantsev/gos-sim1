/* No writes to live Supabase; guards cover DB, RPC and interface. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const file=p=>fs.readFileSync(p,'utf8');
const scope=file('supabase/migrations/20261017165000_ksrf_meeting_stage_guard_scope.sql');
const rules=file('supabase/migrations/20261017165500_ksrf_agenda_registration_gate.sql');
const ballots=file('supabase/migrations/20261017170000_ksrf_ballot_stage_session_gate.sql');
const agreement=file('supabase/migrations/20261017170500_ksrf_regional_agreement_session_gate.sql');
const stageWindow=file('supabase/migrations/20261017171000_ksrf_stage_window_after_registration.sql');
const ui=file('components/game/InstitutionRegistrationPanel.tsx');
const stage=file('components/game/GovernanceStageWorkspace.tsx');
const guardStart=scope.indexOf('CREATE OR REPLACE FUNCTION private.guard_stage_submission()');
const guardEnd=scope.indexOf('CREATE OR REPLACE FUNCTION public.save_institution_meeting_document(');
assert(guardStart>=0&&guardEnd>guardStart);
const guard=scope.slice(guardStart,guardEnd);
assert(guard.includes("if tg_table_name='party_documents' then"),'Party-specific record field is nested under party table');
assert(guard.indexOf("if tg_table_name='party_documents' then")<guard.indexOf('new.party_id'));
assert(guard.includes("current_setting('app.gos_meeting_document_scope',true)"),'Authorized RPC flags only its meeting document');
assert(guard.includes("new.doc_type='meeting_agenda'")&&guard.includes("new.doc_type='minutes'"),'Only explicitly scoped meeting document types bypass the stage guard');
assert(guard.includes("if tg_table_name='formal_documents' and tg_op<>'DELETE' then"),'Never read NEW.doc_type from a party document');
assert(guard.includes("raise exception 'Этап завершён или ещё не открыт"),'Student stage window still enforced');
assert(scope.includes("perform set_config('app.gos_meeting_document_scope'"),'Meeting RPC binds scope after authorization');
assert(scope.indexOf("if not v_manager and m.delegate_user_id is distinct from uid")<
 scope.indexOf("perform set_config('app.gos_meeting_document_scope'"),'Permission check before scope grant');
assert(rules.includes("m.agenda_approved_at is not null and d.status_code='published'"),'Only published and approved agenda unlocks');
assert(rules.includes("Сначала составьте и утвердите повестку заседания КСРФ"));
for(const name of ['propose_parliamentary_election_rule','propose_regional_election_rule','open_parliamentary_rule_vote','open_regional_rule_vote']){
 const start=rules.indexOf('FUNCTION public.'+name+'(');
 assert(start>=0,'Gate missing '+name);
 const tail=rules.slice(start,rules.indexOf('end;$function$;',start));
 assert(tail.includes('private.require_game_meeting_registration('),'Cannot '+name+' before readiness');
}
assert(ballots.includes("tg_table_name='game_votes'")&&ballots.includes("tg_table_name='game_ballots'"),'Both votes and ballots guarded');
assert(ballots.includes('private.require_game_meeting_registration('));
assert(stageWindow.includes("s.status='open'")&&stageWindow.includes('g.turn_open'),'Finished or paused stages stay read-only even after check-in');
assert(agreement.includes("perform private.require_game_meeting_registration(r.game_id,v_uid,3,'ksrf')"),'Stage 3 regional agreements require registration');
assert(ui.includes('const preStageKsrf=body===\'ksrf\'&&(stage===2||stage===3)'),'Meeting preparation enabled before stage opening');
assert(ui.includes('onMeetingReadyChange?.(ready)'),'Attendee readiness sent to work pane');
assert(stage.includes('disabled={viewer||ksrfSessionBlocked}'),'Actual stage forms locked before session readiness');
assert(stage.includes('sessionGate.ready'),'Registration unlocks stage work individually');
assert(stage.includes('readOnly={stage.stage_no===2||stage.stage_no===3?'),'Meeting setup remains outside disabled work fieldset');
for(const path of ['components/game/InstitutionRegistrationPanel.tsx','components/game/GovernanceStageWorkspace.tsx']){
 const t=ts.transpileModule(file(path),{fileName:path,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert(!t.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error),'TSX parse '+path);
}
console.log('PASS KSRF gate: role-checked first agenda, meeting registration, stage 2/3 votes and ballots, mobile-safe UI gating.');
