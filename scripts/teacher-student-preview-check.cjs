'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const shell=fs.readFileSync('components/GameClient.tsx','utf8');
const grades=fs.readFileSync('components/game/GradesView.tsx','utf8');
const crisis=fs.readFileSync('components/game/CrisisRoom.tsx','utf8');
const governance=fs.readFileSync('components/game/GovernanceStageWorkspace.tsx','utf8');
assert(shell.includes("g.members.find(m=>m.kind==='student'&&!m.roster_archived_at)"),
 'Generic student preview must use a real active participant, not an invented role');
assert(shell.includes("offices.filter(o=>o.user_id===m.user_id&&o.status==='active')"),
 'Secondary offices must determine visual access');
assert(shell.includes("previewUserId={previewMode&&teacher&&previewStudent?.kind==='student'"),
 'Grade journal must identify the selected actual student');
assert(grades.includes("eq('user_id',safePreviewUserId).order('stage_no').limit(16)"),
 'One bounded student read per selected assessment type');
assert(grades.includes("useGameTableSync(authId===null||safePreviewUserId?undefined:game?.id"),
 'No recurring grade subscription during preview');
assert(grades.includes("const students=members.filter(m=>m.kind==='student'&&(!safePreviewUserId||m.user_id===safePreviewUserId))"),
 'Do not fake zero scores for other students in preview');
assert(shell.includes("<CrisisRoom g={vg} readOnly={previewMode||observer}/>"),
 'An active crisis must remain visible in student preview');
assert(crisis.includes('value={readOnly?myResponse?.action_plan||\'\':plan} disabled={readOnly}'),
 'Actual selected response text is shown without mutating it');
assert(governance.includes('<CrisisRoom g={g} readOnly={viewer}/>'),
 'Closed stage must not write through nested crisis panel');
assert(shell.includes("<ChatPanel g={vg} readOnly={previewMode||observer||!!previewGuest}"),
 'Preview chats cannot write messages under teacher identity');
for(const key of ['manageStage','voteForPartyChair','updatePartyStatistics','teacherManagePartyMember','deleteVote','deletePartyDocument','deleteFormalDocument','editChatMessage','setChatPin','markChatRead','setChatChannelPinned','sendRecordingPreview']){
 assert(new RegExp('\\b'+key+':blocked').test(shell),'Student preview must block inherited mutator '+key);
}
assert(shell.includes('chatOverview:[]'),'Teacher unread counts may not masquerade as student read state');
assert(shell.includes("const sectionBadge=(key:string)=>viewAs?0:"),'Preview does not display teacher badge counts');
console.log('PASS: teacher preview uses real student, role-aware read-only views, bounded grade reads, no new subscriptions or privileged writes');
