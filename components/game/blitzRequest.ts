// ГОС.ID: an interrupted response does not prove the original answer was rejected.
// Never automatically replay a write after a transport timeout: a previous
// request may already have committed on the server.
export const BLITZ_RPC_TIMEOUT_MS=10_000;

export async function blitzBoundedRequest<T>(
 request:(signal:AbortSignal)=>PromiseLike<T>,
 timeoutMs=BLITZ_RPC_TIMEOUT_MS
):Promise<T>{
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const timeout=new Promise<T>((_,reject)=>{
   timer=setTimeout(()=>{
    controller.abort();
    reject(new Error('Сервер блиц-вопросов не ответил вовремя. Статус попытки необходимо проверить в истории.'));
   },timeoutMs);
  });
  return await Promise.race([Promise.resolve().then(()=>request(controller.signal)),timeout]);
 }finally{
  if(timer!==undefined)clearTimeout(timer);
 }
}
