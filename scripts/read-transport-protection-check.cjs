'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../lib/supabase.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const base='https://example.invalid';
const json=(status=200,headers={})=>new Response(JSON.stringify({message:'test'}),{status,headers:{'content-type':'application/json',...headers}});
function fixture(handler){
 let now=1000000,calls=[];
 const exports={};
 const transport=async(input,init)=>{calls.push({input,init});return handler(input,init)};
 const requireMock=name=>{
  if(name==='@supabase/supabase-js')return {createClient:(_url,_key,options)=>options.global.fetch};
  if(name==='./userError')return {userError:e=>typeof e==='string'?e:String(e.message||e)};
  if(name==='./boundedSessionRefresh')return {fetchWithBoundedSessionRefresh:transport};
  if(name==='./authTransport')return {fetchWithAuthTimeout:transport,isAuthVerificationRequest:()=>false};
  throw Error(name);
 };
 class Clock extends Date{static now(){return now}}
 vm.runInNewContext(js,{exports,require:requireMock,process:{env:{NEXT_PUBLIC_SUPABASE_URL:base}},window:{},Response,Headers,URL,AbortController,Date:Clock,performance,Math,setTimeout,clearTimeout});
 const rpc=(name,body='{}',auth='A')=>exports.supabase(base+'/rest/v1/rpc/'+name,{method:'POST',body,headers:{authorization:auth}});
 return {rpc,calls,advance:ms=>{now+=ms}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 let pending=[];let f=fixture(()=>new Promise(resolve=>pending.push(resolve)));
 const requests=[f.rpc('get_political_wall_page','{"p_game_id":"a"}'),f.rpc('get_event_workspace_feed_bootstrap'),f.rpc('get_formal_subjects')];
 await tick();assert.equal(f.calls.length,2,'three distinct low-priority reads must respect the two-slot cap');
 const vote=f.rpc('cast_vote');await tick();assert.equal(f.calls.length,3,'vote bypasses background queue');
 assert(f.calls[0].init.signal instanceof AbortSignal&&f.calls[1].init.signal instanceof AbortSignal,'safe reads get abort deadlines');assert.equal(f.calls[2].init.signal,undefined,'vote is not given a read deadline');
 pending.shift()(json());await tick();assert.equal(f.calls.length,4,'third read starts when a slot opens');for(const finish of pending.splice(0))finish(json());await Promise.all([...requests,vote]);
 f=fixture(async()=>json(200));await Promise.all(Array.from({length:100},()=>f.rpc('get_political_wall_page','{"p_game_id":"a"}')));assert.equal(f.calls.length,1,'identical same-user reads share transport');
 await Promise.all([f.rpc('get_political_wall_page','{}','A'),f.rpc('get_political_wall_page','{}','B')]);assert.equal(f.calls.length,3,'different authorizations never share transport');
 f=fixture(async()=>json(402));assert.equal((await f.rpc('get_political_wall_page')).status,402);for(let i=0;i<100;i++)assert.equal((await f.rpc('get_formal_subjects')).status,402);assert.equal(f.calls.length,1,'quota latch stops 100 subsequent REST attempts');
 let next=429;f=fixture(async()=>json(next,{'retry-after':'5'}));assert.equal((await f.rpc('get_formal_subjects')).status,429);next=200;f.advance(4999);assert.equal((await f.rpc('get_political_wall_page')).status,429);assert.equal(f.calls.length,1);f.advance(1);assert.equal((await f.rpc('get_political_wall_page')).status,200);assert.equal(f.calls.length,2,'429 honors Retry-After and recovers');
 let overloaded=true;f=fixture(async()=>json(overloaded?503:200));for(let i=0;i<3;i++)assert.equal((await f.rpc('get_political_wall_page',String(i))).status,503);assert.equal((await f.rpc('get_event_workspace_feed_bootstrap')).status,503);assert.equal(f.calls.length,3,'overload circuit suppresses subsequent reads');overloaded=false;assert.equal((await f.rpc('get_budget_pulse')).status,200,'budget mutation still bypasses overload circuit');assert.equal(f.calls.length,4);f.advance(38001);assert.equal((await f.rpc('get_political_wall_page')).status,200);assert.equal(f.calls.length,5,'overload recovery resumes');
 console.log('PASS: 3 read RPCs capped at 2 background slots; 100 identical reads -> 1 transport; auth isolation; 402, 429, 503 and mutation priority.');
})().catch(e=>{console.error(e);process.exitCode=1});
