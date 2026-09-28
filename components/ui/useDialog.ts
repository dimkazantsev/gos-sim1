'use client';
import {useEffect,useRef} from 'react';
const activePanels=new Set<HTMLElement>();
let originalOverflow='';
/** Keyboard focus, Escape, and restoration for conditional modal panels. */
export function useDialog(open:boolean,onClose:()=>void){
 const ref=useRef<HTMLElement>(null);
 const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  if(!open)return;
  const panel=ref.current;if(!panel)return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  if(!activePanels.size){originalOverflow=document.body.style.overflow;document.body.style.overflow='hidden'}
  activePanels.add(panel);
  const focusable=()=>Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(x=>!x.closest('[hidden],[inert]')&&x.getClientRects().length>0);
  (focusable()[0]||panel).focus();
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.current();return;}
   if(event.key!=='Tab')return;
   const nodes=focusable(),first=nodes[0],last=nodes.at(-1);
   if(!first){event.preventDefault();panel.focus();return;}
   if(event.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){event.preventDefault();first.focus();}
  };
  panel.addEventListener('keydown',key);
  return()=>{
   panel.removeEventListener('keydown',key);activePanels.delete(panel);
   if(!activePanels.size)document.body.style.overflow=originalOverflow;
   const top=Array.from(activePanels).at(-1);
   if(previous?.isConnected&&(!top||top.contains(previous)))previous.focus();
   else top?.focus();
  };
 },[open]);
 return ref;
}
