'use strict';
// The exact production UI role resolver, exercised without network or live row writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync('components/game/stageRoles.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const m={exports:{}};new Function('exports','module',js)(m.exports,m);
const {activeGameRoleTitles,hasActiveGameRole,stageRoleTitles,relevantStageRoleTitle,currentGameStageNumber,currentStageRoleTitle}=m.exports;
const game='game-one',uid='student-a';
const member={user_id:uid,game_id:game,kind:'student',role_title:'Депутат Государственной Думы',roster_archived_at:null};
const office=(id,role,status='active',game_id=game,user_id=uid)=>({id,game_id,user_id,status,role_title:role});
const g={
 game:{id:game},me:member,members:[member],
 officeAssignments:[
  office('a','Депутат Государственной Думы'),
  office('b','Заместитель Председателя Государственной Думы №1'),
  office('c','Председатель Правительства Российской Федерации'),
  office('d','Член КСРФ'),
  office('e','Председатель Правительства иностранной игры','active','another-game'),
  office('f','Президент Российской Федерации','ended'),
  office('g','Председатель Правительства Российской Федерации','pending','game-one','student-b')
 ]
};
const titles=activeGameRoleTitles(g);
const stageFixture={...g,stages:[{stage_no:10,status:'open',deadline:'2026-11-22T10:00:00Z'},{stage_no:11,status:'open',deadline:'2026-11-23T10:00:00Z'}],currentStage:{stage_no:10,status:'open'},game:{id:game,current_round:10}};
assert.equal(currentGameStageNumber(stageFixture),10,'Current stage is the one shown in the teacher clock');
assert.equal(currentStageRoleTitle(stageFixture,uid),'Председатель Правительства Российской Федерации','PM title must replace primary deputy title at stage 10');
assert.equal(currentStageRoleTitle(stageFixture,uid,11),'Председатель Правительства Российской Федерации','PM chairs the government session at stage 11');
assert.equal(relevantStageRoleTitle(titles,4),'Заместитель Председателя Государственной Думы №1','Duma leadership is shown during Duma formation');
assert.equal(relevantStageRoleTitle(titles,2),'Член КСРФ','Coordination council is shown during council stages');
assert.equal(relevantStageRoleTitle(titles,12),'Заместитель Председателя Государственной Думы №1','Duma position applies during the legislative stage');
assert.equal(relevantStageRoleTitle(titles,16),'Депутат Государственной Думы','No stage-specific office matches the final debrief, so use primary role');
assert.equal(relevantStageRoleTitle(['Депутат Государственной Думы'],10),'Депутат Государственной Думы','Never invent an office that is not appointed');
assert.equal(currentStageRoleTitle({...stageFixture,officeAssignments:[office('c','Председатель Правительства Российской Федерации','ended')]},uid),'Депутат Государственной Думы','Ended PM appointment must not be displayed');

assert.deepEqual(titles,[
 'Депутат Государственной Думы',
 'Заместитель Председателя Государственной Думы №1',
 'Председатель Правительства Российской Федерации',
 'Член КСРФ'
]);
const pm=/^председатель\s+правительства(?:\s|$)/u;
assert.equal(hasActiveGameRole(g,pm),true,'An actively appointed PM retains approval controls while primary role is deputy');
assert.match(stageRoleTitles(g),/председатель правительства российской федерации/);
assert.equal(hasActiveGameRole(g,/^президент/i),false,'Ended appointments must not grant controls');
assert.equal(activeGameRoleTitles({...g,game:{id:'another-game'}}).length,0,'Office roles must be game scoped');
assert.equal(activeGameRoleTitles({...g,me:{...member,roster_archived_at:'2026-11-20'}}).length,4,'Live roster row stays authoritative');
assert.equal(activeGameRoleTitles({...g,members:[],me:{...member,roster_archived_at:'2026-11-20'}}).length,0,'Archived actor cannot inherit active office titles');
assert.equal(activeGameRoleTitles({...g,me:{...member,kind:'observer'},members:[{...member,kind:'observer'}]}).length,0,'Observer has no office rights');
const profile=fs.readFileSync('components/game/ProfileView.tsx','utf8');
const shell=fs.readFileSync('components/GameClient.tsx','utf8');
const overview=fs.readFileSync('components/game/DashboardView.tsx','utf8');
const stage=fs.readFileSync('components/game/GovernanceStageWorkspace.tsx','utf8');
const government=fs.readFileSync('components/game/GovernmentProgramSessionLab.tsx','utf8');
const lab=fs.readFileSync('components/game/StateProgramLab.tsx','utf8');
const offices=fs.readFileSync('components/game/ProfileOffices.tsx','utf8');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const style=fs.readFileSync('app/2026-stage-system.css','utf8');
const dossier=fs.readFileSync('components/game/TeacherPartyDossiers.tsx','utf8');
const roster=fs.readFileSync('components/game/TeacherParticipantRoster.tsx','utf8');
const analytics=fs.readFileSync('components/game/ParticipantsAnalytics.tsx','utf8');
const gradeRows=fs.readFileSync('components/game/GradesView.tsx','utf8');
assert(profile.includes("targetRoles.join(' · ')")&&profile.includes('Действующие должности'),'Profile cannot hide secondary office roles');
assert(shell.includes('completeRoleTitle')&&shell.includes('compactRoleTitle')&&shell.includes('simUserText')&&shell.includes('mobileAccount'),'All primary account chrome displays the secondary PM appointment');
assert(overview.includes('activeGameRoleTitles(g,me.user_id)')&&overview.includes('primeOffice'),'The game dashboard must show PM duties, not only the primary deputy role');
assert(stage.includes('stageOperationsRoleContext')&&stage.includes('primeOffice'),'Stages 10–11 must show current executive authority');
assert(lab.includes('hasActiveGameRole(g,')&&government.includes('hasActiveGameRole(g,'),'Program actions must share the office resolver');
assert(offices.includes('hasActiveGameRole(g,'),'Office nomination UI must respect multiple active roles');
assert(hook.includes('refreshOfficeAssignments:()=>loadRepublicOffices(true)'),'Manual roles refresh must reuse shared office snapshot');
assert(hook.includes("officeAssignments.filter(o=>o.user_id===me.user_id&&o.status==='active')"),'Available actors must include secondary offices');
assert(style.includes('.stageOperationsRoleContext')&&style.includes('@media(max-width:560px)'),'Role display must remain responsive');
assert(dossier.includes('relevantStageRoleTitle(titles,activeStageNo)')&&dossier.includes('currentGameStageNumber(g)'),'Teacher faction roster must show the office relevant to the current stage');
assert(roster.includes('currentStageRoleTitle(g,e.user_id)'),'Teacher participant access list must show active stage role');
assert(analytics.includes('currentStageRoleTitle(g,r.m.user_id)'),'Teacher analytics must show active stage role');
assert(gradeRows.includes('currentStageRoleTitle(g,s.user_id)'),'Teacher grade list must show active stage role');
assert(hook.includes("'participants','analytics','grades'"),'Teacher screens hydrate the shared office snapshot only when opened');
console.log('PASS: primary deputy + PM + Duma vice chair + court membership; game/RLS parity; profile/stage/PM controls and responsive styles');
