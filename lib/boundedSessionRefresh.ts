/**
 * Keep a stalled Supabase Auth refresh from holding the shared browser auth lock
 * for the upstream gateway's full 30-40 second timeout.
 *
 * Only refresh_token requests are bounded. Password sign-in, PostgREST, Storage,
 * realtime and ordinary fetches keep their existing behaviour.
 */
export const SESSION_REFRESH_NETWORK_TIMEOUT_MS=6500;

export async function fetchWithBoundedSessionRefresh(
 input:RequestInfo|URL,
 init?:RequestInit,
 transport:typeof fetch=fetch
):Promise<Response>{
 const href=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(!href.includes('/auth/v1/token')||!/[?&]grant_type=refresh_token(?:&|$)/.test(href)){
  return transport(input,init);
 }
 const controller=new AbortController();
 const signals=[init?.signal,typeof input==='object'&&'signal' in input?input.signal:null].filter((value):value is AbortSignal=>!!value);
 const abort=()=>controller.abort();
 for(const signal of signals){if(signal.aborted){abort();break;}signal.addEventListener('abort',abort,{once:true});}
 let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;controller.abort()},SESSION_REFRESH_NETWORK_TIMEOUT_MS);
 try{
  return await transport(input,{...init,signal:controller.signal});
 }catch(error){
  if(timedOut)throw new Error('Обновление сессии не получило ответ от сервера авторизации. Сеанс не удалён. Повторите вход.');
  throw error;
 }finally{
  clearTimeout(timer);
  for(const signal of signals)signal.removeEventListener('abort',abort);
 }
}
