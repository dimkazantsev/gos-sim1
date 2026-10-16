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

export const supabase = createClient(url, publishableKey, {
  global:{fetch:async(input,init)=>{
   let response:Response;try{response=await (isAuthVerificationRequest(input,init)?fetchWithAuthTimeout(input,init):fetchWithBoundedSessionRefresh(input,init))}catch(error){throw new Error(userError(error))}
   if(response.ok||!response.headers.get('content-type')?.includes('json'))return response;
   let body:Record<string,unknown>;try{body=await response.clone().json()}catch{return response}
   for(const key of ['message','error_description','msg'])if(typeof body[key]==='string')body[key]=userError({message:body[key],code:body.code||body.error_code});
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
