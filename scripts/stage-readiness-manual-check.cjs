/* Readiness must be explicit: no background checks in the stage panel,
 * and each teacher stage transition must run a fresh preflight. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const panel=read('components/game/StageReadinessPanel.tsx');
const game=read('components/game/useRepublicGame.ts');
const teacher=read('components/game/TeacherView.tsx');
const css=read('app/stage-map.css');

assert(!panel.includes('useGameTableSync('),'The readiness panel must not subscribe to background invalidations or polling');
assert(!panel.includes('setInterval('),'The readiness panel must not poll');
assert(!panel.includes('STAGE_REALTIME_TABLES'),'The readiness panel must not subscribe to stage realtime tables');
assert(panel.includes('onClick={()=>void load()}'),'Manual verification button must trigger the RPC');
assert(panel.includes("setChecked(false)"),'Changing stage/game must invalidate the previous result');
assert(panel.includes("'Проверка ещё не выполнялась'"),'Before a manual check, readiness must not appear blocked/ready');
assert(panel.includes("!checked?'unchecked'"),'Unverified stage must have a neutral state');
assert(panel.includes("setChecked(true)"),'Only a completed attempt sets the checked state');
const start=game.indexOf(" async function manageStage(stageNo:number,action:'open'|'close'|'extend'");
const end=game.indexOf(' async function openStage(stageNo:number){',start);
assert(start>=0&&end>start,'Independent teacher stage management must be found');
const transition=game.slice(start,end);
const preflight=transition.indexOf("supabase.rpc('get_stage_readiness'");
const change=transition.indexOf("supabase.rpc('manage_game_stage'");
assert(preflight>=0&&change>preflight,'Fresh readiness must be fetched before closing any stage');
assert(transition.includes("action==='close'"),'Readiness check applies to stage closure, not parallel opening');
assert(transition.includes("typeof data.ready!=='boolean'"),'Invalid or failed verification must fail closed');
assert(transition.includes("window.confirm("),'Teacher must explicitly confirm the checked closure');
assert(!game.includes("supabase.rpc('set_game_stage'"),'Old stage switching RPC would complete unrelated stages');
assert(!teacher.includes("if(window.confirm('Перейти к следующему этапу?"),'Double confirmation must be removed');
const lifecycleSql=read('supabase/migrations/20261014045000_stage_parallel_lifecycle.sql');
const roundUpdates=lifecycleSql.match(/current_round=greatest\(current_round,coalesce\(v_next,current_round\)\)/g)||[];
assert.equal(roundUpdates.length,2,'Manual and automatic stage closure must not rewind the current stage');
assert(lifecycleSql.includes("pg_advisory_xact_lock(hashtextextended('stage-control:'||g,0))"),'Automatic stage expiry must use the same game-scoped lock as teacher controls');
const partySql=read('supabase/migrations/20261014044000_party_stage_one_democracy.sql');
const guardSql=read('supabase/migrations/20261014045500_enforce_closed_stage_submissions.sql');
assert(partySql.includes('drop policy if exists guests_cannot_delete on public.party_documents;'),
 'Obsolete guest document delete policy must not override owner-only access');
assert(guardSql.includes("p.leader_user_id is not null"), 'Student document upload requires elected party chair');
assert(partySql.includes("v_m.roster_archived_at is not null"), 'Archived users cannot found a new party');
assert(partySql.includes("gm.roster_archived_at is not null"), 'Archived members cannot receive new party invitations');
assert(partySql.includes("candidate.roster_archived_at is null"), 'Chair quorum and vote tally must exclude votes for archived candidates');
assert(partySql.includes("voter.roster_archived_at is null"), 'Chair quorum and vote tally must exclude archived voter ballots');
assert(guardSql.includes('before insert or delete on public.party_documents'),
 'Stage 1 completion must block deleting a party document as well as uploading it');
assert(guardSql.includes("v_game uuid:=case when tg_op='DELETE' then old.game_id else new.game_id end;"),
 'Stage guard must use OLD on DELETE without accessing NEW');


assert(css.includes('.stageReadinessWorkspace .stageReadinessGroup li p{font-size:14px'), 'Blockers must be readable');
assert(css.includes('.stageReadinessWorkspace .stageReadinessGroup header small{font-size:12px'), 'Small explanatory labels must be readable');

const workspace=read('components/game/GovernanceStageWorkspace.tsx');
assert(workspace.includes('const stageLocked=!isStageWorkOpen(g.game,stage);'),
 'Closed/expired stages must be read-only to participants in the stage workspace');
assert(workspace.includes('disabled={viewer||ksrfSessionBlocked}'),
 'Stage controls remain read-only for closed stages and also require approved KSRF meeting check-in');
const command=read('components/game/TeacherView.tsx');
assert(command.includes("const target=clockStage?.stage_no||stages.find(s=>s.status==='locked')?.stage_no"),
 'Teacher command must target the visible active stage, not an unrelated current_round');

console.log('PASS manual stage readiness, neutral unverified state, confirmed stage transition and larger text');
