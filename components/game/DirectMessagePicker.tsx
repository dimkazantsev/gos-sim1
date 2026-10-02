'use client';
import {useState} from 'react';
import {MessageSquare,Search} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
export default function DirectMessagePicker({g}:{g:ReturnTypeRepublic}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState('');
 async function start(user:string){
  if(!g.game||busy)return;setBusy(true);setError('');
  const result=await supabase.rpc('open_direct_conversation',{p_game:g.game.id,p_recipient:user});
  if(result.error)setError(result.error.message);
  else{await g.refresh();g.setChannelId(result.data as string);setOpen(false)}
  setBusy(false);
 }
 if(g.me?.kind==='observer')return null;
 return <div className="directMessagePicker"><button type="button" className="chatPersonalTrigger" title="Написать лично" aria-label="Написать лично" aria-expanded={open} onClick={()=>setOpen(!open)}><MessageSquare size={18}/><span>Написать лично</span></button>
 {open&&<div className="directMessageMenu"><header><strong>Выберите человека</strong><button type="button" onClick={()=>setOpen(false)}>Закрыть</button></header><label className="directMessageSearch"><Search size={18}/><input type="search" placeholder="Фамилия или имя" aria-label="Найти собеседника" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="directMessagePeople">{g.members.filter(m=>m.user_id!==g.me?.user_id&&m.kind!=='observer'&&m.full_name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru').trim())).map(m=><button type="button" key={m.user_id} disabled={busy} onClick={()=>void start(m.user_id)}><b>{m.full_name}</b><small>{m.role_title||'Участник'}</small></button>)}</div>{error&&<p role="alert">{error}</p>}</div>}</div>;
}
