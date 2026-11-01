import {userError} from './userError';
import {fetchWithBoundedSessionRefresh} from './boundedSessionRefresh';
import {fetchWithAuthTimeout,isAuthVerificationRequest} from './authTransport';
import { createClient } from '@supabase/supabase-js';

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://bderfrcfuhnutuoyudje.supabase.co';

const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'build-placeholder-key';

let restQuotaBlocked=false,restRetryAt=0;
let restFailures=0,restFailureWindow=0,restOverloadUntil=0;
const restPrefix=url.replace(/\/$/,'')+'/rest/v1/';
// Per-tab HTTP concurrency guard. The supabase-js browser client talks to
// PostgREST, not directly to Postgres: port 6543 is never a browser endpoint.
// Limit only low-priority reads. Votes, other writes, and Auth bypass the gate.
// Bound concurrent low-priority reads per client during classroom joins.
// Core identity, Auth and every mutation retain their existing priority.
const READ_CONCURRENCY=3, READ_BACKLOG=24, READ_QUEUE_WAIT_MS=16000;
const SAFE_READ_TIMEOUT_MS=14000;
// Keep one of three transport slots available for foreground chat. Background
// reads are not permitted to occupy it, even when PostgREST stalls.
const BACKGROUND_READ_CONCURRENCY=2;
let activeRestReads=0,activeBackgroundReads=0;
type ReadWaiter={grant:()=>void;foreground:boolean};
const waitingRestReads:ReadWaiter[]=[];
function canStartRead(foreground:boolean){
 return activeRestReads<READ_CONCURRENCY&&
  (foreground||activeBackgroundReads<BACKGROUND_READ_CONCURRENCY);
}
function acquireReadSlot(signal?:AbortSignal,foreground=false):Promise<boolean>{
 if(signal?.aborted)return Promise.resolve(false);
 if(typeof window==='undefined')return Promise.resolve(true);
 if(canStartRead(foreground)&&
   (foreground?!waitingRestReads.some(waiter=>waiter.foreground):waitingRestReads.length===0)){
  activeRestReads++;if(!foreground)activeBackgroundReads++;
  return Promise.resolve(true);
 }
 if(waitingRestReads.length>=READ_BACKLOG)return Promise.resolve(false);
 return new Promise<boolean>(resolve=>{
  let finished=false;
  let timer:ReturnType<typeof setTimeout>;
  const waiter:ReadWaiter={foreground,grant:()=>{
   if(finished)return;
   finished=true;cleanup();
   activeRestReads++;if(!foreground)activeBackgroundReads++;
   resolve(true);
  }};
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel)};
  const cancel=()=>{
   if(finished)return;
   finished=true;cleanup();
   const index=waitingRestReads.indexOf(waiter);
   if(index>=0)waitingRestReads.splice(index,1);
   resolve(false);
  };
  // A visible conversation should not wait behind offscreen projections.
  const firstBackground=waitingRestReads.findIndex(item=>!item.foreground);
  if(foreground&&firstBackground>=0)waitingRestReads.splice(firstBackground,0,waiter);
  else waitingRestReads.push(waiter);
  signal?.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(cancel,READ_QUEUE_WAIT_MS);
 });
}
function releaseReadSlot(foreground:boolean){
 if(typeof window==='undefined')return;
 activeRestReads=Math.max(0,activeRestReads-1);
 if(!foreground)activeBackgroundReads=Math.max(0,activeBackgroundReads-1);
 while(activeRestReads<READ_CONCURRENCY){
  const index=waitingRestReads.findIndex(item=>canStartRead(item.foreground));
  if(index<0)break;
  const [waiter]=waitingRestReads.splice(index,1);
  waiter.grant();
 }
}
function foregroundRestRead(href:string,method:string){
 const path=href.slice(restPrefix.length).split('?')[0];
 return method==='GET'&&/^(?:chat_messages|chat_channels)$/.test(path)||
  method==='POST'&&/^rpc\/(?:get_my_chat_overview|get_chat_pins_projection|get_game_bootstrap_v2)$/.test(path);
}
// Deduplicate only identical READS under exactly the same Auth headers.
// Key is ephemeral (deleted when transport settles), never logged or cached.
const identicalReads=new Map<string,Promise<Response>>();
function identicalReadKey(input:RequestInfo|URL,init:RequestInit|undefined):string|null{
 if(typeof window==='undefined'||typeof input!=='string'||init?.signal)return null;
 const method=String(init?.method||'GET').toUpperCase();
 if(!input.startsWith(restPrefix)||!safeRestRead(input,method))return null;
 if(init?.body!=null&&typeof init.body!=='string')return null;
 const headers=[...new Headers(init?.headers).entries()].sort(([a],[b])=>a.localeCompare(b));
 return JSON.stringify([method,input,headers,init?.body||'']);
}
function busyReadResponse(){
 return new Response(JSON.stringify({code:'CLIENT_READ_BUSY',
  message:'Слишком много одновременных запросов игровых данных. Повторите загрузку раздела.'
 }),{status:503,headers:{'content-type':'application/json',
  'retry-after':'3','x-gos-local-limit':'1'}});
}
type RequestDiagnostic={at:string;operation:string;method:string;status:number;duration_ms:number;source:'network'|'local_limit'};
const diagnostics:RequestDiagnostic[]=[];
let diagnosticsGeneration=0;
export function getRequestDiagnostics(){return diagnostics.map(item=>({...item}))}
export function clearRequestDiagnostics(){diagnostics.length=0;diagnosticsGeneration++}
async function measuredRequest(input:RequestInfo|URL,init:RequestInit|undefined,run:()=>Promise<Response>){
 if(typeof window==='undefined')return run();
 const started=Date.now(),generation=diagnosticsGeneration,clock=typeof performance==='undefined'?()=>Date.now():()=>performance.now(),tick=clock();
 let status=0,source:RequestDiagnostic['source']='network';
 try{
  const key=identicalReadKey(input,init);
  let shared=key?identicalReads.get(key):undefined;
  if(!shared){
   shared=run();
   if(key){
    identicalReads.set(key,shared);
    void shared.finally(()=>{if(identicalReads.get(key)===shared)identicalReads.delete(key)}).catch(()=>{});
   }
  }
  const original=await shared;
  const response=key?original.clone():original;
  status=response.status;
  try{if(response.headers.get('x-gos-local-limit')==='1')source='local_limit'}catch{/* The request result takes precedence over diagnostics. */}
  return response;
 }finally{
  try{
   if(generation===diagnosticsGeneration){
   const href=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   const path=href.startsWith(restPrefix)?href.slice(restPrefix.length).split('?')[0]:'';
   const operation=/^(?:rpc\/)?[a-z][a-z0-9_]{0,79}$/.test(path)?path:href.startsWith(url.replace(/\/$/,'')+'/auth/v1/')?'auth':'other';
   const raw=String(init?.method||(typeof input==='object'&&'method' in input?input.method:'GET')).toUpperCase();
   const method=['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(raw)?raw:'OTHER';
   if(diagnostics.length>=500)diagnostics.shift();
   diagnostics.push({at:new Date(started).toISOString(),operation,method,status,duration_ms:Math.max(0,Math.round(clock()-tick)),source});
   }
  }catch{/* Diagnostics must never change the outcome of a request. */}
 }
}
function overloadedReadResponse(){
 return new Response(JSON.stringify({code:'SERVICE_OVERLOADED',
  message:'Сервер игровых данных временно перегружен. Данные не изменены; попробуйте обновить раздел позже.'
 }),{status:503,headers:{'content-type':'application/json',
  'retry-after':String(Math.max(1,Math.ceil((restOverloadUntil-Date.now())/1000))),'x-gos-local-limit':'1'}});
}
function safeRestRead(href:string,method:string){
 if(method==='GET'||method==='HEAD')return true;
 if(method!=='POST')return false;
 const path=href.slice(restPrefix.length).split('?')[0];
 // Explicitly read-only procedures. A few misleadingly named get_* RPCs
 // INSERT/UPDATE state (get_budget_pulse, get_fiscal_context,
 // blitz_inbox_counts) and must never be queued or suppressed.
 // Writes, votes, and login identity are never blocked by an overload circuit.
 return /^rpc\/(?:get_impact_engine_projection|get_political_wall_projection|get_party_representation_projection|get_event_workspace_projection|get_game_bootstrap_v2|get_section_updates|get_teacher_overview|get_my_chat_overview|get_chat_pins_projection|get_signed_state_program_budget|telegram_status|get_process_actors|get_game_achievements|get_achievement_catalog_counts)$/.test(path);
}
function pausedRestResponse(status:402|429){
 const headers:Record<string,string>={'content-type':'application/json','x-gos-local-limit':'1'};
 if(status===429)headers['retry-after']=String(Math.max(1,Math.ceil((restRetryAt-Date.now())/1000)));
 return new Response(JSON.stringify({code:status===402?'exceeded_project_quota':'RATE_LIMITED',message:userError({status,message:'Too many requests'})}),{status,headers});
}

export const supabase = createClient(url, publishableKey, {
  global:{fetch:(input,init)=>measuredRequest(input,init,async()=>{
   const href=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   const rest=href.startsWith(restPrefix);
   const method=String(init?.method||(typeof input==='object'&&'method' in input?input.method:'GET')||'GET').toUpperCase();
   const safeRead=rest&&safeRestRead(href,method);
   // A blocked project must not receive another request from every background timer.
   // Reloading the page after the owner restores the service starts a fresh check.
   if(rest&&restQuotaBlocked)return pausedRestResponse(402);
   if(rest&&Date.now()<restRetryAt)return pausedRestResponse(429);
   if(safeRead&&Date.now()<restOverloadUntil)return overloadedReadResponse();
   // Hold a slot only for actual transport; reject stale queued reads locally.
   // POST mutations and Auth never wait behind the classroom read queue.
   const signal=init?.signal||(typeof input==='object'&&'signal' in input?input.signal:undefined);
   const foreground=safeRead&&foregroundRestRead(href,method);
   const admitted=!safeRead||await acquireReadSlot(signal??undefined,foreground);
   if(!admitted)return busyReadResponse();
   let response:Response;
   // Limit only read-only transport. An abort can stop an expensive slow
   // response without accidentally resubmitting votes, chat or other writes.
   const controller=safeRead?new AbortController():null;
   const onAbort=()=>controller?.abort();
   let requestTimer:ReturnType<typeof setTimeout>|undefined;
   try{
    // Recheck the circuit after queueing: another request may have seen HTTP 402/429.
    if(rest&&restQuotaBlocked)return pausedRestResponse(402);
    if(rest&&Date.now()<restRetryAt)return pausedRestResponse(429);
    if(safeRead&&Date.now()<restOverloadUntil)return overloadedReadResponse();
    if(controller){
     if(signal?.aborted)controller.abort();
     else signal?.addEventListener('abort',onAbort,{once:true});
     requestTimer=setTimeout(()=>controller.abort(),SAFE_READ_TIMEOUT_MS);
    }
    const boundedInit=controller?{...init,signal:controller.signal}:init;
    response=await (isAuthVerificationRequest(input,boundedInit)?fetchWithAuthTimeout(input,boundedInit):fetchWithBoundedSessionRefresh(input,boundedInit));
   }catch(error){throw new Error(userError(error))}
   finally{
    if(requestTimer!==undefined)clearTimeout(requestTimer);
    signal?.removeEventListener('abort',onAbort);
    if(safeRead)releaseReadSlot(foreground);
   }
   if(rest&&response.status===402)restQuotaBlocked=true;
   if(safeRead&&[500,502,503,504,520,524,544].includes(response.status)){
    const now=Date.now();
    if(now-restFailureWindow>20000){restFailureWindow=now;restFailures=0}
    restFailures++;
    if(restFailures>=3){restOverloadUntil=now+30000+Math.floor(Math.random()*8000);restFailures=0}
   }else if(safeRead&&response.ok){
    restFailures=Math.max(0,restFailures-1);
   }
   if(rest&&response.status===429){
    const header=response.headers.get('retry-after'),seconds=header?Number(header):NaN;
    const delay=Number.isFinite(seconds)?seconds*1000:header?Date.parse(header)-Date.now():NaN;
    restRetryAt=Date.now()+(Number.isFinite(delay)&&delay>0?delay:30000);
   }
   if(response.ok||!response.headers.get('content-type')?.includes('json'))return response;
   let body:Record<string,unknown>;try{body=await response.clone().json()}catch{return response}
   for(const key of ['message','error_description','msg'])if(typeof body[key]==='string')body[key]=userError({message:body[key],code:body.code||body.error_code,status:response.status});
   if(typeof body.error==='string'&&/\s/.test(body.error))body.error=userError(body.error);
   const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');
   return new Response(JSON.stringify(body),{status:response.status,statusText:response.statusText,headers});
  })},
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 20 } }
});


export function createPasswordAuthClient(){
  return createClient(url, publishableKey, {
    global:{fetch:(input,init)=>measuredRequest(input,init,async()=>{
      try{return await fetchWithAuthTimeout(input,init)}
      catch(error){throw new Error(userError(error))}
    })},
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
}
