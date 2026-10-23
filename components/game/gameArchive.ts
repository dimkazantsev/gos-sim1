import {userError} from '@/lib/userError';
import {supabase} from '@/lib/supabase';
import {preparePortableSession,type SessionArchive} from './portableSession';
type ArchiveFile={path:string;data:Uint8Array};
function crc32(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=c&1?(c>>>1)^0xedb88320:c>>>1}return (c^0xffffffff)>>>0}
function uint16(v:number){return [v&255,(v>>>8)&255]}
function uint32(v:number){return [v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]}
/** Self-contained ZIP (stored entries): extractable without third-party services. */
function zip(files:ArchiveFile[]):Blob{
 const encoder=new TextEncoder();
 const chunks:BlobPart[]=[];const directory:number[]=[];let offset=0;
 for(const file of files){
  const name=encoder.encode(file.path),data=file.data,crc=crc32(data);
  if(data.byteLength>0xffffffff||name.length>0xffff||offset>0xffffffff)throw Error('Архив слишком велик для экспорта в браузере.');
  const header=new Uint8Array([...uint32(0x04034b50),...uint16(20),...uint16(0x800),...uint16(0),...uint16(0),...uint16(0),
   ...uint32(crc),...uint32(data.length),...uint32(data.length),...uint16(name.length),...uint16(0),...name]);
  chunks.push(header as BlobPart,data as BlobPart);
  directory.push(...uint32(0x02014b50),...uint16(20),...uint16(20),...uint16(0x800),...uint16(0),...uint16(0),...uint16(0),...uint32(crc),...uint32(data.length),...uint32(data.length),
   ...uint16(name.length),...uint16(0),...uint16(0),...uint16(0),...uint16(0),...uint32(0),...uint32(offset),...name);
  offset+=header.length+data.length;
 }
 const central=new Uint8Array(directory);
 const ending=new Uint8Array([...uint32(0x06054b50),...uint16(0),...uint16(0),
  ...uint16(files.length),...uint16(files.length),...uint32(central.length),...uint32(offset),...uint16(0)]);
 chunks.push(central as BlobPart,ending as BlobPart);
 return new Blob(chunks,{type:'application/zip'});
}
export async function enumerateGameAssets(gameId:string,bucket:'game-assets'|'game-media',prefix=gameId):Promise<string[]>{
 const found:string[]=[];
 for(let offset=0;;offset+=100){
  const r=await supabase.storage.from(bucket).list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}});
  if(r.error)throw Error('Не удалось получить список файлов '+bucket+': '+userError(r.error));
  const items=r.data||[];
  for(const item of items){
   const path=prefix+'/'+item.name;
   if(!item.id){found.push(...await enumerateGameAssets(gameId,bucket,path))}
   else found.push(path);
  }
  if(items.length<100)break;
 }
 return found;
}
/** Export a bounded number of tables and rows per request (no global database timeout changes). */
export async function readFullGameData(gameId:string,onProgress?:(done:number,total:number)=>void):Promise<SessionArchive>{
 const manifest=await supabase.rpc('export_game_manifest',{p_game:gameId});
 if(manifest.error||!manifest.data)throw Error('Не удалось начать экспорт: '+(userError(manifest.error)||'Нет данных'));
 const data=manifest.data as Omit<SessionArchive,'tables'>&{tables:string[]};
 if(data.format!=='GOS-SIMS'||data.schema!==2||!Array.isArray(data.tables))throw Error('Сервер вернул некорректное описание архива.');
 const names=data.tables;
 const tables:SessionArchive['tables']={};
 const pageSize=100;
 let complete=0;
 for(let i=0;i<names.length;i+=5){
  const group=names.slice(i,i+5);
  const first=await supabase.rpc('export_game_data_batch',{p_game:gameId,p_tables:group,p_offset:0,p_limit:pageSize});
  if(first.error||!first.data)throw Error('Не удалось выгрузить таблицы '+group.join(', ')+': '+(userError(first.error)||'Нет данных'));
  for(const name of group){
   const page=(first.data as Record<string,unknown>)[name];
   if(!Array.isArray(page))throw Error('Неполный ответ сервера для таблицы '+name);
   const rows=[...page];
   while(rows.length>0&&rows.length%pageSize===0){
    const next=await supabase.rpc('export_game_data_batch',{p_game:gameId,p_tables:[name],p_offset:rows.length,p_limit:pageSize});
    if(next.error||!next.data)throw Error('Не удалось продолжить выгрузку '+name+': '+(userError(next.error)||'Нет данных'));
    const nextPage=(next.data as Record<string,unknown>)[name];
    if(!Array.isArray(nextPage))throw Error('Неполный ответ сервера для таблицы '+name);
    rows.push(...nextPage);
    if(nextPage.length<pageSize)break;
   }
   tables[name]=rows;
   onProgress?.(++complete,names.length);
  }
 }
 return {...data,tables} as SessionArchive;
}
export async function downloadFullGameArchive(gameId:string,onProgress?:(done:number,total:number)=>void):Promise<Blob>{
 const data=await readFullGameData(gameId,onProgress);
 const portable=await preparePortableSession(data);
 const encode=(text:string)=>new TextEncoder().encode(text);
 const entries:ArchiveFile[]=[
  {path:'game.json',data:encode(JSON.stringify(portable.data,null,2))},
  {path:'index.html',data:encode(portable.html)},
  {path:'server.mjs',data:encode(portable.server)},
  {path:'engine.mjs',data:encode(portable.engine)},
  {path:'RESTORE-README.txt',data:encode(portable.readme)}
 ];
 const paths=await Promise.all((['game-assets','game-media'] as const).map(async bucket=>({bucket,paths:await enumerateGameAssets(gameId,bucket)})));
 const total=paths.reduce((n,x)=>n+x.paths.length,0);let done=0;
 for(const group of paths)for(const path of group.paths){
  const fetched=await supabase.storage.from(group.bucket).download(path);
  if(fetched.error||!fetched.data)throw Error('Не удалось включить файл '+path+' в архив: '+(userError(fetched.error)||'Файл недоступен'));
  entries.push({path:'media/'+group.bucket+'/'+path,data:new Uint8Array(await fetched.data.arrayBuffer())});
  onProgress?.(++done,total);
 }
 return zip(entries);
}
export async function purgeGameAssets(gameId:string,onProgress?:(done:number,total:number)=>void){
 const groups=await Promise.all((['game-assets','game-media'] as const).map(async bucket=>({bucket,paths:await enumerateGameAssets(gameId,bucket)})));
 const total=groups.reduce((n,g)=>n+g.paths.length,0);let done=0;
 for(const group of groups){
  for(let i=0;i<group.paths.length;i+=100){
   const current=group.paths.slice(i,i+100);
   const r=await supabase.storage.from(group.bucket).remove(current);
   if(r.error)throw Error('Не удалось удалить файлы '+group.bucket+': '+userError(r.error));
   done+=current.length;onProgress?.(done,total);
  }
 }
}
export function saveGameBlob(file:Blob,name:string){
 const url=URL.createObjectURL(file),anchor=document.createElement('a');
 anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),10000);
}
