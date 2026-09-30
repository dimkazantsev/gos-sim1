'use client';
import {useState} from 'react';
import {MessageSquarePlus} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
export default function DirectMessagePicker({g}:{g:ReturnTypeRepublic}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function start(user:string){
  if(!g.game||busy)return;setBusy(true);setError('');
  const result=await supabase.rpc('open_direct_conversation',{p_game:g.game.id,p_recipient:user});
  if(result.error)setError(result.error.message);
  else{await g.refresh();g.setChannelId(result.data as string);setOpen(false)}
  setBusy(false);
 }
 if(g.me?.kind==='observer')return null;
 return <div className="directMessagePicker"><button type="button" className="chatIconButton" title="Написать лично" aria-label="Написать лично" aria-expanded={open} onClick={()=>setOpen(!open)}><MessageSquarePlus size={20}/></button>
 {open&&<div className="directMessageMenu"><strong>Личная беседа</strong><button type="button" onClick={()=>setOpen(false)}>Закрыть</button>{g.members.filter(m=>m.user_id!==g.me?.user_id&&m.kind!=='observer').map(m=><button type="button" key={m.user_id} disabled={busy} onClick={()=>void start(m.user_id)}>{m.full_name}<small>{m.role_title||'Участник'}</small></button>)}{error&&<p role="alert">{error}</p>}</div>}</div>;
}
