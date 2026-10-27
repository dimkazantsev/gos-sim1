import type {Stage,Metric,EventItem} from '@/components/game/types';

// Whitelisted, already-visible presentation data only. Absolutely no credentials,
// hidden evaluations, members, ballots, chats, storage URLs or protected answers.
type Snapshot={stages:Stage[];metrics:Metric[];events:EventItem[]};
type RecordValue={savedAt:number;payload:Snapshot};
const DB='gos-id-public-snapshot-v1',STORE='published',MAX_AGE=120000;
export const DEVICE_SNAPSHOT_EVENT='gos-id:device-snapshot-status';
export type DeviceSnapshotStatus='saving'|'saved'|'failed';
export type DeviceSnapshotInfo={savedAt:number;stages:number;metrics:number;events:number};
export type DeviceSnapshotEvent={gameId:string;userId:string;status:DeviceSnapshotStatus;info?:DeviceSnapshotInfo};
function inform(event:DeviceSnapshotEvent){
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent<DeviceSnapshotEvent>(DEVICE_SNAPSHOT_EVENT,{detail:event}));
}
function valid(record:RecordValue|null):record is RecordValue{
 return !!record&&Number.isFinite(record.savedAt)&&record.savedAt<=Date.now()&&Date.now()-record.savedAt<=MAX_AGE;
}
function counts(record:RecordValue):DeviceSnapshotInfo{
 return {savedAt:record.savedAt,stages:record.payload.stages.length,
  metrics:record.payload.metrics.length,events:record.payload.events.length};
}

function key(gameId:string,userId:string){return gameId+':'+userId}
async function db():Promise<IDBDatabase|null>{
 if(typeof window==='undefined'||!('indexedDB' in window))return null;
 return new Promise(resolve=>{
  let r:IDBOpenDBRequest;
  try{r=indexedDB.open(DB,1)}catch{return resolve(null)}
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};
  r.onsuccess=()=>resolve(r.result);
  r.onerror=()=>resolve(null);
  r.onblocked=()=>resolve(null);
 });
}
async function transaction<T>(mode:IDBTransactionMode,keyValue:string,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T|null>{
 const database=await db();if(!database)return null;
 return new Promise(resolve=>{
  let done=false;const finish=(v:T|null)=>{if(done)return;done=true;database.close();resolve(v)};
  try{
   const tx=database.transaction(STORE,mode),r=action(tx.objectStore(STORE));
   let value:T|null=null;
   r.onsuccess=()=>{value=r.result};
   r.onerror=()=>finish(null);
   // Request success is not a durable write: report success after commit.
   tx.oncomplete=()=>finish(value);
   tx.onabort=()=>finish(null);
   tx.onerror=()=>finish(null);
  }catch{finish(null)}
 });
}
function published(data:Snapshot):Snapshot{
 return{
  stages:data.stages.slice(0,16).map(s=>({
   id:s.id,game_id:s.game_id,stage_no:s.stage_no,title:s.title,
   mode:s.mode,summary:s.summary,status:s.status,deadline:s.deadline,
   opened_at:s.opened_at,completed_at:s.completed_at,score_closed_at:s.score_closed_at||null
  })),
  metrics:data.metrics.filter(m=>m.is_public).slice(0,64).map(m=>({
   id:m.id,game_id:m.game_id,metric_key:m.metric_key,label:m.label,
   value:m.value,previous_value:m.previous_value,unit:m.unit,is_public:true,
   group_key:m.group_key,description:m.description,min_value:m.min_value,
   max_value:m.max_value,sort_order:m.sort_order
  })),
  events:data.events.filter(e=>!!e.published_at).slice(0,80).map(e=>({
   id:e.id,game_id:e.game_id,category:e.category,severity:e.severity,
   title:e.title,body:e.body,round_no:e.round_no,published_at:e.published_at
  }))
 };
}
export async function writeLocalGameSnapshot(gameId:string,userId:string,data:Snapshot){
 if(!gameId||!userId)return;
 const record:RecordValue={savedAt:Date.now(),payload:published(data)};
 inform({gameId,userId,status:'saving'});
 try{
  const written=await transaction('readwrite',key(gameId,userId),store=>store.put(record,key(gameId,userId)));
  if(written===null){inform({gameId,userId,status:'failed'});return}
  inform({gameId,userId,status:'saved',info:counts(record)});
 }catch{inform({gameId,userId,status:'failed'})}
}
export async function readLocalGameSnapshot(gameId:string,userId:string):Promise<Snapshot|null>{
 if(!gameId||!userId)return null;
 try{
  const result=await transaction('readonly',key(gameId,userId),store=>store.get(key(gameId,userId))) as RecordValue|null;
  if(!valid(result))return null;
  return result.payload;
 }catch{return null}
}
export async function deleteLocalGameSnapshot(gameId:string,userId:string){
 if(!gameId||!userId)return;
 try{await transaction('readwrite',key(gameId,userId),store=>store.delete(key(gameId,userId)))}catch{/* optional */}
}

/** Local-only metadata. No Supabase request and no secret content returned. */
export async function getLocalGameSnapshotInfo(gameId:string,userId:string):Promise<DeviceSnapshotInfo|null>{
 if(!gameId||!userId)return null;
 try{
  const result=await transaction('readonly',key(gameId,userId),store=>store.get(key(gameId,userId))) as RecordValue|null;
  return valid(result)?counts(result):null;
 }catch{return null}
}
