'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown} from 'lucide-react';

export type SelectOption={value:string;label:string;disabled?:boolean};
export default function StyledSelect({label,value,options,onChange,disabled=false,wide=false,placeholder='Выберите…',className=''}:{
 label:string;value:string;options:SelectOption[];onChange:(next:string)=>void;
 disabled?:boolean;wide?:boolean;placeholder?:string;className?:string
}){
 const [open,setOpen]=useState(false);
 const [cursor,setCursor]=useState(0);
 const [anchor,setAnchor]=useState({top:0,left:0,width:180,maxHeight:320});
 const ref=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const popup=useRef<HTMLDivElement>(null);
 const id=useRef('select-'+Math.random().toString(36).slice(2)).current;
 const selected=options.find(o=>o.value===value);
 function position(){
  const r=trigger.current?.getBoundingClientRect();
  if(!r)return;
  const spaceBelow=window.innerHeight-r.bottom-16,spaceAbove=r.top-16;
  const above=spaceBelow<180&&spaceAbove>spaceBelow;
  const height=Math.min(340,Math.max(128,above?spaceAbove:spaceBelow));
  setAnchor({top:above?Math.max(10,r.top-8-height):r.bottom+6,left:Math.max(8,Math.min(r.left,window.innerWidth-r.width-8)),width:r.width,maxHeight:height});
 }
 function show(){if(disabled)return;position();setCursor(Math.max(0,options.findIndex(o=>o.value===value)));setOpen(true);}
 useEffect(()=>{
  if(!open)return;
  const off=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node)&&!popup.current?.contains(e.target as Node))setOpen(false)};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();setOpen(false);trigger.current?.focus()}};
  const scroll=(e:Event)=>{if(!popup.current?.contains(e.target as Node))setOpen(false)};
  document.addEventListener('pointerdown',off);
  document.addEventListener('keydown',escape);
  window.addEventListener('scroll',scroll,true);
  window.addEventListener('resize',position);
  return()=>{document.removeEventListener('pointerdown',off);document.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',position)};
 },[open]);
 useEffect(()=>{if(open)popup.current?.querySelector<HTMLElement>('[data-focused=true]')?.scrollIntoView({block:'nearest'})},[cursor,open]);
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
  <button ref={trigger} type="button" className={'styledSelectTrigger '+(open?'isOpen':'')} disabled={disabled}
   aria-haspopup="listbox" aria-expanded={open} aria-labelledby={id+'-label '+id+'-value'} aria-controls={open?id+'-list':undefined}
   onClick={()=>open?setOpen(false):show()} onKeyDown={keydown}>
   <span id={id+'-value'} className="styledSelectValue">{selected?.label||placeholder}</span>
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
