'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {Check,ChevronDown,UsersRound} from 'lucide-react';
import type {Channel} from './types';

/** Mirrors the game's "Режим просмотра" dropdown: a styled list rather
 * than browser-native options, including predictable focus on mobile. */
export default function ChatChannelDropdown({
 channels,value,onChange,initialOpen=false
}:{channels:Channel[];value:string;onChange:(id:string)=>void;initialOpen?:boolean}){
 const [open,setOpen]=useState(initialOpen);
 const root=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const menuId=useId();
 const current=channels.find(c=>c.id===value);
 const options=()=>Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')||[]);
 const focusSelected=()=>requestAnimationFrame(()=>{
  const items=options();
  (items.find(x=>x.getAttribute('aria-checked')==='true')||items[0])?.focus();
 });
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{
   if(!root.current?.contains(event.target as Node))setOpen(false);
  };
  document.addEventListener('pointerdown',outside);
  return()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 function toggle(){
  if(!channels.length)return;
  if(open){setOpen(false);return}
  setOpen(true);focusSelected();
 }
 function choose(id:string){onChange(id);setOpen(false);requestAnimationFrame(()=>trigger.current?.focus())}
 function keyDown(event:KeyboardEvent<HTMLDivElement>){
  if(event.key==='Escape'&&open){event.stopPropagation();event.preventDefault();setOpen(false);trigger.current?.focus();return}
  if(!open||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  const items=options();if(!items.length)return;
  event.preventDefault();
  const at=items.indexOf(document.activeElement as HTMLButtonElement);
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:
   event.key==='ArrowDown'?(at+1)%items.length:(at-1+items.length)%items.length;
  items[next]?.focus();
 }
 return <div className="chatHeadText chatChannelPicker" ref={root} onKeyDown={keyDown}>
  <span className="chatEyebrow">Общение</span>
  <button type="button" ref={trigger} className="chatChannelTrigger" aria-label={'Выбрать канал: '+(current?.name||'Нет каналов')}
   aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined} disabled={!channels.length} onClick={toggle}>
   <span className="chatChannelName">{(current?.kind==='public'?'Общая беседа':current?.name)||'Нет доступных каналов'}</span>
   <ChevronDown className="chatChannelChevron" aria-hidden="true" size={17}/>
  </button>
  {open&&<div className="chatChannelMenu" id={menuId} role="menu" aria-label="Каналы общения">
   {channels.map(c=><button key={c.id} type="button" role="menuitemradio" aria-checked={value===c.id}
    className={'chatChannelOption '+(value===c.id?'selected':'')} onClick={()=>choose(c.id)}>
    <span className="chatChannelOptionIcon" aria-hidden="true"><UsersRound size={16}/></span>
    <span className="chatChannelOptionText"><b>{c.kind==='public'?'Общая беседа':c.name}</b><small>{c.kind==='public'?'Все участники':c.kind==='team'?'Фракция':c.kind==='teacher'?'Преподаватели':'Личная беседа'}</small></span>
    {value===c.id&&<Check size={17} className="chatChannelSelectedCheck" aria-hidden="true"/>}
   </button>)}
  </div>}
 </div>;
}
