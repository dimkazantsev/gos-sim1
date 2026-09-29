'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {Check,Grip,LayoutGrid} from 'lucide-react';
import type {ReactNode,PointerEvent as ReactPointerEvent,KeyboardEvent as ReactKeyboardEvent} from 'react';
import type {View} from './types';

export type MobileDockItem={key:View;label:string;icon:ReactNode};

/** Order only existing routes: saved layouts cannot expose teacher routes to students. */
export function normalizeDockOrder(saved:unknown,available:View[]):View[]{
 const valid=Array.isArray(saved)?saved.filter((key):key is View=>typeof key==='string'&&available.includes(key as View)):[];
 return [...new Set([...valid,...available])];
}
export function moveDockItem<T>(items:T[],from:T,to:T):T[]{
 const source=items.indexOf(from),target=items.indexOf(to);
 if(source<0||target<0||source===target)return items;
 const next=[...items];next.splice(source,1);next.splice(target,0,next[source]);
 // Insertion must use the original item (the removed index may precede the target).
 return next;
}

type DragCandidate={
 id:number;
 key:View;
 x:number;y:number;
 active:boolean;
 timer:ReturnType<typeof setTimeout>|null;
};

export default function MobileDock({items,activeView,storageKey,editing,setEditing,onNavigate,onAll}:{
 items:MobileDockItem[];
 activeView:View;
 storageKey:string;
 editing:boolean;
 setEditing:(value:boolean)=>void;
 onNavigate:(view:View)=>void;
 onAll:()=>void;
}){
 const scrollRef=useRef<HTMLDivElement>(null);
 const dragRef=useRef<DragCandidate|null>(null);
 const ignoreClickUntil=useRef(0);
 const [order,setOrder]=useState<View[]>([]);
 const [dragging,setDragging]=useState<View|null>(null);
 const [point,setPoint]=useState<{x:number;y:number}|null>(null);
 const available=useMemo(()=>items.map(i=>i.key),[items]);
 const ordered=normalizeDockOrder(order,available).map(key=>items.find(item=>item.key===key)!).filter(Boolean);
 const draggedItem=items.find(i=>i.key===dragging);
 function stopTimer(){
  const candidate=dragRef.current;
  if(candidate?.timer){clearTimeout(candidate.timer);candidate.timer=null}
 }
 function clearDrag(){
  stopTimer();dragRef.current=null;setDragging(null);setPoint(null);
 }
 useEffect(()=>{
  let stored:unknown;
  try{stored=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{stored=null}
  setOrder(normalizeDockOrder(stored,items.map(i=>i.key)));
  return()=>{if(dragRef.current?.timer)clearTimeout(dragRef.current.timer);dragRef.current=null};
 },[storageKey]);
 useEffect(()=>{if(!editing)clearDrag()},[editing]);
 useEffect(()=>{
  const el=scrollRef.current,button=el?.querySelector<HTMLButtonElement>('[data-dock-item][aria-current="page"]');
  if(!el||!button||editing)return;
  const left=button.offsetLeft-el.offsetLeft,right=left+button.offsetWidth;
  if(left<el.scrollLeft||right>el.scrollLeft+el.clientWidth){
   el.scrollTo({left:Math.max(0,left-(el.clientWidth-button.offsetWidth)/2),behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
  }
 },[activeView,order,editing]);
 useEffect(()=>{
  const blockDuringDrag=(event:TouchEvent)=>{if(dragRef.current?.active&&event.cancelable)event.preventDefault()};
  document.addEventListener('touchmove',blockDuringDrag,{passive:false});
  return()=>document.removeEventListener('touchmove',blockDuringDrag);
 },[]);
 function reorder(from:View,to:View){
  const next=moveDockItem(normalizeDockOrder(order,available),from,to);
  if(next===order)return;
  setOrder(next);
  try{localStorage.setItem(storageKey,JSON.stringify(next))}catch{/* Private mode: reorder for this session. */}
 }
 function begin(event:ReactPointerEvent<HTMLButtonElement>,key:View){
  if(!event.isPrimary||(event.pointerType==='mouse'&&event.button!==0))return;
  clearDrag();
  const candidate:DragCandidate={id:event.pointerId,key,x:event.clientX,y:event.clientY,active:false,timer:null};
  dragRef.current=candidate;
  const activate=()=>{
   if(dragRef.current!==candidate)return;
   candidate.active=true;candidate.timer=null;ignoreClickUntil.current=Date.now()+700;
   setEditing(true);setDragging(key);setPoint({x:candidate.x,y:candidate.y});
  };
  if(editing)activate();
  else candidate.timer=setTimeout(activate,420);
  // Capturing the pointer lets the icon follow the finger while crossing items.
  try{event.currentTarget.setPointerCapture(event.pointerId)}catch{/* Some touch browsers do not support capture. */}
 }
 function move(event:ReactPointerEvent<HTMLButtonElement>){
  const candidate=dragRef.current;
  if(!candidate||candidate.id!==event.pointerId)return;
  const dx=event.clientX-candidate.x,dy=event.clientY-candidate.y;
  if(!candidate.active){
   if(Math.hypot(dx,dy)>9){stopTimer();dragRef.current=null}
   return;
  }
  if(event.cancelable)event.preventDefault();
  setPoint({x:event.clientX,y:event.clientY});
  const scroller=scrollRef.current;
  if(scroller){
   const bounds=scroller.getBoundingClientRect();
   if(event.clientX<bounds.left+38)scroller.scrollLeft-=17;
   else if(event.clientX>bounds.right-38)scroller.scrollLeft+=17;
  }
  const el=document.elementFromPoint(event.clientX,event.clientY);
  const target=el?.closest<HTMLButtonElement>('.mobileDockItem[data-dock-item]');
  const key=target?.dataset.dockItem as View|undefined;
  if(key&&key!==candidate.key&&available.includes(key))reorder(candidate.key,key);
 }
 function end(event:ReactPointerEvent<HTMLButtonElement>){
  const candidate=dragRef.current;
  if(!candidate||candidate.id!==event.pointerId)return;
  if(candidate.active)ignoreClickUntil.current=Date.now()+450;
  clearDrag();
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
 }
 function itemClick(event:React.MouseEvent<HTMLButtonElement>,key:View){
  if(editing||Date.now()<ignoreClickUntil.current){
   event.preventDefault();event.stopPropagation();return;
  }
  onNavigate(key);
 }
 function itemKeyDown(event:ReactKeyboardEvent<HTMLButtonElement>,key:View){
  if(!editing||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const keys=ordered.map(i=>i.key);
  const index=keys.indexOf(key);
  const next=event.key==='Home'?0:event.key==='End'?keys.length-1:event.key==='ArrowLeft'?Math.max(0,index-1):Math.min(keys.length-1,index+1);
  reorder(key,keys[next]);
 }
 const buttonProps=(item:MobileDockItem)=>({
  key:item.key,
  'data-dock-item':item.key,
  'aria-current':activeView===item.key?'page' as const:undefined,
  'aria-label':editing?item.label+'. Переместите удержанием или стрелками.':item.label,
  title:editing?'Перетащите значок, чтобы изменить порядок':item.label
 });
 return <>
  <nav className={'mobileDock mobileDockV2 '+(editing?'isEditing':'')} aria-label={editing?'Изменение порядка мобильной панели':'Мобильная навигация'}>
   <div ref={scrollRef} className="mobileDockScroll" aria-label="Прокручиваемые разделы">
    {ordered.map(item=><button {...buttonProps(item)} key={item.key}
     type="button" className={'mobileDockItem '+(activeView===item.key?'active ':'')+(dragging===item.key?'isDragged':'')}
     onPointerDown={e=>begin(e,item.key)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
     onContextMenu={e=>{if(editing||dragRef.current?.key===item.key)e.preventDefault()}}
     onDragStart={e=>e.preventDefault()} onKeyDown={e=>itemKeyDown(e,item.key)}
     onClick={e=>itemClick(e,item.key)}>
     <span className="mobileDockIcon">{item.icon}</span><span className="mobileDockLabel">{item.label}</span>
    </button>)}
   </div>
   <div className="mobileDockFixed">
    {editing?<button type="button" className="mobileDockDone" onClick={()=>{clearDrag();setEditing(false)}}><Check aria-hidden="true"/><span>Готово</span></button>:
    <button type="button" className="mobileDockAll" aria-haspopup="dialog" onClick={onAll}><LayoutGrid aria-hidden="true"/><span>Все разделы</span></button>}
   </div>
  </nav>
  {dragging&&point&&draggedItem&&<div className="mobileDockGhost" aria-hidden="true" style={{left:point.x,top:point.y}}>
   <span>{draggedItem.icon}</span><small>{draggedItem.label}</small>
  </div>}
 </>;
}
