'use strict';
// Tests the actual React game hook with 100 independent synthetic identities.
// No Supabase production calls, no fake proof of real cloud capacity.
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
const {harness}=require('./republic-game-resilience-check.cjs');
const client=fs.readFileSync('components/GameClient.tsx','utf8');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
for(const [path,source,kind] of [
 ['components/GameClient.tsx',client,ts.ScriptKind.TSX],
 ['components/game/useRepublicGame.ts',hook,ts.ScriptKind.TS]
]){
 const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,kind);
 assert.equal(file.parseDiagnostics.length,0,'Updated game hook/client must parse');
}
assert(hook.includes("if(me.kind!=='teacher'&&activeView==='dashboard'&&lastCoreSuccessAt.current===0)return;"),
 'Student/observer dashboard must not eagerly fetch the full game entry');
assert(hook.includes("if(!me?.user_id||me.game_id!==gameId||!coreLoaded)return;"),
 'Only entered, data-ready clients may subscribe to Realtime and polling');
assert(hook.includes("openDetailedDashboard:()=>{if(authUser.current&&acceptedMember.current)void loadCoreForView()}"),
 'The player must be able to explicitly open a full overview');
assert(client.includes("view!=='dashboard'&&!g.coreLoaded&&!teacher&&sectionLoading()"),
 'Selected non-dashboard screens must wait for authorised core data, not render false empty values');
assert(client.includes("g.coreLoaded?gameId:undefined"),
 'Section unread SQL must stay inactive while the lightweight lobby is shown');
assert(client.includes("g.coreLoaded&&me?game?.id:undefined"),
 'Event counts must not read before opening game sections');
assert(client.includes("g.coreLoaded&&me?.kind==='student'"),
 'Blitz counts must not read before opening game sections');
assert(client.includes("g.coreLoaded&&me?.kind==='student'&&!previewMode"),
 'Blitz overlay must not mount enabled during minimal entry');
async function main(){
 const clients=Array.from({length:100},(_,i)=>{const h=harness({effects:true});h.setUser('student-'+i);return h});
 try{
  await Promise.all(clients.map(h=>h.settle()));
  for(let i=0;i<clients.length;i++){
   const h=clients[i],screen=h.render();
   assert(screen.me?.user_id==='student-'+i,'The identity returned must match this participant');
   assert.equal(screen.teacher,false);
   assert(screen.game,'Authenticated student must receive an actual game header');
   assert.equal(screen.coreLoaded,false,'No full game before opening a section');
   assert.equal(h.rpcCount('get_game_entry_v5'),0,'One of 100 students eagerly loaded the full game');
   assert.equal(h.rpcCount('get_my_game_identity'),1,'One authoritative identity read per participant');
   assert.equal(h.channelsInfo().length,0,'No unnecessary Realtime socket in the lightweight lobby');
  }
  // A selected section must read once, then retain its RLS-scoped data.
  const selected=clients.slice(0,8);
  selected.forEach((h,i)=>h.render().setActiveView(i%2?'votes':'profile'));
  await Promise.all(selected.map(h=>h.settle()));
  for(const h of selected){
   assert.equal(h.rpcCount('get_game_entry_v5'),1,'Open selected section only once');
   assert.equal(h.render().coreLoaded,true,'Selected section data must become available');
   assert(h.channelsInfo().length>=1,'Realtime activates for an opened game section');
  }
  for(const h of clients.slice(8))assert.equal(h.rpcCount('get_game_entry_v5'),0,'Inactive sessions remain lightweight');
  const explicit=clients[8];explicit.render().openDetailedDashboard();await explicit.settle();
  assert.equal(explicit.rpcCount('get_game_entry_v5'),1,'Full dashboard loads only when requested');
  assert(explicit.render().coreLoaded,'Full dashboard can open after lightweight entry');
  const guest=harness({effects:true});guest.setUser('teacher-a');guest.setMemberKind('observer');
  try{
   await guest.settle();
   assert.equal(guest.render().teacher,false);
   assert.equal(guest.rpcCount('get_game_entry_v5'),0,'Guest gets lightweight entry with strict role separation');
  }finally{guest.dispose()}
  const teacher=harness({effects:true});teacher.setUser('teacher-a');teacher.setMemberKind('teacher');
  try{
   await teacher.settle();
   assert.equal(teacher.render().teacher,true,'Teacher role remains authoritative');
   assert.equal(teacher.rpcCount('get_game_entry_v5'),1,'Teacher dashboard keeps required administration data');
  }finally{teacher.dispose()}
  console.log(JSON.stringify({result:'PASS',participants:100,authoritativeIdentityReads:100,
   initialFullGameReads:0,firstSectionOpens:8,firstSectionCoreReads:8,
   deliberateDashboardOpens:1,untouchedLightweightSessions:91,teacherUnchanged:true,
   observerProtected:true,productionCalls:0,scenario:'real game hook, simulated transport'}));
 }finally{clients.forEach(h=>h.dispose())}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1});
