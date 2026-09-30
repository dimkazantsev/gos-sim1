'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
export type EventInvitation={id:string;case_id:string;recipient_id:string;inviter_id:string;status:string};
type Entry={id:number;author_id:string;body:string;created_at:string};
export default function EventCollaboration({g,caseId,invitations,assignedIds,closed,votingStarted,onChanged,readOnly=false}:{g:ReturnTypeRepublic;caseId:string;invitations:EventInvitation[];assignedIds:string[];closed:boolean;votingStarted:boolean;onChanged:()=>Promise<void>;readOnly?:boolean}){
 const [entries,setEntries]=useState<Entry[]>([]),[text,setText]=useState(''),[recipient,setRecipient]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const myInvite=invitations.find(i=>i.recipient_id===g.me?.user_id&&i.status==='pending');
 const assigned=assignedIds.includes(g.me?.user_id||'');
 const canChat=(assigned||g.teacher)&&!readOnly&&g.me?.kind!=='observer';
 async function load(){if(!assigned&&!g.teacher)return;const r=await supabase.from('event_discussion_messages').select('*').eq('case_id',caseId).order('created_at',{ascending:false}).limit(100);if(!r.error)setEntries(((r.data||[]) as Entry[]).reverse())}
 useEffect(()=>{void load();const id=setInterval(()=>void load(),5000);return()=>clearInterval(id)},[caseId,assigned,g.teacher]);
 async function act(name:string,params:Record<string,unknown>){if(busy)return;setBusy(true);const r=await supabase.rpc(name,params);setNotice(r.error?r.error.message:'');if(!r.error){setText('');await Promise.all([onChanged(),load()])}setBusy(false)}
 return <section className="eventCollaboration">
 {myInvite&&!readOnly&&<div className="eventInvitation"><strong>{g.names[myInvite.inviter_id]||'Участник'} приглашает вас к совместному решению</strong><div><button disabled={busy} onClick={()=>void act('respond_event_invitation',{p_id:myInvite.id,p_accept:true})}>Принять приглашение</button><button disabled={busy} onClick={()=>void act('respond_event_invitation',{p_id:myInvite.id,p_accept:false})}>Отклонить</button></div></div>}
 {assigned&&!closed&&!votingStarted&&!readOnly&&g.me?.kind==='student'&&<div className="eventInviteControls"><label>Пригласить участника<select value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Выберите участника</option>{g.members.filter(m=>m.kind==='student'&&!assignedIds.includes(m.user_id)&&!invitations.some(i=>i.recipient_id===m.user_id&&i.status==='pending')).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name} · {m.role_title||'Участник'}</option>)}</select></label><button disabled={busy||!recipient} onClick={()=>void act('invite_event_collaborator',{p_case:caseId,p_recipient:recipient})}>Пригласить</button></div>}
 {invitations.length>0&&<div className="eventInviteStatuses">{invitations.map(i=><span key={i.id}>{g.names[i.recipient_id]||'Участник'}: {i.status==='accepted'?'Принял':i.status==='declined'?'Отклонил':i.status==='cancelled'?'Отменено':'Ожидает ответа'}{i.status==='pending'&&(i.inviter_id===g.me?.user_id||g.teacher)&&!readOnly&&<button disabled={busy} onClick={()=>void act('cancel_event_invitation',{p_id:i.id})}>Отменить приглашение</button>}</span>)}</div>}
 {(assigned||g.teacher)&&<div className="eventTextDiscussion"><h4>Обсуждение ситуации</h4><div className="eventDiscussionLog" role="log" aria-live="polite">{entries.length?entries.map(e=><p key={e.id}><b>{g.names[e.author_id]||'Участник'}</b><span>{e.body}</span></p>):<p>Сообщений пока нет.</p>}</div>{canChat&&!closed&&<form onSubmit={e=>{e.preventDefault();if(text.trim())void act('send_event_discussion',{p_case:caseId,p_body:text})}}><input value={text} onChange={e=>setText(e.target.value)} maxLength={2000} placeholder="Короткое текстовое сообщение" aria-label="Сообщение по ситуации"/><button disabled={busy||!text.trim()}>Отправить</button></form>}</div>}
 {notice&&<p role="status">{notice}</p>}</section>;
}
