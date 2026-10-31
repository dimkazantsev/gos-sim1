'use strict';
/* Run the production useRepublicGame hook with 100 simulated, independent
 * identities. No Supabase traffic, storage uploads or database writes. */
const assert=require('node:assert/strict');
const {harness}=require('./republic-game-resilience-check.cjs');

async function main(){
 const clients=Array.from({length:100},(_,i)=>{
  const h=harness({effects:true}),uid='student-'+i;
  h.setUser(uid);
  h.fixture('game_profiles',Array.from({length:12},(_,j)=>{
   const person=j===0?uid:'foreign-'+j;
   return{game_id:'game-a',user_id:person,avatar_path:null,
    signature_path:'game-a/profiles/'+person+'/signature-existing-'+j+'.png',
    updated_at:'2026-10-30T00:00:00Z'};
  }));
  return h;
 });
 try{
  await Promise.all(clients.map(async h=>{
   await h.settle();
   h.render().setActiveView('profile');
   await h.settle();
  }));
  assert(clients.every(h=>h.render().profiles.length===12));
  assert.equal(clients.reduce((sum,h)=>sum+h.assetStats().signed,0),0,
   '100 users and 1,200 saved signature metadata rows must create ZERO automatic Storage signs');
  assert(clients.every(h=>h.render().profiles.every(row=>!row.signature_url)),
   'Private signature URLs must not be inserted into the common profile roster');
  const urls=await Promise.all(clients.map(h=>h.render().loadOwnSignaturePreview()));
  assert(urls.every(Boolean),'The owner must still be able to explicitly preview their own signature');
  assert.equal(clients.reduce((sum,h)=>sum+h.assetStats().signed,0),100,
   'One explicit preview creates one authorised signed URL per simulated user');
  await Promise.all(clients.map(h=>h.render().loadOwnSignaturePreview()));
  assert.equal(clients.reduce((sum,h)=>sum+h.assetStats().signed,0),100,
   'Repeating preview in the same session reuses the cached signed URL');
  const denied=clients[0];
  denied.setMemberKind('observer');
  await denied.render().refresh();await denied.settle();
  assert.equal(await denied.render().loadOwnSignaturePreview(),null,
   'Observer cannot preview a profile signature');
  assert.equal(denied.assetStats().signed,1,'Denied preview does not access Storage');
  console.log('PASS: 100 simulated players, 1,200 stored signatures: 0 eager requests; 100 opt-in requests, 0 repeated; observer denied.');
  console.log('Note: mocked Supabase transport, not an actual 100-player production stress test.');
 }finally{clients.forEach(h=>h.dispose())}
}
main().catch(e=>{console.error(e);process.exitCode=1});
