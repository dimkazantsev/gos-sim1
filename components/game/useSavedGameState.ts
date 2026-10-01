'use client';
import {useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';

/* Storage contains navigation and UI state, scoped to the signed-in game member. */
export function useSavedGameState<T>(gameId:string|undefined,userId:string|undefined,section:string,initial:T|(()=>T),valid:(value:unknown)=>boolean):[T,Dispatch<SetStateAction<T>>]{
 const [value,setValue]=useState<T>(initial),[hydratedKey,setHydratedKey]=useState('');
 const fallback=useRef(value),validate=useRef(valid);validate.current=valid;
 const key=gameId&&userId?'gos-sims:section:'+gameId+':'+userId+':'+section:'';
 useEffect(()=>{
  if(!key)return;
  let restored=fallback.current;
  try{const raw=localStorage.getItem(key);if(raw){const saved:unknown=JSON.parse(raw);if(validate.current(saved))restored=saved as T;}}
  catch{/* Browser storage can be disabled. Navigation still works. */}
  setValue(restored);setHydratedKey(key);
 },[key]);
 useEffect(()=>{
  if(!key||key!==hydratedKey)return;
  try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Preserve the current screen even without storage. */}
 },[key,hydratedKey,value]);
 return [value,setValue];
}
export const savedChoice=(...choices:string[])=>(value:unknown)=>typeof value==='string'&&choices.includes(value);
export const savedString=(value:unknown)=>typeof value==='string'&&value.length<=400;
export const savedBoolean=(value:unknown)=>typeof value==='boolean';
