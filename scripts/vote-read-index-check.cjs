'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
// Reference algorithms are the former useRepublicGame read calculations.
// Ballot admission and all writes remain in the existing server RPC.
function referenceBallots(ballots){return{
 cast:id=>ballots.filter(b=>b.vote_id===id).reduce((n,b)=>n+Number(b.weight),0),
 tally:id=>{const x=ballots.filter(b=>b.vote_id===id);const sum=choice=>x.reduce((a,b)=>a+Number(b[choice==='yes'?'yes_weight':choice==='no'?'no_weight':'abstain_weight']??(b.choice===choice?b.weight:0)),0);const yes=sum('yes'),no=sum('no'),abstain=sum('abstain');return {yes,no,abstain,total:yes+no+abstain}}
}}
function referenceMandates(members,allocations){return{
 effective:uid=>{const rows=allocations.filter(a=>a.user_id===uid);return rows.length?rows.reduce((n,a)=>n+Math.max(0,Number(a.effective_mandates)||0),0):null},
 capacity:uid=>{const totalBase=allocations.reduce((n,a)=>n+Math.max(0,Number(a.base_mandates)||0),0);if(totalBase>0)return allocations.filter(a=>a.user_id===uid).reduce((n,a)=>n+Math.max(0,Number(a.effective_mandates)||0),0);const roster=members.filter(m=>m.kind==='student'&&!m.roster_archived_at).sort((a,b)=>String(a.joined_at||'').localeCompare(String(b.joined_at||''))||a.user_id.localeCompare(b.user_id));const rank=roster.findIndex(m=>m.user_id===uid);return rank<0?0:Math.floor(450/roster.length)+(rank<450%roster.length?1:0)}
}}
const baseline=process.argv.includes('--baseline');
const exportsModel={};
if(!baseline){const source=fs.readFileSync('components/game/voteReadIndex.ts','utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports',code)(exportsModel)}
const createBallots=baseline?referenceBallots:exportsModel.createBallotReadIndex;
const createMandates=baseline?referenceMandates:exportsModel.createMandateReadIndex;
const members=Array.from({length:100},(_,i)=>({user_id:'user-'+i,kind:'student',joined_at:'2026-10-'+String(i%28+1).padStart(2,'0')}));
members.push({user_id:'teacher',kind:'teacher'},{user_id:'observer',kind:'observer'},{user_id:'archived',kind:'student',roster_archived_at:'2026-10-01'});
const ballots=Array.from({length:4000},(_,i)=>{const choice=['yes','no','abstain'][i%3];const weight=i%7+1;return {vote_id:'vote-'+Math.floor(i/100),voter_id:'user-'+i%100,choice,weight,...(i%2?{yes_weight:i%4,no_weight:0,abstain_weight:1}:{yes_weight:null,no_weight:null,abstain_weight:null})}});
const allocations=members.slice(0,100).flatMap((m,i)=>[{user_id:m.user_id,base_mandates:5,effective_mandates:i%5},...(i%7===0?[{user_id:m.user_id,base_mandates:1,effective_mandates:1}]:[])]);
const voteIds=[...Array.from({length:40},(_,i)=>'vote-'+i),'missing'];
const users=[...members.map(m=>m.user_id),'missing'];
for(const rows of [[],ballots,[{vote_id:'vote-0',weight:0,choice:'yes',yes_weight:0},{vote_id:'vote-0',weight:2,choice:'no',no_weight:null},{vote_id:'vote-1',weight:NaN,choice:'abstain'}]]){
 const old=referenceBallots(rows),next=createBallots(rows);
 for(const id of voteIds){assert.equal(next.cast(id),old.cast(id));assert.deepEqual(next.tally(id),old.tally(id))}
 // Do not expose mutable cached objects to the UI.
 const a=next.tally('vote-0');a.yes=999;assert.deepEqual(next.tally('vote-0'),old.tally('vote-0'));
}
for(const rows of [[],allocations,[{user_id:'user-0',base_mandates:0,effective_mandates:0}], [{user_id:'user-0',base_mandates:5,effective_mandates:-3},{user_id:'user-0',base_mandates:1,effective_mandates:2}]]){
 const old=referenceMandates(members,rows),next=createMandates(members,rows);
 for(const uid of users){assert.equal(next.capacity(uid),old.capacity(uid));assert.equal(next.effective(uid),old.effective(uid))}
}
assert.equal(createMandates(members,[]).effective('user-0'),null,'A cold mandate projection must not invent an effective weight');
assert.equal(createMandates(members,[{user_id:'user-0',base_mandates:5,effective_mandates:0}]).effective('user-0'),0,'Known zero remains distinct from missing data');
let ballotVisits=0,mandateVisits=0;
const countedBallots=ballots.map(b=>({...b,get vote_id(){ballotVisits++;return b.vote_id}}));
const countedAllocations=allocations.map(a=>({...a,get base_mandates(){mandateVisits++;return a.base_mandates}}));
const b=createBallots(countedBallots),m=createMandates(members,countedAllocations);
assert.equal(ballotVisits,0,'No ballot indexing until a voting read');assert.equal(mandateVisits,0,'No mandate indexing until a voting read');
for(let render=0;render<3;render++){
 for(const id of voteIds){b.cast(id);b.tally(id)}
 for(const uid of users){m.capacity(uid);m.effective(uid)}
}
const measured={ballots:ballots.length,ballotVisits,mandateRows:allocations.length,mandateVisits,voteIds:voteIds.length,users:users.length,passes:3};
console.log(JSON.stringify(measured));
assert.equal(ballotVisits,ballots.length,'Each ballot is visited only once across repeated vote reads');
assert.equal(mandateVisits,allocations.length,'Each mandate allocation is visited only once across repeated voter reads');
console.log('PASS: identical tally/cast/capacity/effective calculations; lazy indexes, immutable outputs and bounded traversal.');

