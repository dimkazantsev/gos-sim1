import type {SessionArchive} from './portableSession';

type RpcResult={data:unknown;error:unknown};
type ExportRpc=(name:'export_game_manifest'|'export_game_data_batch',args:Record<string,unknown>)=>Promise<RpcResult>;

// Keep individual exports below PostgREST's statement timeout and avoid one
// potentially enormous JSON response. Each request is read-only and bounded.
const TABLES_PER_REQUEST=3;
const ROWS_PER_REQUEST=100;

/** Download exactly the same game tables as the legacy one-shot export RPC. */
export async function fetchGameArchiveBatched(
 gameId:string,
 rpc:ExportRpc,
 onProgress?:(completedTables:number,totalTables:number)=>void
):Promise<SessionArchive>{
 const manifestResponse=await rpc('export_game_manifest',{p_game:gameId});
 if(manifestResponse.error)throw manifestResponse.error;
 const manifest=manifestResponse.data;
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw Error('Сервер вернул некорректный список данных сеанса.');
 const source=manifest as Record<string,unknown>;
 const names=source.tables;
 if(source.format!=='GOS-SIMS'||source.schema!==2||!source.game||
    !Array.isArray(names)||!names.every(name=>typeof name==='string'&&name.length>0)||
    new Set(names).size!==names.length)
  throw Error('Сервер вернул некорректный список данных сеанса.');
 const tables:SessionArchive['tables']={};
 for(const name of names)tables[name]=[];
 let completed=0;
 for(let index=0;index<names.length;index+=TABLES_PER_REQUEST){
  let pending=names.slice(index,index+TABLES_PER_REQUEST) as string[];
  let offset=0;
  while(pending.length){
   const response=await rpc('export_game_data_batch',{
    p_game:gameId,p_tables:pending,p_offset:offset,p_limit:ROWS_PER_REQUEST
   });
   if(response.error)throw response.error;
   if(!response.data||typeof response.data!=='object'||Array.isArray(response.data))
    throw Error('Сервер вернул неполную порцию архива.');
   const batch=response.data as Record<string,unknown>;
   const next:string[]=[];
   for(const name of pending){
    const rows=batch[name];
    if(!Array.isArray(rows)||rows.length>ROWS_PER_REQUEST)
     throw Error('Сервер вернул неполные данные таблицы «'+name+'».');
    tables[name].push(...rows);
    if(rows.length===ROWS_PER_REQUEST)next.push(name);
    else completed++;
   }
   onProgress?.(completed,names.length);
   pending=next;
   offset+=ROWS_PER_REQUEST;
  }
 }
 const {tables:ignored,...metadata}=source;
 void ignored;
 return {...metadata,tables} as SessionArchive;
}
