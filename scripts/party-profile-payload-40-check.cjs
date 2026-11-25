/* ГОС.ID · Step 8.3. Pure synthetic PostgREST / React hook; no production traffic. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const {harness}=require('./republic-game-resilience-check.cjs');
const source=fs.readFileSync('components/game/partyProfileSummary.ts','utf8');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const mod={exports:{}},code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext('(function(module,exports){'+code+'})',{})(mod,mod.exports);
const {PARTY_LIST_COLUMNS,PROFILE_ASSET_COLUMNS,normalizePartyRows,mergeProfileAssetRows,retainProfileLinks}=mod.exports;
assert(!PARTY_LIST_COLUMNS.includes('registration_note')&&!PARTY_LIST_COLUMNS.includes('description')&&!PARTY_LIST_COLUMNS.includes('ideology'));
assert(!PROFILE_ASSET_COLUMNS.split(',').includes('bio'));
assert(PARTY_LIST_COLUMNS.includes('registration_status')&&PARTY_LIST_COLUMNS.includes('ghost_loss_current')&&PARTY_LIST_COLUMNS.includes('mandates'));
assert(hook.includes("const MEMBER_ROSTER_COLUMNS='game_id,user_id,full_name,group_name,kind,role_title,team,score,joined_at,party_joined_at,roster_archived_at'"));
assert(hook.includes("if(needFull&&!cache.inflightFull)return cache.inflight.then(()=>loadCachedParties(false))"));
const party=(id)=>({
 id,game_id:'game-a',created_by:'teacher-a',name:'Партия '+id,
 ideology:'Идеология',description:'Описание партии '+id,
 registration_note:'Регистрационное замечание '.repeat(350),
 support:25,mandates:10,regions:3,budget:25000,leader_user_id:'student-a',
 color:'#606060',logo_path:null,created_at:'2026-10-25T00:00:00Z',
 ghost_loss_current:0,ghost_active:false,ghost_started_at:null,
 representation_penalty:0,regional_seat_penalty:0,ghost_risk_weight:0,
 presidential_rating_modifier:0,registration_status:'submitted',registration_submitted_at:null,
 registration_reviewed_at:null,registration_reviewed_by:null,mandate_allocation_mode:'equal',
 regional_seats_awarded:0,rating:8
});
const profile=id=>({game_id:'game-a',user_id:id,bio:'Биография '.repeat(150),avatar_path:null,signature_path:null,
 updated_at:'2026-10-25T00:00:00Z',gender:'male',onboarding_completed_at:null,intro_seen_at:null});
const parties=[party('a'),party('b')],profiles=[profile('student-a'),profile('student-b')];
const take=(rows,cols)=>rows.map(r=>Object.fromEntries(cols.split(',').map(k=>[k,r[k]])));
const fullPartyBytes=Buffer.byteLength(JSON.stringify(parties)),litePartyBytes=Buffer.byteLength(JSON.stringify(take(parties,PARTY_LIST_COLUMNS)));
const fullProfilesBytes=Buffer.byteLength(JSON.stringify(profiles)),liteProfilesBytes=Buffer.byteLength(JSON.stringify(take(profiles,PROFILE_ASSET_COLUMNS)));
assert(litePartyBytes<fullPartyBytes*0.2,'Party registration note dominates only the full dossier');
assert(liteProfilesBytes<fullProfilesBytes*0.6,'Party screen need not transfer biography');
const normalized=normalizePartyRows(take(parties,PARTY_LIST_COLUMNS),false);
assert.equal(normalized[0].registration_note,null);
assert.equal(normalized[0].ideology,null);
assert.equal(normalized[0].mandates,10);
assert.equal(normalized[0].registration_status,'submitted');
assert.equal(normalized[0].ghost_loss_current,0);
assert.equal(normalizePartyRows(parties,true)[0].registration_note,parties[0].registration_note);
const cached=mergeProfileAssetRows(profiles,take(profiles,PROFILE_ASSET_COLUMNS));
assert.equal(cached[0].bio,profiles[0].bio,'A matching version can preserve an already authorized bio');
const changed=mergeProfileAssetRows(profiles,[{...take(profiles,PROFILE_ASSET_COLUMNS)[0],updated_at:'2026-10-31T12:00:00Z'}]);
assert.equal(changed[0].bio,null,'A changed user bio cannot remain stale');
assert.equal(mergeProfileAssetRows(profiles,[]).length,0,'Revoked profiles disappear');


 // Compare all three former signed-link reconciliation paths, including
 // duplicate prior IDs, changed paths, missing links, and empty projections.
 const referenceLinks=(previous,rows,normalize)=>rows.map(row=>{
  const old=previous.find(p=>p.user_id===row.user_id);
  const avatar=old?.avatar_path===row.avatar_path?old?.avatar_url:null;
  const signature=old?.signature_path===row.signature_path?old?.signature_url:null;
  return {...row,avatar_url:normalize?avatar||null:avatar,signature_url:normalize?signature||null:signature};
 });
 const prior=Array.from({length:100},(_,i)=>({...profile('u-'+i),avatar_path:'p-'+i,avatar_url:i%7===0?'':'a-'+i,signature_path:i%3===0?'sig-'+i:null,signature_url:i%4===0?undefined:'s-'+i}));
 const fresh=prior.map((row,i)=>({...profile(row.user_id),avatar_path:i%5===0?'new-'+i:row.avatar_path,signature_path:i%6===0?'new-s-'+i:row.signature_path}));
 const mixed=[...prior,{...prior[0],avatar_url:'wrong-second-row',signature_url:'wrong-second-row'}];
 const variants=[fresh,[{...fresh[1],avatar_path:prior[1].avatar_path},...fresh.slice(2,5),{...profile('new'),avatar_path:undefined,signature_path:undefined}],[]];
 for(const normalize of [false,true])for(const rows of variants){
  const expected=referenceLinks(mixed,rows,normalize),actual=retainProfileLinks(mixed,rows,normalize);
  assert.equal(actual.length,expected.length);
  for(let i=0;i<rows.length;i++){
   assert.equal(JSON.stringify(actual[i]),JSON.stringify(expected[i]));
   for(const key of ['avatar_url','signature_url']){
    assert.equal(Object.hasOwn(actual[i],key),true);
    assert.equal(actual[i][key],expected[i][key]);
   }
  }
 }
 assert.equal(retainProfileLinks(mixed,[{...prior[0]}])[0].avatar_url,'','First prior row wins');
 let priorReads=0;
 const measured=prior.map(row=>({...row,get user_id(){priorReads++;return row.user_id}}));
 retainProfileLinks(measured,fresh);
 assert(priorReads<=100,'100 prior profile identifiers should be read once, not searched per row: '+priorReads);
 assert.equal((hook.match(/retainProfileLinks\(previous,/g)||[]).length,3,'All three existing profile merge paths must use the index');
 console.log(JSON.stringify({profileRows:100,priorIdentifierReads:priorReads,scope:'synthetic signed-link reconciliation; no network'}));

async function main(){
 const clients=Array.from({length:40},(_,i)=>{const h=harness({effects:true});h.setUser('student-'+i);h.fixture('game_parties',parties);h.fixture('game_profiles',profiles);return h});
 try{
  await Promise.all(clients.map(h=>h.settle()));
  let reducedRequests=0;
  for(const h of clients){
   assert.equal(h.rpcCount('get_game_entry_v5'),0,'No full party/roster query before the student selects a section');
   assert.equal(h.render().coreLoaded,false);
  }
  // Explicitly choosing the full dashboard is the only trigger for the
  // lightweight party-summary projection in the initial screen.
  await Promise.all(clients.map(async h=>{h.render().openDetailedDashboard();await h.settle()}));
  for(const h of clients){
   const q=h.stats().queryLog.filter(x=>x.table==='game_parties');
   assert.equal(q.length,0,'Overview uses RLS-scoped lightweight parties inside entry v5, not separate reads');
   assert.equal(h.rpcCount('get_game_entry_v5'),1,'Only one scoped entry RPC per student');
   assert.equal(h.rpcCount('get_game_entry_v4'),0,'Never fall back when v5 is available');
   reducedRequests+=q.length;
   assert.equal(h.render().parties[0].registration_note,null);
   assert.equal(h.render().parties[0].mandates,10);
  }
  assert.equal(reducedRequests,0,'40 virtual students make no separate party-summary requests');

  const student=clients[0];
  student.render().setActiveView('parties');await student.settle();
  const partyQueries=student.stats().queryLog.filter(x=>x.table==='game_parties');
  assert(partyQueries.some(x=>x.columns==='*'),'Navigating into Parties restores complete records');
  assert.equal(student.render().parties[0].registration_note,parties[0].registration_note,'Registration note remains visible in Parties');
  const avatarQueries=student.stats().queryLog.filter(x=>x.table==='game_profiles');
  assert(avatarQueries.some(x=>x.columns===PROFILE_ASSET_COLUMNS),'Parties requests only avatar and signature metadata');
  assert(student.render().profiles.every(x=>x.bio===null),'Party screen does not read biographies without full profile');

  student.render().setActiveView('profile');await student.settle();
  assert(student.stats().queryLog.some(x=>x.table==='game_profiles'&&x.columns==='*'),'A profile view still retrieves biography');
  assert.equal(student.render().profiles[0].bio,profiles[0].bio,'Profile biography remains available');

  const teacher=harness({effects:true});teacher.setMemberKind('teacher');teacher.fixture('game_parties',parties);await teacher.settle();
  teacher.render().setActiveView('teacher');await teacher.settle();
  assert(!teacher.stats().queryLog.some(x=>x.table==='game_parties'&&x.columns==='*'),'Overview must not fetch party dossiers');
  await teacher.render().hydrateTeacherWorkspace('parties');await teacher.settle();
  assert(teacher.stats().queryLog.some(x=>x.table==='game_parties'&&x.columns==='*'),'Teacher dossiers get full registration notes');
  assert.equal(teacher.render().parties[0].registration_note,parties[0].registration_note);
  teacher.dispose();

  const observer=harness({effects:true});observer.setMemberKind('observer');observer.fixture('game_parties',parties);await observer.settle();
  assert.equal(observer.render().parties.length,0,'Guest does not load the party roster just by signing in');
  observer.render().setActiveView('stages');await observer.settle();
  assert.equal(observer.render().parties[0].registration_note,null,'Guest retains the stripped party projection after opening a section');
  observer.dispose();
  console.log(JSON.stringify({status:'PASS',simulatedClients:40,partyFullBytes:fullPartyBytes,partySummaryBytes:litePartyBytes,partyReductionPct:Math.round((1-litePartyBytes/fullPartyBytes)*1000)/10,profileFullBytes:fullProfilesBytes,profileSummaryBytes:liteProfilesBytes,profileReductionPct:Math.round((1-liteProfilesBytes/fullProfilesBytes)*1000)/10,partyReads:reducedRequests,teacherFullDossier:true,profileBiography:true,environment:'synthetic clients with mocked Supabase; not real network'}));
 }finally{clients.forEach(h=>h.dispose())}
}
main().catch(e=>{console.error(e);process.exitCode=1});
