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
  const response=await run();status=response.status;
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
 // Explicitly read-only procedures. Writes, votes, and login identity are
 // never blocked by an overload circuit.
 return /^rpc\/(?:get_section_updates|blitz_inbox_counts|get_budget_pulse|get_teacher_overview|get_fiscal_context|get_signed_state_program_budget|telegram_status)$/.test(path);
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
   let response:Response;try{response=await (isAuthVerificationRequest(input,init)?fetchWithAuthTimeout(input,init):fetchWithBoundedSessionRefresh(input,init))}catch(error){throw new Error(userError(error))}
   if(rest&&response.status===402)restQuotaBlocked=true;
   if(safeRead&&[502,503,504].includes(response.status)){
    const now=Date.now();
    if(now-restFailureWindow>20000){restFailureWindow=now;restFailures=0}
    restFailures++;
    if(restFailures>=3){restOverloadUntil=now+30000;restFailures=0}
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
