/** Per-mount Storage capability cache. Scoped by its caller to game, identity and role. */
export function createScopedSignedAssetBatchCache(
 batch:(paths:string[])=>Promise<Record<string,string|null>>,
 single:(path:string)=>Promise<string|null>,
 options:{now?:()=>number;validForMs?:number;maxEntries?:number;batchSize?:number;maxParallel?:number}={}
){
 const now=options.now||Date.now;
 const ttl=options.validForMs??45*60*1000; // Shorter than signed URLs' 3600 seconds.
 const maxEntries=options.maxEntries??160;
 const batchSize=Math.max(1,Math.min(16,options.batchSize??16));
 const maxParallel=Math.max(1,Math.min(4,options.maxParallel??2));
 const cache=new Map<string,{expiresAt:number;promise:Promise<string|null>}>();
 const resolves=new Map<string,(value:string|null)=>void>();
 const queue:string[]=[];
 let running=0,scheduled=false;
 function complete(path:string,url:string|null){
  const resolve=resolves.get(path);
  resolves.delete(path);
  if(!url)cache.delete(path); // Failed/forbidden URLs are not cached.
  resolve?.(url);
 }
 async function process(paths:string[]){
  try{
   const urls=await batch(paths);
   for(const path of paths)complete(path,urls[path]||null);
  }catch(error){
   const e=error as {status?:number|string;statusCode?:number|string};
   if(String(e?.status??e?.statusCode)==='402'){
    for(const path of paths)complete(path,null);
    return; // Do not amplify quota exhaustion with retries.
   }
   let index=0;
   const worker=async()=>{
    while(index<paths.length){
     const path=paths[index++];
     let url:string|null=null;
     try{url=await single(path)}catch{url=null}
     complete(path,url);
    }
   };
   await Promise.all(Array.from({length:Math.min(4,paths.length)},worker));
  }
 }
 function pump(){
  while(running<maxParallel&&queue.length){
   const paths=queue.splice(0,batchSize);
   running++;
   void process(paths).finally(()=>{running--;pump()});
  }
 }
 function get(path:string|null|undefined):Promise<string|null>{
  if(!path)return Promise.resolve(null);
  const existing=cache.get(path);
  if(existing&&existing.expiresAt>now())return existing.promise;
  cache.delete(path);
  while(cache.size>=maxEntries){
   const oldest=cache.keys().next().value;
   if(!oldest)break;
   cache.delete(oldest);
  }
  let resolve!: (value:string|null)=>void;
  const promise=new Promise<string|null>(fn=>{resolve=fn});
  cache.set(path,{expiresAt:now()+ttl,promise});
  resolves.set(path,resolve);
  queue.push(path);
  if(!scheduled){
   scheduled=true;
   void Promise.resolve().then(()=>{scheduled=false;pump()});
  }
  return promise;
 }
 async function getMany(paths:Array<string|null|undefined>):Promise<Record<string,string|null>>{
  const unique=[...new Set(paths.filter((path):path is string=>!!path))];
  const urls=await Promise.all(unique.map(get));
  return Object.fromEntries(unique.map((path,index)=>[path,urls[index]]));
 }
 return {get,getMany};
}
