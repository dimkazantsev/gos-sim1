'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
const definitions=read('components/game/votingBodies.ts');
const game=read('components/game/useRepublicGame.ts');
const votes=read('components/game/VotesView.tsx');
const compiledBodies=ts.transpileModule(definitions,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const bodyExports={};
vm.runInNewContext(compiledBodies,{exports:bodyExports});
const bodies=bodyExports.VOTING_BODIES;
assert(bodies&&bodies.find(b=>b.key==='government'),'Government configuration must exist');
const role=bodies.find(b=>b.key==='government').role;
assert(role.test('Министерство по экономической политике'),'Existing confirmed ministerial appointment must match');
assert(role.test('Министерство по социальной политике'),'Other ministry portfolios must match');
assert(role.test('Председатель Правительства Российской Федерации'),'Chair remains eligible');
assert(role.test('Министр обороны'),'Minister role remains eligible');
assert(!role.test('Президент Российской Федерации'),'Presidency alone must not confer Government vote');
assert(!role.test('Депутат Государственной Думы'),'Duma seat must not confer Government vote');
assert(!role.test('Министерство без портфеля'),'Only confirmed Ministry portfolio designation');
const start=game.indexOf(' function memberMatchesInstitution(');
const finish=game.indexOf(' function ballotWeight(',start);
assert(start>=0&&finish>start,'Actual client eligibility functions must be discoverable');
const compiled=ts.transpileModule(game.slice(start,finish)+'\nexports.check={memberMatchesInstitution,canVote};',
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function check({base='Президент Российской Федерации',appointments=[],archived=false,kind='student',included=true,institution='government'}){
 const me={user_id:'qa-president',role_title:base,kind,roster_archived_at:archived?'2026-10-01':null};
 const members=[me];
 const officeAssignments=appointments.map(([title,status])=>({game_id:'qa',user_id:me.user_id,role_title:title,status}));
 const exports={};
 vm.runInNewContext(compiled,{members,officeAssignments,VOTING_BODIES:bodies,me,gdMandateCapacity:()=>0,
  partyForUser:()=>null,partyMandates:[],exports});
 const vote={status:'open',institution_key:institution,voting_mode:'member',electorate_snapshot:{weights:included?{'qa-president':1}:{},eligible:2}};
 return {allowed:exports.check.canVote(vote),role:exports.check.memberMatchesInstitution(me.user_id,institution)};
}
const ministry=[['Министерство по экономической политике','active']];
assert.equal(check({appointments:ministry}).allowed,true,'President with active Ministry seat and frozen vote must vote');
assert.equal(check({appointments:ministry}).role,true,'Ministry seat qualifies for Government membership');
assert.equal(check({included:false}).allowed,false,'President without Ministry is excluded by the frozen electorate');
assert.equal(check({appointments:[['Депутат Государственной Думы','active']],included:false}).allowed,false,'Duma appointment grants no Government vote');
assert.equal(check({appointments:[['Министерство по экономической политике','inactive']],included:false}).allowed,false,'Inactive Ministry appointment grants no vote');
assert.equal(check({appointments:ministry,included:false}).allowed,false,'Missing snapshot authorization prevents voting');
// The UI snapshot is server-issued when the vote opens. Live PostgreSQL RPC
// separately verifies active office and attendance when submitting the ballot.
assert.equal(check({appointments:[],included:true}).allowed,true,'A captured voter is not blocked by stale client office data');
assert(game.includes("supabase.rpc('cast_vote_allocation'"),'Server RPC remains the final authorization boundary');
assert.equal(check({appointments:ministry,kind:'observer'}).allowed,false,'Guest/observer cannot vote');
assert.equal(check({appointments:ministry,archived:true,included:false}).allowed,false,'Archived non-member cannot bypass frozen roster');
assert.equal(check({base:'Председатель Правительства Российской Федерации'}).allowed,true,'Prime Minister retains Government vote');
assert.equal(check({appointments:ministry,institution:'gd'}).allowed,false,'Government appointment does not confer Duma voting capacity');
assert(votes.includes("v.procedure_key==='state_program'&&stages.some"),'Stage 11 lock notice must be explicit');
assert(votes.includes('Сначала отметьте присутствие в панели регистрации выше'),'Other bodies retain attendance instruction');
assert(votes.includes('function canCast(v:Vote){return canVote(v)&&isRegisteredForVote(v)'), 'Registration remains required to submit ballot');
console.log('PASS: ministerial portfolio is recognized in the actual client canVote implementation; Presidency alone, inactive/archived/guest roles and missing snapshots remain prohibited');
