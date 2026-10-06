'use client';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {Check,ChevronDown,Pin,PinOff,UsersRound} from 'lucide-react';
import type {Channel,ChatOverview} from './types';

/** Mirrors the game's "Режим просмотра" dropdown: a styled list rather
 * than browser-native options, including predictable focus on mobile. */
export default function ChatChannelDropdown({
 channels,value,onChange,overview,onPin,initialOpen=false
}:{channels:Channel[];value:string;onChange:(id:string)=>void;overview:ChatOverview[];onPin:(id:string,pin:boolean)=>Promise<boolean>;initialOpen?:boolean}){
 const [open,setOpen]=useState(initialOpen);
 const root=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const menuId=useId();
 const meta=useMemo(()=>new Map(overview.map(x=>[x.channel_id,x])),[overview]);
 const visibleChannels=channels.filter(c=>!isHiddenChannel(c)&&meta.has(c.id));
 const lastSentId=[...overview].filter(x=>x.last_sent_at).sort((a,b)=>Date.parse(b.last_sent_at!)-Date.parse(a.last_sent_at!))[0]?.channel_id||'';
 const orderedChannels=[...visibleChannels].sort((a,b)=>{
  const am=meta.get(a.id),bm=meta.get(b.id);
  const ap=am?.pinned_at?0:1,bp=bm?.pinned_at?0:1;
  if(ap!==bp)return ap-bp;
  if(!ap&&am?.pinned_rank!==bm?.pinned_rank)return Number(am?.pinned_rank??999)-Number(bm?.pinned_rank??999);
  if(a.id===lastSentId&&b.id!==lastSentId)return -1;
  if(b.id===lastSentId&&a.id!==lastSentId)return 1;
  return Date.parse(bm?.last_message_at||'1970-01-01')-Date.parse(am?.last_message_at||'1970-01-01');
 });
 const current=visibleChannels.find(c=>c.id===value)||orderedChannels[0];
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
  if(!visibleChannels.length)return;
  if(open){setOpen(false);return}
  setOpen(true);focusSelected();
 }
 function choose(id:string){onChange(id);setOpen(false);requestAnimationFrame(()=>trigger.current?.focus())}
 async function togglePinned(id:string){const isPinned=!!meta.get(id)?.pinned_at;await onPin(id,!isPinned)}
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
  <button type="button" ref={trigger} className="chatChannelTrigger" aria-label={'Выбрать канал: '+(current?.name||'Чаты')}
   aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined} disabled={!visibleChannels.length} onClick={toggle}>
   <span className="chatChannelName">{displayName(current?.name)||'Чаты'}</span>
   <ChevronDown className="chatChannelChevron" aria-hidden="true" size={17}/>
  </button>
  {open&&<div className="chatChannelMenu" id={menuId} role="menu" aria-label="Каналы общения">
   {orderedChannels.map(c=>{
    const info=meta.get(c.id);const isPinned=!!info?.pinned_at;const unread=Number(info?.unread_count||0),mentions=Number(info?.mention_count||0);
    return <div className={'chatChannelOptionRow '+(value===c.id?'selected':'')} key={c.id}>
     <button type="button" role="menuitemradio" aria-checked={value===c.id}
      className={'chatChannelOption '+(value===c.id?'selected':'')} onClick={()=>choose(c.id)}>
      <span className="chatChannelOptionIcon" aria-hidden="true"><UsersRound size={16}/></span>
      <span className="chatChannelOptionText"><b>{displayName(c.name)}</b><small>{info?.last_message_text?.trim()|| (c.name==='Вне игры'?'Неформальное общение':c.kind==='public'?'Все участники':c.kind==='team'?'Фракция':c.kind==='teacher'?'Преподаватели':'Личная беседа')}</small></span>
      <span className="chatChannelCounters">{mentions>0&&<i className="chatMentionBadge" aria-label={'Упоминаний: '+mentions}>@{mentions}</i>}{unread>0&&<i className="chatUnreadBadge" aria-label={'Непрочитанных: '+unread}>{unread>99?'99+':unread}</i>}</span>
      {value===c.id&&<Check size={17} className="chatChannelSelectedCheck" aria-hidden="true"/>}
     </button>
     <button type="button" className={'chatChannelPin '+(isPinned?'active':'')} aria-label={isPinned?'Открепить беседу':'Закрепить беседу в начале'} aria-pressed={isPinned} title={isPinned?'Открепить':'Закрепить в начале'} onClick={()=>void togglePinned(c.id)}>{isPinned?<PinOff size={15}/>:<Pin size={15}/>}</button>
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
 if(channel.kind==='private'){
  const parts=name.split('·').map(x=>x.trim()).filter(Boolean);
  if(parts.length===2&&parts[0].toLocaleLowerCase('ru-RU')===parts[1].toLocaleLowerCase('ru-RU'))return true;
 }
 return false;
}
