'use client';
import {useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';

/* Storage contains navigation and UI state, scoped to the signed-in game member. */
export function useSavedGameState<T>(gameId:string|undefined,userId:string|undefined,section:string,initial:T|(()=>T),valid:(value:unknown)=>boolean):[T,Dispatch<SetStateAction<T>>,boolean,boolean]{
 const [value,setValue]=useState<T>(initial);
 const [hydration,setHydration]=useState({key:'',restored:false});
 const fallback=useRef(value),validate=useRef(valid);validate.current=valid;
 const key=gameId&&userId?'gos-sims:section:'+gameId+':'+userId+':'+section:'';
 useEffect(()=>{
  if(!key)return;
  let restored=fallback.current,found=false;
  try{
   const raw=localStorage.getItem(key);
   if(raw){
    const saved:unknown=JSON.parse(raw);
    if(validate.current(saved)){restored=saved as T;found=true;}
   }
  }catch{/* Browser storage can be disabled. Navigation still works. */}
  // Mark hydration and restore state together. Do not run onboarding routing
  // or overwrite storage until the correct game/member key has been restored.
  setValue(restored);
  setHydration({key,restored:found});
 },[key]);
 const hydrated=!!key&&hydration.key===key;
 useEffect(()=>{
  if(!hydrated)return;
  try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Preserve the current screen even without storage. */}
 },[key,hydrated,value]);
 return [value,setValue,hydrated,hydrated&&hydration.restored];
}
export const savedChoice=(...choices:string[])=>(value:unknown)=>typeof value==='string'&&choices.includes(value);
export const savedString=(value:unknown)=>typeof value==='string'&&value.length<=400;
export const savedBoolean=(value:unknown)=>typeof value==='boolean';
