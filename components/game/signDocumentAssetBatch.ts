import {resolveStoredAsset} from '@/lib/resolveStoredAsset';

type AssetBucket='game-assets'|'teacher-assets';
type DocumentPath={id:string;path:string};
type SignedLink={id:string;path:string;url:string|null};
type BatchResponse={
 data:{path?:string|null;signedUrl?:string|null;error?:unknown}[]|null;
 error:unknown;
};
type SignOptions={
 cached:(key:string)=>Promise<string|null>|undefined;
 store:(key:string,url:string)=>void;
 signOne:(originalPath:string)=>Promise<string|null>;
 signMany:(bucket:AssetBucket,paths:string[])=>Promise<BatchResponse>;
 isCurrent:()=>boolean;
};

/** Reduce per-file Storage calls without mixing the URLs of separate
 * authorised files, users, games or buckets. On batch failure the existing
 * per-file RLS checked signing path is retained.
 */
export async function signDocumentAssetBatch(rows:readonly DocumentPath[],options:SignOptions):Promise<SignedLink[]>{
 const unique=new Map<string,{original:string;bucket:AssetBucket;objectPath:string;key:string}>();
 for(const row of rows){
  if(!row.path)continue;
  const target=resolveStoredAsset('game-assets',row.path);
  const key=target.bucket+':'+target.path;
  if(!unique.has(key))unique.set(key,{original:row.path,bucket:target.bucket==='teacher-assets'?'teacher-assets':'game-assets',objectPath:target.path,key});
 }
 const urls=new Map<string,string|null>();
 const groups=new Map<AssetBucket,Array<{original:string;bucket:AssetBucket;objectPath:string;key:string}>>();
 const cached:Promise<void>[]=[];
 for(const item of unique.values()){
  const existing=options.cached(item.key);
  if(existing){
   cached.push(existing.then(url=>{if(options.isCurrent())urls.set(item.key,url)}).catch(()=>{}));
  }else{
   const bucketRows=groups.get(item.bucket)||[];
   bucketRows.push(item);
   groups.set(item.bucket,bucketRows);
  }
 }
 await Promise.all(cached);
 if(!options.isCurrent())return rows.map(row=>({id:row.id,path:row.path,url:null}));
 // At most 20 objects per request and a single batch in flight.
 for(const [bucket,items] of groups){
  for(let offset=0;offset<items.length;offset+=20){
   if(!options.isCurrent())break;
   const chunk=items.slice(offset,offset+20);
   let matches=new Map<string,string>();
   if(chunk.length>1){
    try{
     const response=await options.signMany(bucket,chunk.map(item=>item.objectPath));
     if(!response.error&&Array.isArray(response.data)){
      const requested=new Set(chunk.map(item=>item.objectPath));
      matches=new Map(response.data.filter(item=>item.path&&item.signedUrl&&!item.error&&requested.has(item.path))
       .map(item=>[item.path as string,item.signedUrl as string]));
     }
    }catch{/* The existing single-file path is the bounded fallback. */}
   }
   // A failed batch or per-file denial never gets substituted with another path.
   const results=await Promise.all(chunk.map(async item=>{
    if(!options.isCurrent())return [item.key,null] as const;
    const found=matches.get(item.objectPath);
    const url=found||await options.signOne(item.original).catch(()=>null);
    return [item.key,url] as const;
   }));
   if(!options.isCurrent())break;
   for(const [key,url] of results){
    urls.set(key,url);
    if(url)options.store(key,url);
   }
  }
 }
 return rows.map(row=>{
  if(!options.isCurrent()||!row.path)return{id:row.id,path:row.path,url:null};
  const target=resolveStoredAsset('game-assets',row.path);
  return{id:row.id,path:row.path,url:urls.get(target.bucket+':'+target.path)||null};
 });
}
