'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {Check,ChevronDown,Pin,PinOff,UsersRound} from 'lucide-react';
import type {Channel} from './types';

/** Mirrors the game's "Режим просмотра" dropdown: a styled list rather
 * than browser-native options, including predictable focus on mobile. */
export default function ChatChannelDropdown({
 channels,value,onChange,initialOpen=false
}:{channels:Channel[];value:string;onChange:(id:string)=>void;initialOpen?:boolean}){
 const [open,setOpen]=useState(initialOpen);
 const [pinned,setPinned]=useState<string[]>([]);
 const root=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const menuId=useId();
 const visibleChannels=channels.filter(c=>!isHiddenChannel(c));
 const orderedChannels=[...visibleChannels].sort((a,b)=>{
  const ap=pinned.indexOf(a.id),bp=pinned.indexOf(b.id);
  if(ap>=0&&bp>=0)return ap-bp;
  if(ap>=0)return -1;
  if(bp>=0)return 1;
  return 0;
 });
 const current=visibleChannels.find(c=>c.id===value);
 const options=()=>Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')||[]);
 const focusSelected=()=>requestAnimationFrame(()=>{
  const items=options();
  (items.find(x=>x.getAttribute('aria-checked')==='true')||items[0])?.focus();
 });
 useEffect(()=>{
  try{
   const raw=localStorage.getItem('gos-sims.chat-channel-pins');
   const ids=raw?JSON.parse(raw):[];
   if(Array.isArray(ids))setPinned(ids.filter((id):id is string=>typeof id==='string'));
  }catch{}
 },[]);
 useEffect(()=>{
  setPinned(previous=>{
   const available=new Set(channels.map(c=>c.id));
   const next=previous.filter(id=>available.has(id));
   if(next.length!==previous.length){
    try{localStorage.setItem('gos-sims.chat-channel-pins',JSON.stringify(next))}catch{}
   }
   return next;
  });
 },[channels]);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{
   if(!root.current?.contains(event.target as Node))setOpen(false);
  };
  document.addEventListener('pointerdown',outside);
  return()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 function toggle(){
  if(!visibleChannels.length)return;
  if(open){setOpen(false);return}
  setOpen(true);focusSelected();
 }
 function choose(id:string){onChange(id);setOpen(false);requestAnimationFrame(()=>trigger.current?.focus())}
 function togglePinned(id:string){
  setPinned(previous=>{
   const next=previous.includes(id)?previous.filter(x=>x!==id):[...previous,id];
   try{localStorage.setItem('gos-sims.chat-channel-pins',JSON.stringify(next))}catch{}
   return next;
  });
 }
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
   aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined} disabled={!visibleChannels.length} onClick={toggle}>
   <span className="chatChannelName">{displayName(current?.name)||'Нет доступных каналов'}</span>
   <ChevronDown className="chatChannelChevron" aria-hidden="true" size={17}/>
  </button>
  {open&&<div className="chatChannelMenu" id={menuId} role="menu" aria-label="Каналы общения">
   {orderedChannels.map(c=>{
    const isPinned=pinned.includes(c.id);
    return <div className={'chatChannelOptionRow '+(value===c.id?'selected':'')} key={c.id}>
     <button type="button" role="menuitemradio" aria-checked={value===c.id}
      className={'chatChannelOption '+(value===c.id?'selected':'')} onClick={()=>choose(c.id)}>
      <span className="chatChannelOptionIcon" aria-hidden="true"><UsersRound size={16}/></span>
      <span className="chatChannelOptionText"><b>{displayName(c.name)}</b><small>{c.name==='Вне игры'?'Неформальное общение':c.kind==='public'?'Все участники':c.kind==='team'?'Фракция':c.kind==='teacher'?'Преподаватели':'Личная беседа'}</small></span>
      {value===c.id&&<Check size={17} className="chatChannelSelectedCheck" aria-hidden="true"/>}
     </button>
     <button type="button" className={'chatChannelPin '+(isPinned?'active':'')} aria-label={isPinned?'Открепить беседу':'Закрепить беседу в начале'} aria-pressed={isPinned} title={isPinned?'Открепить':'Закрепить в начале'} onClick={()=>togglePinned(c.id)}>{isPinned?<PinOff size={15}/>:<Pin size={15}/>}</button>
    </div>;
   })}
  </div>}
 </div>;
}
function displayName(name?:string){return name&&['Общая беседа','Общий штаб','Общий чат'].includes(name)?'Публичная политика':name}
function isHiddenChannel(channel:Channel){
 const name=(channel.name||'').trim();
 const lower=name.toLocaleLowerCase('ru-RU');
 if(lower.includes('архив'))return true;
 if(channel.kind==='direct'){
  const parts=name.split('·').map(x=>x.trim()).filter(Boolean);
  if(parts.length===2&&parts[0].toLocaleLowerCase('ru-RU')===parts[1].toLocaleLowerCase('ru-RU'))return true;
 }
 return false;
}
