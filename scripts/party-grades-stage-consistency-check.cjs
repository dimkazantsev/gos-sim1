/* Stage 1 status, party consent and grade layout regression. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript'),Module=require('node:module');
const file='components/game/stageWorkStatus.ts',mod=new Module(file,module);
mod.filename=file;mod.paths=module.paths;mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const {isStageWorkOpen,stageWorkLabel}=mod.exports;
const future=new Date(Date.now()+3600000).toISOString(),past=new Date(Date.now()-60000).toISOString();
const game={id:'g',status:'lobby',turn_open:false,turn_ends_at:null};
const stage={game_id:'g',stage_no:1,status:'open',deadline:null};
assert.equal(isStageWorkOpen(game,stage),false,'Stale open stage in lobby must be blocked');
assert.equal(stageWorkLabel(game,stage),'Этап ещё не открыт');
game.status='running';game.turn_open=true;
assert.equal(isStageWorkOpen(game,stage),true,'Teacher opening the game permits stage work');
assert.equal(stageWorkLabel(game,stage),'Этап открыт');
stage.deadline=past;assert.equal(isStageWorkOpen(game,stage),false,'Expired stage blocks writes');
stage.deadline=future;game.turn_ends_at=past;assert.equal(isStageWorkOpen(game,stage),false,'Expired turn blocks writes');
game.turn_ends_at=future;stage.status='completed';assert.equal(isStageWorkOpen(game,stage),false,'Completed stage remains closed');
const party=fs.readFileSync('components/game/PartiesView.tsx','utf8');
const election=fs.readFileSync('components/game/PartyChairElection.tsx','utf8');
const workspace=fs.readFileSync('components/game/GovernanceStageWorkspace.tsx','utf8');
const stages=fs.readFileSync('components/game/StagesView.tsx','utf8');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const sql=fs.readFileSync('supabase/migrations/20261014072000_stage_one_party_consent_and_gate.sql','utf8');
const css=fs.readFileSync('app/2026-stage-party-grades-repair.css','utf8');
const layout=fs.readFileSync('app/layout.tsx','utf8');
assert(party.includes('partyFormationOpen=isStageWorkOpen(g.game,stageOne)'), 'Party creation checks actual game and stage status');
assert(party.includes('canInvite=partyFormationOpen'), 'Invitations must wait for open stage');
const invitationMarker='data-party-invite-panel';
const invitePosition=party.indexOf(invitationMarker);
const rosterPosition=party.indexOf('className="civicPartyRoster"');
assert(invitePosition!==-1&&rosterPosition!==-1&&invitePosition<rosterPosition,
 'Invitation panel must precede party roster in DOM order on all viewport sizes');
assert(party.indexOf(invitationMarker,invitePosition+1)===-1,
 'Invitation panel must be rendered only once');
assert(party.includes('inviteClosed=!!selected?.leader_user_id'), 'An elected party chair closes new invitations in the visible form');
assert(party.includes('disabled={busy||inviteClosed}')&&party.includes('disabled={!inviteUser||busy||inviteClosed}'), 'Closed invitations disable both student selector and submit button');
assert(party.includes('Приём приглашений завершён: председатель партии уже избран.'), 'Reason for disabled party invitation must be visible');
assert(party.includes('role={inviteFeedback.kind===\'error\'?\'alert\':\'status\'}'), 'Server errors and invitation success must appear in the form');
assert(party.includes('Приглашение отправлено: ')&&party.includes('sendPartyInvite()'), 'Successful invitations give a visible confirmation');
assert(hook.includes('onFailure?.(r.error.message)')&&hook.includes("supabase.rpc('invite_to_party'"), 'RPC failure is passed to the invitation form without bypassing authorization');
assert(party.includes("m.kind==='student'&&!m.roster_archived_at&&!m.team"),'Invitations exclude teachers, guests and archived users');
assert(election.includes('members.length>=2&&pending.length===0'), 'Only consenting members can vote');
assert(election.includes('gosPartyElectionSteps')&&election.includes('votesCast'), 'Styled status and vote counters');
assert(workspace.includes('stageWorkLabel(g.game,stage)')&&stages.includes('stageWorkLabel(g.game,s)'), 'Unified status in workspace and atlas');
assert(sql.includes("private.stage_one_party_active(p.game_id)"),'Server-side stage guard');
assert(sql.includes("gm.kind<>'student' or gm.roster_archived_at is not null"),'Only active students may accept invitations');
assert(sql.includes("count(*) from public.game_members gm")&&sql.includes("pi.status='pending'"),'No lone-founder elections or unanswered invitations');
assert(sql.includes('enforce_party_dossier_stage'),'Dossier stage guard before insert');
assert(css.includes('grid-template-columns:minmax(260px,1fr) 74px 80px repeat(16,56px)'),'18 aligned score columns');
assert(css.includes('overflow-x:auto'),'Horizontal scroll stays inside matrix');
assert(css.includes('.gradeModal .blitzVsnBreakdown'),'Breakdown is a grid, not loose lines');
assert(layout.includes("import './2026-stage-party-grades-repair.css';"),'Repair CSS is loaded');
assert(hook.includes('await refresh();notifyGameDataRefresh(gameId);return true;'),'Membership acceptance updates UI immediately');
console.log('PASS stage status and expiry, consent-first election, roles and counts, grade matrix, modal, and style scope');
