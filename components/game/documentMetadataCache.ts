/** A bounded, component-scoped cache for metadata, not permission decisions.
 * Concurrent reads share one promise; rejected reads are never cached.
 * Callers key by game, user/role generation, document revision and local mutation.
 */
export function createDocumentMetadataCache<T>(
 options:{now?:()=>number;ttlMs?:number;maxEntries?:number}={}
){
 const now=options.now??Date.now;
 const ttl=options.ttlMs??30000;
 const capacity=options.maxEntries??24;
 const entries=new Map<string,{expiresAt:number;value?:T;pending?:Promise<T>}>();
 return (key:string,read:()=>Promise<T>):Promise<T>=>{
  const found=entries.get(key);
  if(found){
   if(found.pending)return found.pending;
   if(found.expiresAt>now())return Promise.resolve(found.value as T);
   entries.delete(key);
  }
  const promise=Promise.resolve().then(read).then(value=>{
   if(entries.get(key)?.pending===promise)entries.set(key,{expiresAt:now()+ttl,value});
   return value;
  },error=>{
   if(entries.get(key)?.pending===promise)entries.delete(key);
   throw error;
  });
  entries.set(key,{expiresAt:0,pending:promise});
  while(entries.size>capacity){
   const first=entries.keys().next().value;
   if(first===undefined)break;
   entries.delete(first);
  }
  return promise;
 };
}
