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
const restPrefix=url.replace(/\/$/,'')+'/rest/v1/';
function pausedRestResponse(status:402|429){
 const headers:Record<string,string>={'content-type':'application/json'};
 if(status===429)headers['retry-after']=String(Math.max(1,Math.ceil((restRetryAt-Date.now())/1000)));
 return new Response(JSON.stringify({code:status===402?'exceeded_project_quota':'RATE_LIMITED',message:userError({status,message:'Too many requests'})}),{status,headers});
}

export const supabase = createClient(url, publishableKey, {
  global:{fetch:async(input,init)=>{
   const href=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   const rest=href.startsWith(restPrefix);
   // A blocked project must not receive another request from every background timer.
   // Reloading the page after the owner restores the service starts a fresh check.
   if(rest&&restQuotaBlocked)return pausedRestResponse(402);
   if(rest&&Date.now()<restRetryAt)return pausedRestResponse(429);
   let response:Response;try{response=await (isAuthVerificationRequest(input,init)?fetchWithAuthTimeout(input,init):fetchWithBoundedSessionRefresh(input,init))}catch(error){throw new Error(userError(error))}
   if(rest&&response.status===402)restQuotaBlocked=true;
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
  }},
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 20 } }
});


export function createPasswordAuthClient(){
  return createClient(url, publishableKey, {
    global:{fetch:async(input,init)=>{
      try{return await fetchWithAuthTimeout(input,init)}
      catch(error){throw new Error(userError(error))}
    }},
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
}
