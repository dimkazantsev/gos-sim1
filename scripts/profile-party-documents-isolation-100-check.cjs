/* Isolated regression for document query isolation on the profile route.
 * Compiles the production hook's actual loadPartyAssets and tests 100 separate
 * fake client instances; never opens production Supabase or a browser.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

const source=fs.readFileSync(path.resolve(__dirname,'../components/game/useRepublicGame.ts'),'utf8');
const start=source.indexOf(' function acceptPartyDocuments(');
const end=source.indexOf('\n async function loadPartyRepresentation(',start);
assert(start>=0&&end>start,'Party asset loader boundaries must match production code');
assert(source.includes("if(view==='parties'||view==='profile')jobs.push(loadPartyAssets(view==='parties'))"),
 'Profile must explicitly skip party documents; parties must retain them');
assert(source.includes("if(view==='teacher')jobs.push(loadPartyDocuments())"),
 'Teacher dossier must still load full party documents');
const extracted=source.slice(start,end)+'\nmodule.exports={loadPartyAssets,loadPartyDocuments};';
const output=ts.transpileModule(extracted,{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS
}}).outputText;

function client(){
 const reads=[],signs=[],scopeCalls=[],errors=[];
 let parties=[],profiles=[],documents=[];
 const db={
  game_profiles:[{user_id:'u1',avatar_path:null,signature_path:null,game_id:'game-1'}],
  party_documents:[
   {id:'d1',storage_path:'game-1/parties/p1/docs/charter.pdf',game_id:'game-1',party_id:'p1'},
   {id:'d2',storage_path:'game-1/parties/p1/docs/program.pdf',game_id:'game-1',party_id:'p1'}
  ]
 };
 const supabase={from(table){
  assert(Object.hasOwn(db,table),'Unexpected database table '+table);
  const query={
   select(){return this},eq(){return this},order(){return this},
   then(ok,fail){
    reads.push(table);
    return Promise.resolve({data:db[table],error:null}).then(ok,fail);
   }
  };
  return query;
 }};
 const context={
  Promise,Map,console,module:{exports:{}},supabase,gameId:'game-1',
  loadCachedParties:()=>Promise.resolve({data:[{id:'p1',logo_path:null}],error:null}),
  readSafely:async(scopes,reader)=>{scopeCalls.push(scopes);await reader({})},
  readCurrent:()=>true,requireSuccessful:()=>{},
  signedAssetUrl:async(bucket,objectPath)=>{signs.push({bucket,objectPath});return 'signed://'+objectPath},
  // This route-isolation fixture models signing results; the separate batch test
  // exercises the actual grouped Storage API and URL/path matching.
  signedDocumentLinks:async rows=>rows.map(row=>{signs.push({bucket:'game-assets',objectPath:row.path});return {...row,url:'signed://'+row.path}}),
  setError:error=>errors.push(error),
  setPartyDocuments:fn=>{documents=fn(documents)},
  setProfiles:fn=>{profiles=fn(profiles)},
  setParties:fn=>{parties=fn(parties)}
 };
 vm.runInNewContext(output,context,{filename:'useRepublicGame.assets.extracted.js'});
 return {reads,signs,scopeCalls,errors,get parties(){return parties},
  get profiles(){return profiles},get documents(){return documents},
  ...context.module.exports};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

(async()=>{
 const first=client();
 await first.loadPartyAssets(false);
 await flush();
 assert.deepEqual([...first.reads],['game_profiles'],'Profile should read profiles, not documents');
 assert.deepEqual(Array.from(first.scopeCalls[0]),['parties','profiles'],'Profile should not invalidate document scope');
 assert.equal(first.signs.length,0,'No document signed URLs when a profile opens');
 assert.equal(first.profiles.length,1,'Profile pictures must still load');
 assert.equal(first.parties.length,1,'Party identity must still load');

 const party=client();
 await party.loadPartyAssets(true);
 await flush();
 assert.deepEqual([...party.reads].sort(),['game_profiles','party_documents'].sort(),
  'Party screen keeps full document and profile functionality');
 assert.deepEqual(Array.from(party.scopeCalls[0]),['parties','profiles','partyDocuments']);
 assert.equal(party.documents.length,2,'Full party dossier metadata remains readable');
 assert.equal(party.signs.length,2,'Party screen still signs both existing files');

 const teacher=client();
 await teacher.loadPartyDocuments();
 await flush();
 assert.deepEqual([...teacher.reads],['party_documents'],'Teacher document refresh remains independent');
 assert.equal(teacher.documents.length,2,'Teacher can review both files');

 const clients=Array.from({length:100},()=>client());
 await Promise.all(clients.map(item=>item.loadPartyAssets(false)));
 await flush();
 assert.equal(clients.flatMap(item=>item.reads).filter(table=>table==='party_documents').length,0,
  '100 independently modeled profile sessions create zero party document reads');
 assert.equal(clients.reduce((sum,item)=>sum+item.signs.length,0),0,
  '100 independently modeled profile sessions create zero document signed URL requests');
 assert.equal(clients.reduce((sum,item)=>sum+item.reads.length,0),100,
  'Each isolated profile session still retrieves its profile metadata');
 assert(clients.every(item=>item.errors.length===0&&item.profiles.length===1));
 console.log('PASS: 100 simulated profile sessions: 100 profile reads, 0 party-document reads, 0 signed Storage URLs.');
 console.log('PASS: Party and teacher dossier read paths and two document links remain intact (mocked transport).');
 console.log('Note: This is a unit-level synthetic model, NOT 100 JWT sessions, real PostgREST traffic or a browser UX test.');
})().catch(error=>{console.error(error);process.exitCode=1});