if(!baseline){
 const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
 assert(hook.includes('useMemo(()=>createBallotReadIndex(ballots),[ballots])'));
 assert(hook.includes('useMemo(()=>createMandateReadIndex(members,partyMandates),[members,partyMandates])'));
 assert(hook.includes('cast=ballotReadIndex.cast(v.id)')&&hook.includes('return ballotReadIndex.tally(v.id)'));
 assert(hook.includes('return mandateReadIndex.capacity(uid)')&&hook.includes('mandateReadIndex.effective(r.user_id)'));
 assert(hook.includes("supabase.rpc('cast_vote_allocation'"),'Authoritative server admission and write unchanged');
}

// Read-side institution eligibility must remain identical to the pre-index hook.
if(!baseline){
 const votingBodiesModule={};
 new Function('exports',ts.transpileModule(fs.readFileSync('components/game/votingBodies.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(votingBodiesModule);
 const VOTING_BODIES=votingBodiesModule.VOTING_BODIES;
 function referenceInstitution(members,officeAssignments){
 function memberMatchesInstitution(uid,institution){
  const m=members.find(x=>x.user_id===uid);if(!m||m.kind==='observer')return false;
  const role=(m.role_title||'').trim();
  if(institution==='all'||institution==='factions')return m.kind==='student'||(m.kind==='teacher'&&!['','Руководитель симуляции','Преподаватель','Администратор'].includes(role));
  if(institution==='ksrf'&&m.kind==='student')return true;
  const body=VOTING_BODIES.find(b=>b.key===institution);
  return !!body&&(body.role.test(role)||(m.kind==='student'&&officeAssignments.some(o=>o.user_id===uid&&o.status==='active'&&body.role.test(o.role_title))));
 }

  return memberMatchesInstitution;
 }
 const roster=Array.from({length:100},(_,i)=>({user_id:'u'+i,kind:i%13===0?'observer':i%11===0?'teacher':'student',role_title:['Депутат','Сенатор','Министр','Преподаватель',''][i%5]}));
 const offices=roster.flatMap((m,i)=>[{user_id:m.user_id,status:i%3?'active':'inactive',role_title:'Министр'},{user_id:m.user_id,status:'active',role_title:'Депутат'}]);
 let memberVisits=0,officeVisits=0;
 const countedMembers=roster.map(m=>({...m,get user_id(){memberVisits++;return m.user_id}}));
 const countedOffices=offices.map(o=>({...o,get user_id(){officeVisits++;return o.user_id}}));
 const old=referenceInstitution(roster,offices),next=exportsModel.createInstitutionReadIndex(countedMembers,countedOffices,VOTING_BODIES);
 assert.equal(memberVisits+officeVisits,0,'No indexing on unused voting screens');
 let cases=0;
 for(const uid of [...roster.map(m=>m.user_id),'missing'])for(const key of ['all','factions','unknown',...VOTING_BODIES.map(b=>b.key)]){
  assert.equal(next(uid,key),old(uid,key),uid+' '+key);cases++;
 }
 assert.equal(memberVisits,roster.length);
 assert.equal(officeVisits,offices.filter(o=>o.status==='active').length);
 const duplicate=[{user_id:'d',kind:'observer',role_title:'Министр'},{user_id:'d',kind:'student',role_title:'Министр'}];
 assert.equal(exportsModel.createInstitutionReadIndex(duplicate,[],VOTING_BODIES)('d','government'),false,'First roster entry wins as with find');
 const inactive=[{user_id:'u',kind:'student',role_title:''}];
 assert.equal(exportsModel.createInstitutionReadIndex(inactive,[{user_id:'u',status:'inactive',role_title:'Министр'}],VOTING_BODIES)('u','government'),false);
 assert.equal(exportsModel.createInstitutionReadIndex(inactive,[{user_id:'u',status:'active',role_title:'Министр'}],VOTING_BODIES)('u','government'),true);
 const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
 assert(hook.includes('useMemo(()=>createInstitutionReadIndex(members,officeAssignments,VOTING_BODIES),[members,officeAssignments])'));
 assert(hook.includes('return institutionReadIndex(uid,institution)'));
 console.log(JSON.stringify({institutionCases:cases,memberVisits,officeVisits}));
 console.log('PASS: identical scoped roster/appointment eligibility, lazy indexes, inactive and duplicate cases.');
}
