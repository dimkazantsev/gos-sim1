/** Classify Auth failures before translated messages reach the entry form. */
export function isTransientAuthError(value:unknown):boolean{
 const error=value&&typeof value==='object'?value as {status?:unknown;code?:unknown;message?:unknown}:{};
 const status=typeof error.status==='number'?error.status:undefined;
 if(status!==undefined&&status>=400&&status<500)return status===408;
 if(status===0||(status!==undefined&&status>=500))return true;
 const detail=[error.code,error.message,typeof value==='string'?value:''].filter(Boolean).join(' ');
 return /\b5\d\d\b|request_timeout|context (?:deadline exceeded|canceled)|timeout|temporarily unavailable|fetch failed|failed to fetch|network|Нет ответа от сервера|Сервер.*(?:не ответил|не отвечает|недоступен)/i.test(detail);
}

export const AUTH_REQUEST_TIMEOUT_MS=12000;

/** setSession() verifies its fresh token through GET /user as well as /token. */
export function isAuthVerificationRequest(input:RequestInfo|URL,init?:RequestInit):boolean{
 const href=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 const method=init?.method||(typeof input==='object'&&'method' in input?input.method:'GET');
 return method.toUpperCase()==='GET'&&/\/auth\/v1\/user(?:[?#]|$)/.test(href);
}

/** Abort the network request itself, preserving a caller's cancellation. */
export async function fetchWithAuthTimeout(input:RequestInfo|URL,init?:RequestInit,transport:typeof fetch=fetch):Promise<Response>{
 const controller=new AbortController();
 const signals=[init?.signal,typeof input==='object'&&'signal' in input?input.signal:null].filter((value):value is AbortSignal=>!!value);
 const abort=()=>controller.abort();
 for(const signal of signals){if(signal.aborted){abort();break;}signal.addEventListener('abort',abort,{once:true});}
 let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;controller.abort()},AUTH_REQUEST_TIMEOUT_MS);
 try{return await transport(input,{...init,signal:controller.signal})}
 catch(error){if(timedOut)throw new Error('Сервер авторизации не ответил за 12 секунд. Повторите вход.');throw error}
 finally{clearTimeout(timer);for(const signal of signals)signal.removeEventListener('abort',abort);}
}
