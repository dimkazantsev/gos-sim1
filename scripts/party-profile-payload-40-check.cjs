/* ГОС.ID · Step 8.3. Pure synthetic PostgREST / React hook; no production traffic. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const {harness}=require('./republic-game-resilience-check.cjs');
const source=fs.readFileSync('components/game/partyProfileSummary.ts','utf8');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const mod={exports:{}},code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext('(function(module,exports){'+code+'})',{})(mod,mod.exports);
const {PARTY_LIST_COLUMNS,PROFILE_ASSET_COLUMNS,normalizePartyRows,mergeProfileAssetRows}=mod.exports;
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

async function main(){
 const clients=Array.from({length:40},(_,i)=>{const h=harness({effects:true});h.setUser('student-'+i);h.fixture('game_parties',parties);h.fixture('game_profiles',profiles);return h});
 try{
  await Promise.all(clients.map(h=>h.settle()));
  let reducedRequests=0;
  for(const h of clients){
   const q=h.stats().queryLog.filter(x=>x.table==='game_parties');
   assert(q.some(x=>x.columns===PARTY_LIST_COLUMNS),'Overview uses RLS-scoped lightweight party rows');
   assert(q.every(x=>x.eqs.game_id==='game-a'),'No cross-game party reads');
   reducedRequests+=q.filter(x=>x.columns===PARTY_LIST_COLUMNS).length;
   assert.equal(h.render().parties[0].registration_note,null);
   assert.equal(h.render().parties[0].mandates,10);
  }
  assert.equal(reducedRequests,40,'40 virtual students each request one cached party summary');

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
  assert(teacher.stats().queryLog.some(x=>x.table==='game_parties'&&x.columns==='*'),'Teacher dossiers get full registration notes');
  assert.equal(teacher.render().parties[0].registration_note,parties[0].registration_note);
  teacher.dispose();

  const observer=harness({effects:true});observer.setMemberKind('observer');observer.fixture('game_parties',parties);await observer.settle();
  assert.equal(observer.render().parties[0].registration_note,null);
  observer.dispose();
  console.log(JSON.stringify({status:'PASS',simulatedClients:40,partyFullBytes:fullPartyBytes,partySummaryBytes:litePartyBytes,partyReductionPct:Math.round((1-litePartyBytes/fullPartyBytes)*1000)/10,profileFullBytes:fullProfilesBytes,profileSummaryBytes:liteProfilesBytes,profileReductionPct:Math.round((1-liteProfilesBytes/fullProfilesBytes)*1000)/10,partyReads:reducedRequests,teacherFullDossier:true,profileBiography:true,environment:'synthetic clients with mocked Supabase; not real network'}));
 }finally{clients.forEach(h=>h.dispose())}
}
main().catch(e=>{console.error(e);process.exitCode=1});
