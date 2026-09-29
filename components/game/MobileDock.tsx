'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {Check,LayoutGrid,MessageCircle,Pin} from 'lucide-react';
import type {ReactNode,PointerEvent as ReactPointerEvent,KeyboardEvent as ReactKeyboardEvent} from 'react';
import type {View} from './types';

export type MobileDockItem={key:View;label:string;icon:ReactNode};

export function normalizeDockOrder(saved:unknown,available:View[]):View[]{
 const valid=Array.isArray(saved)?saved.filter((key):key is View=>typeof key==='string'&&available.includes(key as View)):[];
 return [...new Set([...valid,...available])];
}
export function moveDockItem<T>(items:T[],from:T,to:T):T[]{
 const source=items.indexOf(from),target=items.indexOf(to);
 if(source<0||target<0||source===target)return items;
 const next=[...items];
 const [item]=next.splice(source,1);
 next.splice(target,0,item);
 return next;
}
export function normalizePinnedDock(saved:unknown,available:View[]):View[]{
 return Array.isArray(saved)?[...new Set(saved.filter((key):key is View=>typeof key==='string'&&available.includes(key as View)))]:[];
}

const DRAG_HOLD_MS=360;
const PIN_HOLD_MS=1450;
const SWIPE_THRESHOLD=6;
type Gesture={
 id:number;key:View;
 startX:number;startY:number;lastX:number;lastY:number;lastTime:number;velocity:number;
 mode:'pending'|'scroll'|'drag';moved:boolean;
 timer:ReturnType<typeof setTimeout>|null;
 pinTimer:ReturnType<typeof setTimeout>|null;
};

