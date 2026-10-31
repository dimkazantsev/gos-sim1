/* Deterministic, offline protection against classroom request storms.
 * 40 synthetic user-scoped caches; no production requests or database writes.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function compiled(path){
 const code=fs.readFileSync(path,'utf8');
 const ext=path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS;
 const sf=ts.createSourceFile(path,code,ts.ScriptTarget.Latest,true,ext);
 assert.equal(sf.parseDiagnostics.length,0,'Invalid TS: '+path);
 return ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
}
function imported(path){
 const box={exports:{}};
 vm.runInNewContext(compiled(path),{module:box,exports:box.exports,Promise,Map,Date,Math},{filename:path});
 return box.exports;
}
const {assetFailureBackoffMs}=imported('components/game/assetFailureBackoff.ts');
const {createScopedSignedAssetCache}=imported('components/game/scopedSignedAssetCache.ts');
assert.equal(assetFailureBackoffMs({code:'NoSuchKey',message:'Object not found'}),3600000);
assert.equal(assetFailureBackoffMs({code:'DatabaseTimeout'}),60000);
assert.equal(assetFailureBackoffMs(null),60000);
const core=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
compiled('components/game/useRepublicGame.ts');
assert(core.includes('assetSignatures.current.set(key,{expiresAt:Date.now()+assetFailureBackoffMs(error),promise})'));
assert(!core.includes('if(!url&&assetSignatures.current.get(key)?.promise===promise)assetSignatures.current.delete(key)'));
async function main(){
 let now=1000000,requests=0;
 const clients=Array.from({length:40},()=>createScopedSignedAssetCache(async path=>{
  requests++;return 'https://example.invalid/'+path;
 },{now:()=>now}));
 const path='game-1/profiles/123/profile-image.png';
 const first=await Promise.all(clients.map(client=>client(path)));
 assert.equal(requests,40,'40 independent sessions each sign their own scoped image once');
 for(let i=0;i<20;i++){
  const current=await Promise.all(clients.map(client=>client(path)));
  assert.deepEqual([...current],first,'Signed links persist in the same authorised view');
 }
 assert.equal(requests,40,'800 repeat renders create zero additional Storage requests');
 let failed=0,available=false;
 const manual=createScopedSignedAssetCache(async file=>{
  failed++;return available?'https://example.invalid/'+file:null;
 });
 assert.equal(await manual('new-upload'),null);
 available=true;
 assert.equal(await manual('new-upload'),'https://example.invalid/new-upload');
 assert.equal(failed,2,'An explicit manual retry after upload failure must remain immediate');
 const transport=fs.readFileSync('lib/supabase.ts','utf8');
 compiled('lib/supabase.ts');
 for(const required of [
  'READ_CONCURRENCY=3','READ_BACKLOG=24','READ_QUEUE_WAIT_MS=8000',
  'SAFE_READ_TIMEOUT_MS=14000',
  'setTimeout(()=>controller.abort(),SAFE_READ_TIMEOUT_MS)',
  "if(safeRead&&[500,502,503,504,520,524,544].includes(response.status))",
  "get_my_chat_overview|get_chat_pins_projection"
 ])assert(transport.includes(required),'Missing request protection '+required);
 assert(transport.includes('const controller=safeRead?new AbortController():null'));
 assert(transport.includes('if(safeRead)releaseReadSlot()'));
 assert(transport.includes("if(method!=='POST')return false"),'Writes are never throttled by read circuit');
 console.log('PASS: 40 user-scoped caches, 800 cached renders; manual retry intact, missing core profiles back off, 14-second safe-read network cap');
}
main().catch(err=>{console.error(err);process.exitCode=1});
