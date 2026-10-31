const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const errorExports={};vm.runInNewContext(compile('lib/userError.ts'),{exports:errorExports});
function client(status,retryAfter){
 let now=1_000_000,calls=0,nextStatus=status;
 const transport=async()=>{calls++;return new Response(JSON.stringify({message:nextStatus===429?'Too many requests':'Service unavailable'}),{status:nextStatus,headers:{'content-type':'application/json',...(retryAfter?{'retry-after':retryAfter}:{})}})};
 const result={},context={exports:result,Response,Headers,URL,AbortController,setTimeout,clearTimeout,Date:class extends Date{static now(){return now}},process:{env:{}},require:name=>{
  if(name==='./userError')return errorExports;
  if(name==='./boundedSessionRefresh')return {fetchWithBoundedSessionRefresh:transport};
  if(name==='./authTransport')return {isAuthVerificationRequest:()=>false,fetchWithAuthTimeout:transport};
  if(name==='@supabase/supabase-js')return {createClient:(_url,_key,options)=>options};
  throw Error('Unexpected dependency '+name);
 }};
 vm.runInNewContext(compile('lib/supabase.ts'),context);
 return {request:result.supabase.global.fetch,calls:()=>calls,advance:ms=>{now+=ms},healthy:()=>{nextStatus=200}};
}
const rest='https://bderfrcfuhnutuoyudje.supabase.co/rest/v1/';
async function main(){
 let total=0;
 for(let user=0;user<40;user++){
  const c=client(402),first=await c.request(rest+'game_members');
  assert.equal(first.status,402);assert.match((await first.json()).message,/код 402/,'The original restriction is translated as quota, not a failed action');
  for(let tick=0;tick<100;tick++){
   const r=await c.request(rest+(tick%2?'rpc/get_section_updates':'game_votes'),{method:tick%2?'POST':'GET'});
   assert.equal(r.status,402);
  }
  assert.equal(c.calls(),1,'After the first quota response all REST background work stays local');total+=c.calls();
  await c.request('https://bderfrcfuhnutuoyudje.supabase.co/auth/v1/user');
  assert.equal(c.calls(),2,'Auth recovery remains available separately');
 }
 const limited=client(429,'60');
 assert.equal((await limited.request(rest+'game_stages')).status,429);
 for(let n=0;n<40;n++)await limited.request(rest+'rpc/get_stage_readiness',{method:'POST'});
 assert.equal(limited.calls(),1);limited.advance(59999);await limited.request(rest+'game_stages');assert.equal(limited.calls(),1);
 limited.advance(2);limited.healthy();assert.equal((await limited.request(rest+'game_stages')).status,200);assert.equal(limited.calls(),2,'The server Retry-After deadline controls recovery');
 const dated=client(429,new Date(1_000_000+90000).toUTCString());await dated.request(rest+'game_members');dated.advance(89999);await dated.request(rest+'game_members');assert.equal(dated.calls(),1);dated.advance(2);await dated.request(rest+'game_members');assert.equal(dated.calls(),2);
 const invalid=client(429,'invalid');await invalid.request(rest+'game_members');invalid.advance(29999);await invalid.request(rest+'game_members');assert.equal(invalid.calls(),1);invalid.advance(2);await invalid.request(rest+'game_members');assert.equal(invalid.calls(),2);
 console.log('PASS: 40 sessions stop 4000 repeated REST calls after 402; 429 observes numeric/date Retry-After, finite fallback, separate Auth recovery');
}
main().catch(error=>{console.error(error);process.exitCode=1});
