'use client';
import {supabase} from '@/lib/supabase';

export type StageDeadlineRule={
 game_id:string;stage_no:number;deadline_at:string|null;inclusive:boolean;
 penalty_points:number;penalty_description:string;
 consequence_type:'none'|'representation_loss'|'regional_seat_loss'|'ghost_risk'|'presidential_rating_loss';
 consequence_magnitude:number|null;updated_at:string;
};
type Result={data:StageDeadlineRule|null;error:{message:string}|null};
const pending=new Map<string,Promise<Result>>();
const recent=new Map<string,{result:Result;expires:number}>();
const invalidationVersion=new Map<string,number>();
const TTL_MS=10000;
function key(gameId:string,stageNo:number,userId:string){return JSON.stringify([gameId,stageNo,userId])}
/** Share one authorized RLS read among concurrently opened deadline widgets; never share between users or games. */
export function getStageDeadlineRule(gameId:string,stageNo:number,userId:string):Promise<Result>{
 const k=key(gameId,stageNo,userId);
 const cached=recent.get(k);
 if(cached&&cached.expires>Date.now())return Promise.resolve(cached.result);
 const running=pending.get(k);
 if(running)return running;
 const initialVersion=invalidationVersion.get(k)||0;
 const task=Promise.resolve(supabase.from('stage_deadline_rules')
  .select('game_id,stage_no,deadline_at,inclusive,penalty_points,penalty_description,consequence_type,consequence_magnitude,updated_at')
  .eq('game_id',gameId).eq('stage_no',stageNo).maybeSingle())
  .then(({data,error})=>{
   const result={data:(data||null) as StageDeadlineRule|null,error:error?{message:error.message}:null};
   if(!result.error&&initialVersion===(invalidationVersion.get(k)||0)){
    if(recent.size>32)recent.clear();
    recent.set(k,{result,expires:Date.now()+TTL_MS});
   }
   return result;
  }).finally(()=>{if(pending.get(k)===task)pending.delete(k)});
 pending.set(k,task);
 return task;
}
/** Immediately drop cached values after mutations. Server validates every write independently. */
export function invalidateStageDeadlineRule(gameId:string,stageNo:number){
 for(const k of new Set([...recent.keys(),...pending.keys()])){
  try{const parts=JSON.parse(k) as [string,number,string];if(parts[0]===gameId&&parts[1]===stageNo){recent.delete(k);pending.delete(k);invalidationVersion.set(k,(invalidationVersion.get(k)||0)+1)}}
  catch{recent.delete(k)}
 }
}
