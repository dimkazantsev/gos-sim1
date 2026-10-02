'use client';
import {useEffect,useRef} from 'react';

export function useHorizontalWheel(scope:string|undefined){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const element=ref.current;if(!element)return;
  const scroll=(event:WheelEvent)=>{
   if(event.ctrlKey||event.shiftKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||element.scrollWidth<=element.clientWidth+1)return;
   const unit=event.deltaMode===1?32:event.deltaMode===2?element.clientWidth:1;
   const next=Math.max(0,Math.min(element.scrollWidth-element.clientWidth,element.scrollLeft+event.deltaY*unit));
   if(Math.abs(next-element.scrollLeft)<1)return;
   event.preventDefault();element.scrollLeft=next;
  };
  element.addEventListener('wheel',scroll,{passive:false});
  return()=>element.removeEventListener('wheel',scroll);
 },[scope]);
 return ref;
}
