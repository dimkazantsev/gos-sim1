'use strict';
// The exact production UI role resolver, exercised without network or live row writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync('components/game/stageRoles.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const m={exports:{}};new Function('exports','module',js)(m.exports,m);
const {activeGameRoleTitles,hasActiveGameRole,stageRoleTitles}=m.exports;
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
const stage=fs.readFileSync('components/game/GovernanceStageWorkspace.tsx','utf8');
const government=fs.readFileSync('components/game/GovernmentProgramSessionLab.tsx','utf8');
const lab=fs.readFileSync('components/game/StateProgramLab.tsx','utf8');
const offices=fs.readFileSync('components/game/ProfileOffices.tsx','utf8');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const style=fs.readFileSync('app/2026-stage-system.css','utf8');
assert(profile.includes("targetRoles.join(' · ')")&&profile.includes('Действующие должности'),'Profile cannot hide secondary office roles');
assert(stage.includes('stageOperationsRoleContext')&&stage.includes('primeOffice'),'Stages 10–11 must show current executive authority');
assert(lab.includes('hasActiveGameRole(g,')&&government.includes('hasActiveGameRole(g,'),'Program actions must share the office resolver');
assert(offices.includes('hasActiveGameRole(g,'),'Office nomination UI must respect multiple active roles');
assert(hook.includes('refreshOfficeAssignments:()=>loadRepublicOffices(true)'),'Manual roles refresh must reuse shared office snapshot');
assert(hook.includes("officeAssignments.filter(o=>o.user_id===me.user_id&&o.status==='active')"),'Available actors must include secondary offices');
assert(style.includes('.stageOperationsRoleContext')&&style.includes('@media(max-width:560px)'),'Role display must remain responsive');
console.log('PASS: primary deputy + PM + Duma vice chair + court membership; game/RLS parity; profile/stage/PM controls and responsive styles');
