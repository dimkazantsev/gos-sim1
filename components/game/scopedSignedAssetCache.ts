/** Isolated per mounted game/view and signed-in user. Never persist capability URLs. */
export function createScopedSignedAssetCache(
 sign:(path:string)=>Promise<string|null>,
 options:{now?:()=>number;validForMs?:number;maxEntries?:number;maxParallel?:number}={}
){
 const now=options.now||Date.now;
 const ttl=options.validForMs??45*60*1000; // Must remain below the 3600s signed-URL validity.
 const limit=options.maxEntries??160;
 const concurrency=options.maxParallel??4;
 const cache=new Map<string,{expiresAt:number;promise:Promise<string|null>}>();
 const waiting:Array<()=>void>=[];
 let running=0;
 function enqueue(path:string):Promise<string|null>{
  return new Promise(resolve=>{
   const begin=()=>{
    running++;
    void Promise.resolve().then(()=>sign(path)).then(resolve,()=>resolve(null)).finally(()=>{
     running--;waiting.shift()?.();
    });
   };
   if(running<concurrency)begin();else waiting.push(begin);
  });
 }
 return (path:string|null|undefined):Promise<string|null>=>{
  if(!path)return Promise.resolve(null);
  const current=cache.get(path);
  if(current&&current.expiresAt>now())return current.promise;
  cache.delete(path);
  while(cache.size>=limit){const oldest=cache.keys().next().value;if(!oldest)break;cache.delete(oldest)}
  const promise=enqueue(path).then(url=>{
   if(!url&&cache.get(path)?.promise===promise)cache.delete(path);
   return url;
  });
  cache.set(path,{expiresAt:now()+ttl,promise});
  return promise;
 };
}
