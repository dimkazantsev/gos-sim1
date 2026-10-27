const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('lib/supabase.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const userError={userError:x=>String(x?.message||'Сервер перегружен')};
function makeClient(){
 let now=1000000,calls=0;
 const transport=async(input)=>{calls++;let href=typeof input==='string'?input:input.url;
  return new Response(JSON.stringify({message:'Gateway Timeout'}),{status:href.includes('/auth/')?200:504,headers:{'content-type':'application/json'}})};
 const exports={},sandbox={exports,Response,Headers,URL,Date:class extends Date{static now(){return now}},process:{env:{}},require:name=>{
  if(name==='./userError')return userError;
  if(name==='./boundedSessionRefresh')return {fetchWithBoundedSessionRefresh:transport};
  if(name==='./authTransport')return {isAuthVerificationRequest:()=>false,fetchWithAuthTimeout:transport};
  if(name==='@supabase/supabase-js')return {createClient:(_url,_key,options)=>options};
  throw Error('Unknown mock '+name);
 }};
 vm.runInNewContext(source,sandbox);
 return {fetch:exports.supabase.global.fetch,calls:()=>calls,advance:ms=>{now+=ms}};
}
const url='https://bderfrcfuhnutuoyudje.supabase.co/rest/v1/';
(async()=>{
 const clients=Array.from({length:40},makeClient);
 for(const c of clients){
  for(let i=0;i<3;i++)assert.equal((await c.fetch(url+'game_activity')).status,504);
  for(let i=0;i<40;i++)assert.equal((await c.fetch(url+'game_activity')).status,503);
  assert.equal(c.calls(),3,'Repeated reads were not stopped locally');
  assert.equal((await c.fetch(url+'rpc/get_section_updates',{method:'POST'})).status,503,'Read-only RPC should back off');
  assert.equal(c.calls(),3);
  await c.fetch(url+'rpc/cast_vote',{method:'POST'});
  assert.equal(c.calls(),4,'Writes must never be suppressed');
  await c.fetch('https://bderfrcfuhnutuoyudje.supabase.co/auth/v1/user');
  assert.equal(c.calls(),5,'Auth remains available during REST backoff');
  c.advance(30001);
  assert.equal((await c.fetch(url+'game_activity')).status,504,'Backoff must be finite');
  assert.equal(c.calls(),6);
 }
 console.log('PASS 40 modeled clients: 1600 repeated GETs stopped, writes/auth allowed, 30s bounded recovery');
})().catch(e=>{console.error(e);process.exitCode=1});
