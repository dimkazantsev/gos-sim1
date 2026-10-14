'use client';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown} from 'lucide-react';
import {placeSelectMenu} from './selectMenuPlacement';

export type SelectOption={value:string;label:string;disabled?:boolean};
export default function StyledSelect({label,value,options,onChange,disabled=false,wide=false,wrap=false,placeholder='Выберите…',className=''}:{
 label:string;value:string;options:SelectOption[];onChange:(next:string)=>void;
 disabled?:boolean;wide?:boolean;wrap?:boolean;placeholder?:string;className?:string
}){
 const [open,setOpen]=useState(false);
 const [cursor,setCursor]=useState(0);
 const [anchor,setAnchor]=useState({top:0,left:0,width:180,maxHeight:320});
 const ref=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const popup=useRef<HTMLDivElement>(null);
 const id=useId();
 const selected=options.find(o=>o.value===value);
 function position(){
  const r=trigger.current?.getBoundingClientRect();
  if(!r)return;
  if(r.bottom<=0||r.top>=window.innerHeight){setOpen(false);return;}
  // Use the actual row heights, not the space available for a potentially
  // much taller list. Otherwise a short list appears detached above its field.
  const next=placeSelectMenu(r,popup.current?.scrollHeight??0,{width:window.innerWidth,height:window.innerHeight});
  setAnchor(prev=>prev.top===next.top&&prev.left===next.left&&prev.width===next.width&&prev.maxHeight===next.maxHeight?prev:next);
 }
 function show(){if(disabled)return;setCursor(Math.max(0,options.findIndex(o=>o.value===value)));setOpen(true);}
 useLayoutEffect(()=>{if(open)position()},[open,options.length,wrap]);
 useEffect(()=>{
  if(!open)return;
  const off=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node)&&!popup.current?.contains(e.target as Node))setOpen(false)};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();setOpen(false);trigger.current?.focus()}};
  const scroll=(e:Event)=>{if(!popup.current?.contains(e.target as Node))position()};
  document.addEventListener('pointerdown',off);
  document.addEventListener('keydown',escape);
  window.addEventListener('scroll',scroll,true);
  window.addEventListener('resize',position);
  const resizeObserver=typeof ResizeObserver!=='undefined'?new ResizeObserver(position):null;
  if(trigger.current)resizeObserver?.observe(trigger.current);
  if(popup.current)resizeObserver?.observe(popup.current);
  return()=>{document.removeEventListener('pointerdown',off);document.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',position);resizeObserver?.disconnect()};
 },[open]);
 useEffect(()=>{
  if(!open)return;
  const menu=popup.current,item=menu?.querySelector<HTMLElement>('[data-focused=true]');
  if(!menu||!item)return;
  // Scroll only the list. Scrolling its document ancestor closes the popup
  // and can cancel a touch selection in a long form.
  const m=menu.getBoundingClientRect(),r=item.getBoundingClientRect();
  if(r.top<m.top+menu.clientTop)menu.scrollTop-=m.top+menu.clientTop-r.top;
  else if(r.bottom>m.top+menu.clientTop+menu.clientHeight)menu.scrollTop+=r.bottom-(m.top+menu.clientTop+menu.clientHeight);
 },[cursor,open]);
 const enabled=options.map((o,i)=>({...o,index:i})).filter(o=>!o.disabled);
 function keydown(e:React.KeyboardEvent<HTMLButtonElement>){
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
   e.preventDefault();if(!open){show();return}
   const found=enabled.findIndex(o=>o.index===cursor);
   const i=e.key==='Home'?0:e.key==='End'?enabled.length-1:e.key==='ArrowDown'?(found+1)%enabled.length:(found-1+enabled.length)%enabled.length;
   if(enabled[i])setCursor(enabled[i].index);
  }else if(e.key==='Enter'||e.key===' '){
   e.preventDefault();if(!open){show();return}
   const item=options[cursor];if(item&&!item.disabled){onChange(item.value);setOpen(false)}
  }else if(e.key==='Escape'&&open){e.preventDefault();setOpen(false)}
 }
 return <div ref={ref} className={'styledSelect '+(wide?'wide ':'')+className}>
  <span className="styledSelectLabel" id={id+'-label'}>{label}</span>
  <button ref={trigger} type="button" className={'styledSelectTrigger '+(open?'isOpen':'')} disabled={disabled} style={wrap?{height:'auto',padding:'11px 14px'}:undefined}
   aria-haspopup="listbox" aria-expanded={open} aria-labelledby={id+'-label '+id+'-value'} aria-controls={open?id+'-list':undefined}
   onClick={()=>open?setOpen(false):show()} onKeyDown={keydown}>
   <span id={id+'-value'} className="styledSelectValue" style={wrap?{whiteSpace:'normal',overflow:'visible',textOverflow:'clip',overflowWrap:'anywhere'}:undefined}>{selected?.label||placeholder}</span>
   <ChevronDown size={17} aria-hidden="true"/>
  </button>
  {open&&typeof document!=='undefined'&&createPortal(<div ref={popup} id={id+'-list'} role="listbox"
   aria-labelledby={id+'-label'} className="styledSelectMenu" style={{position:'fixed',top:anchor.top,left:anchor.left,width:anchor.width,maxHeight:anchor.maxHeight}}>
   {options.map((o,i)=><button key={o.value} type="button" role="option" aria-selected={o.value===value} data-focused={i===cursor}
    disabled={o.disabled} tabIndex={-1}
    className={(o.value===value?'selected ':'')+(i===cursor?'focused':'')}
    onPointerEnter={()=>setCursor(i)} onClick={()=>{onChange(o.value);setOpen(false);trigger.current?.focus()}}>
    <span>{o.label}</span>{o.value===value&&<Check size={16} aria-hidden="true"/>}
   </button>)}
  </div>,document.body)}
 </div>;
}