export default function MobileDock({items,activeView,storageKey,editing,setEditing,onNavigate,onAll,onChat,chatOpen=false}:{
 items:MobileDockItem[];
 activeView:View;
 storageKey:string;
 editing:boolean;
 setEditing:(value:boolean)=>void;
 onNavigate:(view:View)=>void;
 onAll:()=>void;
 onChat?:()=>void;
 chatOpen?:boolean;
}){
 const scrollRef=useRef<HTMLDivElement>(null);
 const gestureRef=useRef<Gesture|null>(null);
 const pinnedGesture=useRef<{key:View;startX:number;startY:number;timer:ReturnType<typeof setTimeout>|null}|null>(null);
 const suppressClickUntil=useRef(0);
 const [order,setOrder]=useState<View[]>([]);
 const [pinned,setPinned]=useState<View[]>([]);
 const [dragging,setDragging]=useState<View|null>(null);
 const [point,setPoint]=useState<{x:number;y:number}|null>(null);
 const [announcement,setAnnouncement]=useState('');
 const available=useMemo(()=>items.map(i=>i.key),[items]);
 const normalized=normalizeDockOrder(order,available);
 const pinnedKeys=normalizePinnedDock(pinned,available);
 const pinnedSet=new Set(pinnedKeys);
 const ordered=normalized.filter(key=>!pinnedSet.has(key)).map(key=>items.find(item=>item.key===key)!).filter(Boolean);
 const pinnedItems=pinnedKeys.map(key=>items.find(item=>item.key===key)!).filter(Boolean);
 const draggedItem=items.find(i=>i.key===dragging);

 useEffect(()=>{
  let savedOrder:unknown,savedPins:unknown;
  try{savedOrder=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{savedOrder=null}
  try{savedPins=JSON.parse(localStorage.getItem(storageKey+':pinned')||'null')}catch{savedPins=null}
  setOrder(normalizeDockOrder(savedOrder,items.map(i=>i.key)));
  setPinned(normalizePinnedDock(savedPins,items.map(i=>i.key)));
  return()=>{clearGesture();clearPinnedGesture()};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[storageKey]);

 useEffect(()=>{
  if(editing||pinnedSet.has(activeView))return;
  const scroller=scrollRef.current;
  const active=scroller?.querySelector<HTMLButtonElement>('[data-dock-item][aria-current="page"]');
  if(!scroller||!active)return;
  const left=active.offsetLeft-scroller.offsetLeft,right=left+active.offsetWidth;
  if(left<scroller.scrollLeft||right>scroller.scrollLeft+scroller.clientWidth){
   scroller.scrollTo({left:Math.max(0,left-(scroller.clientWidth-active.offsetWidth)/2),behavior:'smooth'});
  }
 },[activeView,order,pinned,editing]);

 function clearGesture(){
  const g=gestureRef.current;
  if(g?.timer)clearTimeout(g.timer);
  if(g?.pinTimer)clearTimeout(g.pinTimer);
  gestureRef.current=null;
  setDragging(null);setPoint(null);
 }
 function clearPinnedGesture(){
  if(pinnedGesture.current?.timer)clearTimeout(pinnedGesture.current.timer);
  pinnedGesture.current=null;
 }
 function persist(next:View[]){
  setOrder(next);
  try{localStorage.setItem(storageKey,JSON.stringify(next))}catch{}
 }
 function reorder(from:View,to:View){
  const current=normalizeDockOrder(order,available);
  const next=moveDockItem(current,from,to);
  if(next.every((key,i)=>key===current[i]))return;
  persist(next);
 }
 function togglePin(key:View){
  const next=pinnedKeys.includes(key)?pinnedKeys.filter(k=>k!==key):[...pinnedKeys,key];
  setPinned(next);
  try{localStorage.setItem(storageKey+':pinned',JSON.stringify(next))}catch{}
  setAnnouncement((next.includes(key)?'Закреплён: ':'Откреплён: ')+(items.find(i=>i.key===key)?.label||key));
  suppressClickUntil.current=Date.now()+700;
  try{navigator.vibrate?.(next.includes(key)?[28,30,28]:18)}catch{}
 }
 function activateDrag(g:Gesture){
  if(gestureRef.current!==g||g.mode!=='pending')return;
  g.mode='drag';g.timer=null;
  suppressClickUntil.current=Date.now()+800;
  setEditing(true);setDragging(g.key);
  setPoint({x:g.lastX,y:g.lastY});
  try{navigator.vibrate?.(18)}catch{}
 }
 function onPointerDown(event:ReactPointerEvent<HTMLButtonElement>,key:View){
  if(!event.isPrimary||(event.pointerType==='mouse'&&event.button!==0))return;
  clearGesture();
  const now=performance.now();
  const g:Gesture={id:event.pointerId,key,startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastY:event.clientY,lastTime:now,velocity:0,mode:'pending',moved:false,timer:null,pinTimer:null};
  gestureRef.current=g;
  try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
  if(editing)activateDrag(g);
  else g.timer=setTimeout(()=>activateDrag(g),DRAG_HOLD_MS);
  // A stationary extra-long hold pins instead of dropping. Any movement cancels it.
  g.pinTimer=setTimeout(()=>{
   if(gestureRef.current!==g||g.moved)return;
   togglePin(key);clearGesture();setEditing(false);
  },PIN_HOLD_MS);
 }
 function onPointerMove(event:ReactPointerEvent<HTMLButtonElement|HTMLDivElement>){
  const g=gestureRef.current;
  if(!g||g.id!==event.pointerId)return;
  const now=performance.now(),dx=event.clientX-g.lastX;
  g.velocity=dx/Math.max(1,now-g.lastTime);
  g.lastTime=now;g.lastX=event.clientX;g.lastY=event.clientY;
  const distance=Math.hypot(event.clientX-g.startX,event.clientY-g.startY);
  if(distance>SWIPE_THRESHOLD){
   g.moved=true;
   if(g.pinTimer){clearTimeout(g.pinTimer);g.pinTimer=null}
   if(g.mode==='pending'){
    if(g.timer){clearTimeout(g.timer);g.timer=null}
    g.mode='scroll';
   }
  }
  if(g.mode==='scroll'){
   if(event.cancelable)event.preventDefault();
   if(scrollRef.current)scrollRef.current.scrollLeft-=dx;
   return;
  }
  if(g.mode!=='drag')return;
  if(event.cancelable)event.preventDefault();
  setPoint({x:event.clientX,y:event.clientY});
  const scroller=scrollRef.current;
  if(scroller&&g.moved){
   const r=scroller.getBoundingClientRect();
   if(event.clientX<r.left+30)scroller.scrollLeft-=11;
   if(event.clientX>r.right-30)scroller.scrollLeft+=11;
  }
 }
 function onPointerEnd(event:ReactPointerEvent<HTMLButtonElement|HTMLDivElement>){
  const g=gestureRef.current;
  if(!g||g.id!==event.pointerId)return;
  const wasDrag=g.mode==='drag',wasScroll=g.mode==='scroll';
  if(wasDrag&&g.moved){
   const under=document.elementFromPoint(event.clientX,event.clientY);
   const target=under?.closest<HTMLButtonElement>('.mobileDockItem[data-dock-item]');
   const key=target?.dataset.dockItem as View|undefined;
   if(key&&key!==g.key&&available.includes(key)&&!pinnedSet.has(key))reorder(g.key,key);
  }
  // Quick swipes move the strip in either direction; no CSS scroll-snap fights pointer movement.
  if(wasScroll&&scrollRef.current&&Math.abs(g.velocity)>.5){
   scrollRef.current.scrollBy({left:Math.max(-140,Math.min(140,-g.velocity*90)),behavior:'smooth'});
  }
  clearGesture();
  if(wasDrag||wasScroll)suppressClickUntil.current=Date.now()+450;
  try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}catch{}
 }
 function onPointerCancel(event:ReactPointerEvent<HTMLButtonElement|HTMLDivElement>){
  if(gestureRef.current?.id===event.pointerId){clearGesture();suppressClickUntil.current=Date.now()+450}
 }
 function onPinnedDown(event:ReactPointerEvent<HTMLButtonElement>,key:View){
  if(!event.isPrimary||(event.pointerType==='mouse'&&event.button!==0))return;
  clearPinnedGesture();
  const g:{key:View;startX:number;startY:number;timer:ReturnType<typeof setTimeout>|null}={key,startX:event.clientX,startY:event.clientY,timer:null};
  pinnedGesture.current=g;
  g.timer=setTimeout(()=>{
   if(pinnedGesture.current!==g)return;
   togglePin(key);clearPinnedGesture();
  },PIN_HOLD_MS);
 }
 function onPinnedMove(event:ReactPointerEvent<HTMLButtonElement>){
  const g=pinnedGesture.current;
  if(g&&Math.hypot(event.clientX-g.startX,event.clientY-g.startY)>SWIPE_THRESHOLD)clearPinnedGesture();
 }
 function click(event:React.MouseEvent<HTMLButtonElement>,key:View){
  if(editing||Date.now()<suppressClickUntil.current){event.preventDefault();event.stopPropagation();return}
  onNavigate(key);
 }
 function keyMove(event:ReactKeyboardEvent<HTMLButtonElement>,key:View){
  if(event.key.toLowerCase()==='p'&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
   event.preventDefault();togglePin(key);setEditing(false);return;
  }
  if(!editing||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const keys=ordered.map(i=>i.key),index=keys.indexOf(key);
  const target=event.key==='Home'?0:event.key==='End'?keys.length-1:event.key==='ArrowLeft'?Math.max(0,index-1):Math.min(keys.length-1,index+1);
  reorder(key,keys[target]);
 }
 return <>
  <nav className={'mobileDock mobileDockV2 '+(editing?'isEditing':'')} aria-label={editing?'Изменение порядка мобильной панели':'Мобильная навигация'}>
   <div ref={scrollRef} className="mobileDockScroll" aria-label="Прокручиваемые разделы" onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerCancel}>
    {ordered.map(item=><button key={item.key} data-dock-item={item.key} type="button"
     aria-current={activeView===item.key?'page':undefined}
     aria-label={editing?item.label+'. Перетащите для изменения порядка или удерживайте ещё для закрепления.':item.label+'. Длительное удержание — перемещение, очень длительное — закрепление.'}
     title={item.label}
     className={'mobileDockItem '+(activeView===item.key?'active ':'')+(dragging===item.key?'isDragged':'')}
     onPointerDown={e=>onPointerDown(e,item.key)}
     onContextMenu={e=>{if(editing||gestureRef.current?.key===item.key)e.preventDefault()}}
     onDragStart={e=>e.preventDefault()} onKeyDown={e=>keyMove(e,item.key)}
     onClick={e=>click(e,item.key)}>
     <span className="mobileDockIcon">{item.icon}</span>
     <span className="mobileDockLabel">{item.label}</span>
    </button>)}
    {onChat&&<button type="button" className={'mobileDockChat mobileDockItem '+(chatOpen?'active':'')}
     aria-controls="game-chat" aria-expanded={chatOpen} aria-label={chatOpen?'Закрыть чат':'Открыть чат'}
     onClick={onChat}><span className="mobileDockIcon"><MessageCircle aria-hidden="true"/></span><span className="mobileDockLabel">Чат</span></button>}
   </div>
   <div className="mobileDockFixed">
    {pinnedItems.length>0&&<div className="mobileDockPinned" aria-label="Закреплённые разделы">
     {pinnedItems.map(item=><button key={item.key} type="button" className={'mobileDockPinnedItem '+(activeView===item.key?'active':'')}
      aria-current={activeView===item.key?'page':undefined}
      aria-label={item.label+'. Удерживайте для открепления.'} title={item.label+' · удерживайте для открепления'}
      onPointerDown={e=>onPinnedDown(e,item.key)} onPointerMove={onPinnedMove}
      onPointerUp={clearPinnedGesture} onPointerCancel={clearPinnedGesture}
      onContextMenu={e=>e.preventDefault()}
      onKeyDown={e=>{if(e.key.toLowerCase()==='p'){e.preventDefault();togglePin(item.key)}}}
      onClick={e=>click(e,item.key)}>
      <span className="mobileDockIcon">{item.icon}<Pin className="mobileDockPinBadge" aria-hidden="true"/></span>
      <span className="mobileDockLabel">{item.label}</span>
     </button>)}
    </div>}
    {editing?
     <button type="button" className="mobileDockDone" onClick={()=>{clearGesture();setEditing(false)}}><Check aria-hidden="true"/><span>Готово</span></button>:
     <button type="button" className="mobileDockAll" aria-haspopup="dialog" onClick={onAll}><LayoutGrid aria-hidden="true"/><span>Все разделы</span></button>}
   </div>
   <span className="mobileDockAnnouncement" role="status" aria-live="polite">{announcement}</span>
  </nav>
  {dragging&&point&&draggedItem&&<div className="mobileDockGhost" aria-hidden="true" style={{left:point.x,top:point.y}}>
   <span>{draggedItem.icon}</span><small>{draggedItem.label}</small>
  </div>}
 </>;
}
