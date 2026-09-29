'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {Check,LayoutGrid} from 'lucide-react';
import type {ReactNode,PointerEvent as ReactPointerEvent,KeyboardEvent as ReactKeyboardEvent} from 'react';
import type {View} from './types';

export type MobileDockItem={key:View;label:string;icon:ReactNode};

/** Keep saved order, append new routes and never expose routes the current role cannot access. */
export function normalizeDockOrder(saved:unknown,available:View[]):View[]{
 const valid=Array.isArray(saved)?saved.filter((key):key is View=>typeof key==='string'&&available.includes(key as View)):[];
 return [...new Set([...valid,...available])];
}
export function moveDockItem<T>(items:T[],from:T,to:T):T[]{
 const source=items.indexOf(from),target=items.indexOf(to);
 if(source<0||target<0||source===target)return items;
 const result=[...items], [moved]=result.splice(source,1);
 result.splice(target,0,moved);
 return result;
}
type Candidate={
 id:number; key:View; x:number; y:number;
 active:boolean; timer:ReturnType<typeof setTimeout>|null;
};

export default function MobileDock({items,activeView,storageKey,editing,setEditing,onNavigate,onAll}:{
 items:MobileDockItem[]; activeView:View; storageKey:string; editing:boolean;
 setEditing:(next:boolean)=>void; onNavigate:(key:View)=>void; onAll:()=>void;
}){
 const scrollRef=useRef<HTMLDivElement>(null);
 const dragRef=useRef<Candidate|null>(null);
 const orderRef=useRef<View[]>([]);
 const allowedRef=useRef<View[]>([]);
 const editingRef=useRef(editing);
 const ignoreClickUntil=useRef(0);
 const [order,setOrder]=useState<View[]>([]);
 const [dragging,setDragging]=useState<View|null>(null);
 const [point,setPoint]=useState<{x:number;y:number}|null>(null);
 const allowed=useMemo(()=>items.map(i=>i.key),[items]);
 allowedRef.current=allowed;
 editingRef.current=editing;
 const ordered=normalizeDockOrder(order,allowed).map(key=>items.find(i=>i.key===key)!).filter(Boolean);
 const ghostItem=items.find(i=>i.key===dragging);

 function clearTimer(){
  const c=dragRef.current;
  if(c?.timer){clearTimeout(c.timer);c.timer=null}
 }
 function finish(){
  clearTimer();
  dragRef.current=null;
  setDragging(null);
  setPoint(null);
 }
 function persistOrder(next:View[]){
  orderRef.current=next;
  setOrder(next);
  try{localStorage.setItem(storageKey,JSON.stringify(next))}catch{/* Storage may be disabled. */}
 }
 function reorder(from:View,to:View){
  const current=normalizeDockOrder(orderRef.current,allowedRef.current);
  const next=moveDockItem(current,from,to);
  if(next.every((key,i)=>key===current[i]))return;
  persistOrder(next);
 }
 function hitTarget(x:number,y:number){
  const el=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-dock-item]');
  const target=el?.dataset.dockItem as View|undefined;
  return target&&allowedRef.current.includes(target)?target:null;
 }
 function edgeScroll(x:number){
  const scroller=scrollRef.current;
  if(!scroller)return;
  const rect=scroller.getBoundingClientRect();
  if(x<rect.left+42)scroller.scrollLeft-=23;
  else if(x>rect.right-42)scroller.scrollLeft+=23;
 }
 function activate(candidate:Candidate){
  if(dragRef.current!==candidate)return;
  candidate.active=true;
  candidate.timer=null;
  ignoreClickUntil.current=Date.now()+1200;
  editingRef.current=true;
  setEditing(true);
  setDragging(candidate.key);
  setPoint({x:candidate.x,y:candidate.y});
  if(typeof navigator!=='undefined'&&'vibrate' in navigator)navigator.vibrate(12);
 }
 function start(key:View,id:number,x:number,y:number,immediate:boolean){
  finish();
  const candidate:Candidate={key,id,x,y,active:false,timer:null};
  dragRef.current=candidate;
  if(immediate)activate(candidate);
  else candidate.timer=setTimeout(()=>activate(candidate),420);
 }
 function dragTo(x:number,y:number){
  const candidate=dragRef.current;
  if(!candidate?.active)return;
  setPoint({x,y});
  edgeScroll(x);
  const target=hitTarget(x,y);
  if(target&&candidate.key!==target)reorder(candidate.key,target);
 }
 useEffect(()=>{
  let stored:unknown;
  try{stored=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{stored=null}
  const next=normalizeDockOrder(stored,allowedRef.current);
  orderRef.current=next;
  setOrder(next);
  return()=>finish();
 },[storageKey]);
 useEffect(()=>{
  if(!editing)finish();
 },[editing]);
 useEffect(()=>{
  const scroller=scrollRef.current;
  if(!scroller)return;
  // Native, explicitly non-passive touchmove is necessary on iOS Safari:
  // React's delegated touch handlers may be passive, allowing the browser
  // to cancel the drag as soon as the finger moves.
  function touchStart(event:TouchEvent){
   if(event.touches.length!==1)return;
   const key=(event.target as Element).closest<HTMLElement>('[data-dock-item]')?.dataset.dockItem as View|undefined;
   if(!key||!allowedRef.current.includes(key))return;
   const t=event.touches[0];
   start(key,-1,t.clientX,t.clientY,editingRef.current);
  }
  function touchMove(event:TouchEvent){
   const candidate=dragRef.current;
   if(!candidate||candidate.id!==-1||event.touches.length!==1)return;
   const t=event.touches[0];
   if(!candidate.active){
    // A normal sideways swipe must still scroll the entire bottom bar.
    if(Math.hypot(t.clientX-candidate.x,t.clientY-candidate.y)>9)finish();
    return;
   }
   if(event.cancelable)event.preventDefault();
   dragTo(t.clientX,t.clientY);
  }
  function touchEnd(event:TouchEvent){
   if(dragRef.current?.id!==-1)return;
   const t=event.changedTouches[0];
   if(dragRef.current.active){
    if(t)dragTo(t.clientX,t.clientY);
    ignoreClickUntil.current=Date.now()+800;
   }
   finish();
  }
  function touchCancel(){
   if(dragRef.current?.id===-1)finish();
  }
  scroller.addEventListener('touchstart',touchStart,{passive:true});
  document.addEventListener('touchmove',touchMove,{passive:false});
  document.addEventListener('touchend',touchEnd,{passive:true});
  document.addEventListener('touchcancel',touchCancel,{passive:true});
  return()=>{
   scroller.removeEventListener('touchstart',touchStart);
   document.removeEventListener('touchmove',touchMove);
   document.removeEventListener('touchend',touchEnd);
   document.removeEventListener('touchcancel',touchCancel);
  };
 },[storageKey]);
 useEffect(()=>{
  const scroller=scrollRef.current;
  if(!scroller||editing)return;
  const active=scroller.querySelector<HTMLElement>('[data-dock-item][aria-current="page"]');
  if(!active)return;
  const left=active.offsetLeft-scroller.offsetLeft,right=left+active.offsetWidth;
  if(left<scroller.scrollLeft||right>scroller.scrollLeft+scroller.clientWidth){
   scroller.scrollTo({left:Math.max(0,left-(scroller.clientWidth-active.offsetWidth)/2),
    behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
 },[activeView,order,editing]);
 function pointerDown(event:ReactPointerEvent<HTMLButtonElement>,key:View){
  // Touch is handled by native listeners so finger scrolling remains native.
  if(event.pointerType==='touch'||!event.isPrimary||(event.pointerType==='mouse'&&event.button!==0))return;
  start(key,event.pointerId,event.clientX,event.clientY,editingRef.current);
  try{event.currentTarget.setPointerCapture(event.pointerId)}catch{/* Browser-specific. */}
 }
 function pointerMove(event:ReactPointerEvent<HTMLButtonElement>){
  const c=dragRef.current;
  if(!c||c.id!==event.pointerId)return;
  if(!c.active){
   if(Math.hypot(event.clientX-c.x,event.clientY-c.y)>9)finish();
   return;
  }
  dragTo(event.clientX,event.clientY);
 }
 function pointerEnd(event:ReactPointerEvent<HTMLButtonElement>){
  const c=dragRef.current;
  if(!c||c.id!==event.pointerId)return;
  if(c.active){
   dragTo(event.clientX,event.clientY);
   ignoreClickUntil.current=Date.now()+800;
  }
  finish();
  try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}catch{}
 }
 function keyboardMove(event:ReactKeyboardEvent<HTMLButtonElement>,key:View){
  if(!editing||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const keys=ordered.map(item=>item.key),at=keys.indexOf(key);
  const target=event.key==='Home'?0:event.key==='End'?keys.length-1:
   event.key==='ArrowLeft'?Math.max(0,at-1):Math.min(keys.length-1,at+1);
  reorder(key,keys[target]);
 }
 return <>
  <nav className={'mobileDock mobileDockV2 '+(editing?'isEditing':'')} aria-label={editing?'Изменение порядка мобильной панели':'Мобильная навигация'}>
   <div ref={scrollRef} className="mobileDockScroll" aria-label="Прокручиваемые разделы">
    {ordered.map(item=><button type="button" key={item.key}
     data-dock-item={item.key} aria-current={activeView===item.key?'page':undefined}
     aria-label={editing?item.label+'. Перемещайте удержанием или стрелками.':item.label}
     title={editing?'Перетащите значок':item.label}
     className={'mobileDockItem '+(activeView===item.key?'active ':'')+(dragging===item.key?'isDragged':'')}
     onPointerDown={event=>pointerDown(event,item.key)}
     onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}
     onContextMenu={event=>{if(editing||dragRef.current?.key===item.key)event.preventDefault()}}
     onDragStart={event=>event.preventDefault()}
     onKeyDown={event=>keyboardMove(event,item.key)}
     onClick={event=>{
      if(editingRef.current||Date.now()<ignoreClickUntil.current){event.preventDefault();return}
      onNavigate(item.key);
     }}>
     <span className="mobileDockIcon">{item.icon}</span>
     <span className="mobileDockLabel">{item.label}</span>
    </button>)}
   </div>
   <div className="mobileDockFixed">
    {editing?<button type="button" className="mobileDockDone" onClick={()=>{finish();setEditing(false)}}><Check aria-hidden="true"/><span>Готово</span></button>:
     <button type="button" className="mobileDockAll" aria-haspopup="dialog" onClick={onAll}><LayoutGrid aria-hidden="true"/><span>Все разделы</span></button>}
   </div>
  </nav>
  {dragging&&point&&ghostItem&&<div className="mobileDockGhost" aria-hidden="true" style={{left:point.x,top:point.y}}>
   <span>{ghostItem.icon}</span><small>{ghostItem.label}</small>
  </div>}
 </>;
}
