/** Resolve a network-uncertain chat send without claiming it failed.
 * Writes are never retried automatically: the database may have committed.
 */
export async function boundedChatWrite<T>(request:(signal:AbortSignal)=>PromiseLike<T>,timeoutMs=12000):Promise<T>{
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const timeout=new Promise<T>((_,reject)=>{
   timer=setTimeout(()=>{
    controller.abort();
    reject(new Error('Сервер не подтвердил отправку сообщения. Оно могло сохраниться. Проверьте историю чата перед повторной отправкой.'));
   },timeoutMs);
  });
  return await Promise.race([Promise.resolve().then(()=>request(controller.signal)),timeout]);
 }finally{
  if(timer!==undefined)clearTimeout(timer);
 }
}
