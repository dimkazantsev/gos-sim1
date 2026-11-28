'use client';
import {useLayoutEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';
import {appendHistory,browserMarker,BROWSER_SECTION_KEY,historyDistance,readBrowserScreen,restoreHistory,startHistory,type PositionedScreen,type SectionHistory} from './browserSectionHistory';

type Options<T extends PositionedScreen>={
 scope:string;enabled:boolean;state:SectionHistory<T>;setState:Dispatch<SetStateAction<SectionHistory<T>>>;
 valid:(value:unknown)=>boolean;same:(a:T,b:T)=>boolean;
 initial:(saved:T)=>T;normalize:(screen:T,fromPop:boolean)=>T;
 url:(screen:T)=>string;onPop:()=>void;
};
export function useBrowserSectionHistory<T extends PositionedScreen>(options:Options<T>){
 const config=useRef(options);config.current=options;
 const current=useRef<SectionHistory<T>|null>(null);
 const [initialized,setInitialized]=useState('');
 const {scope,enabled}=options;
 function persist(next:SectionHistory<T>){
  current.current=next;config.current.setState(next);
  try{sessionStorage.setItem('gos-id:section-history:'+config.current.scope,JSON.stringify(next))}catch{/* Storage can be unavailable. */}
 }
 function write(next:SectionHistory<T>,push:boolean){
  const o=config.current,m=browserMarker(next,o.scope);
  const data={[BROWSER_SECTION_KEY]:m},url=o.url(m.screen);
  // Next.js supports native History API calls on the same route.
  // No router navigation, session refresh or server request is needed here.
  if(push)window.history.pushState(data,'',url);
  else window.history.replaceState(data,'',url);
 }
 useLayoutEffect(()=>{
  if(!enabled||!scope)return;
  const o=config.current;
  const marker=readBrowserScreen<T>(window.history.state,scope,o.valid);
  let next:SectionHistory<T>;
  if(marker){
   let saved:SectionHistory<T>|null=null;
   try{
    const parsed=JSON.parse(sessionStorage.getItem('gos-id:section-history:'+scope)||'null');
    if(parsed?.chain===marker.chain&&Array.isArray(parsed.entries)&&parsed.entries.length<=60&&parsed.entries.every((x:unknown)=>o.valid(x)))saved=parsed;
   }catch{/* A native entry is sufficient to restore its own screen. */}
   next=restoreHistory(saved,marker,o.normalize(marker.screen,false));
  }else{
   const chain=typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
   next=startHistory(o.normalize(o.initial(o.state.entries[o.state.index]),false),chain);
  }
  // Replace, never push on entry, refresh or hydration.
  write(next,false);persist(next);setInitialized(scope);
  function pop(event:PopStateEvent){
   const latest=config.current,m=readBrowserScreen<T>(event.state,scope,latest.valid);
   if(!m||latest.scope!==scope)return; // Ordinary navigation outside this game is not intercepted.
   const normalized=latest.normalize(m.screen,true);
   const restored=restoreHistory(current.current,m,normalized);
   if(!latest.same(normalized,m.screen))write(restored,false);
   persist(restored);latest.onPop();
  }
  window.addEventListener('popstate',pop);
  return()=>{window.removeEventListener('popstate',pop);current.current=null;};
 },[scope,enabled]);
 function push(screen:T){
  const h=current.current,o=config.current;
  if(!h||!enabled||initialized!==scope)return false;
  const next=appendHistory(h,screen,o.same);
  if(next===h)return false;
  write(next,true);persist(next);return true;
 }
 function move(index:number){
  const h=current.current;if(!h||!enabled||initialized!==scope)return;
  const delta=historyDistance(h,index);if(delta)window.history.go(delta);
 }
 return {ready:enabled&&initialized===scope,push,move};
}
