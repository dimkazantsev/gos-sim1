const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('lib/supabase.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let now=1000000,calls=0,status=200,fail=false,hold=false,release;
const transport=async()=>{calls++;now+=37;if(hold)await new Promise(resolve=>{release=resolve});if(fail)throw new Error('private body: пароль');return new Response('{}',{status,headers:{'content-type':'application/json'}})};
const result={},context={exports:result,Response,Headers,URL,window:{},Date:class extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}},process:{env:{}},require:name=>{
 if(name==='./userError')return {userError:()=> 'Ошибка сети'};
 if(name==='./boundedSessionRefresh')return {fetchWithBoundedSessionRefresh:transport};
 if(name==='./authTransport')return {isAuthVerificationRequest:()=>false,fetchWithAuthTimeout:transport};
 if(name==='@supabase/supabase-js')return {createClient:(_url,_key,options)=>options};
 throw Error('Unexpected dependency '+name);
}};
vm.runInNewContext(source,context);
(async()=>{
 const fetch=result.supabase.global.fetch,base='https://bderfrcfuhnutuoyudje.supabase.co';
 assert.equal(typeof result.getRequestDiagnostics,'function','A user can inspect a bounded local log');
 await fetch(base+'/rest/v1/rpc/get_section_updates?user_id=secret', {method:'POST',body:'password-secret'});
 let log=result.getRequestDiagnostics();assert.equal(log.length,1);assert.equal(log[0].operation,'rpc/get_section_updates');assert.equal(log[0].status,200);assert.equal(log[0].duration_ms,37);
 status=402;await fetch(base+'/rest/v1/game_votes?token=secret');await fetch(base+'/rest/v1/game_votes');
 log=result.getRequestDiagnostics();assert.equal(log[1].source,'network');assert.equal(log[2].source,'local_limit');assert.equal(calls,2,'Capturing diagnostics makes no extra network requests');
 fail=true;try{await fetch(base+'/auth/v1/token?password=secret',{method:'POST',body:'secret'})}catch{}
 log=result.getRequestDiagnostics();assert.equal(log[3].operation,'auth');assert.equal(log[3].status,0);
 assert(!/secret|пароль|private body|https:|user_id/.test(JSON.stringify(log)),'No URLs, query values, bodies, raw errors or personal information');
 for(let n=0;n<520;n++)await fetch(base+'/rest/v1/game_votes');
 assert.equal(result.getRequestDiagnostics().length,500,'History is bounded');
 const component=ts.transpileModule(fs.readFileSync('components/game/DeviceSyncStatus.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 let downloaded,clicked=false;const uiExports={},ui={exports:uiExports,Blob,Date,setTimeout:fn=>fn(),URL:{createObjectURL:blob=>{downloaded=blob;return 'blob:test'},revokeObjectURL:()=>{}},document:{body:{appendChild:()=>{}},createElement:()=>({click(){clicked=true},remove(){}})},require:name=>{
  if(name==='react')return {useState:value=>[value,()=>{}],useEffect:()=>{}};
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='lucide-react')return {Check:'Check',CloudDownload:'CloudDownload',RefreshCw:'RefreshCw',WifiOff:'WifiOff'};
  if(name==='@/lib/supabase')return result;
  if(name==='@/lib/localGameSnapshot')return {};
  throw Error('Unexpected UI dependency '+name);
 }};
 vm.runInNewContext(component,ui);
 function find(node){if(Array.isArray(node))return node.map(find).find(Boolean);if(!node||typeof node!=='object')return null;if(node.type==='button'&&node.props.children==='Скачать диагностику')return node;return find(node.props?.children)}
 const button=find(uiExports.default({gameId:'game',userId:'user',realtimeState:'connected'}));assert(button,'The diagnostics download is available from device status');button.props.onClick();
 assert(clicked&&downloaded,'Clicking the button creates a download');const exported=JSON.parse(await downloaded.text());assert.equal(exported.scope,'current_browser_tab');assert.equal(exported.entries.length,500);assert(!/password|token|user_id/.test(JSON.stringify(exported)));
 result.clearRequestDiagnostics();assert.equal(result.getRequestDiagnostics().length,0,'History can be cleared');
 fail=false;hold=true;const pending=fetch(base+'/auth/v1/user');await Promise.resolve();result.clearRequestDiagnostics();release();assert.equal((await pending).status,402,'Clearing history must not change the response');
 assert.equal(result.getRequestDiagnostics().length,0,'A request from the previous session cannot restore cleared history');
 console.log('PASS local diagnostics: duration, status, local quota, network errors, privacy, bounded memory, no extra requests');
})().catch(error=>{console.error(error);process.exitCode=1});
