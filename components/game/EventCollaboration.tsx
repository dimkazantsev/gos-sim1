'use client';
import {userError} from '@/lib/userError';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
export type EventInvitation={id:string;case_id:string;recipient_id:string;inviter_id:string;status:string};
type Entry={id:number;author_id:string;body:string;created_at:string};
type InviteMember={user_id:string;full_name:string;role_title:string|null;kind:string;roster_archived_at?:string|null};
export default function EventCollaboration({g,caseId,invitations,assignedIds,closed,votingStarted,onChanged,readOnly=false}:{g:ReturnTypeRepublic;caseId:string;invitations:EventInvitation[];assignedIds:string[];closed:boolean;votingStarted:boolean;onChanged:()=>Promise<void>;readOnly?:boolean}){
 const [entries,setEntries]=useState<Entry[]>([]),[text,setText]=useState(''),[recipient,setRecipient]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [roster,setRoster]=useState<InviteMember[]|null>(null),[rosterLoading,setRosterLoading]=useState(false);
 const myInvite=invitations.find(i=>i.recipient_id===g.me?.user_id&&i.status==='pending');
 const assigned=assignedIds.includes(g.me?.user_id||'');
 const canChat=(assigned||g.teacher)&&!readOnly&&g.me?.kind!=='observer';
 const canInvite=assigned&&!closed&&!votingStarted&&!readOnly&&g.me?.kind==='student';
 const eligible=(roster??g.members).filter(m=>m.kind==='student'&&!m.roster_archived_at
  &&m.user_id!==g.me?.user_id&&!assignedIds.includes(m.user_id)
  &&!invitations.some(i=>i.recipient_id===m.user_id&&(i.status==='pending'||i.status==='accepted')));
 async function loadRoster(){
  if(!g.game?.id)return;
  setRosterLoading(true);
  const r=await supabase.from('game_members')
    .select('user_id,full_name,role_title,kind,roster_archived_at')
    .eq('game_id',g.game.id).eq('kind','student').is('roster_archived_at',null).order('full_name');
  if(r.error)setNotice('Не удалось обновить список участников. Повторите попытку.');
  else setRoster((r.data||[]) as InviteMember[]);
  setRosterLoading(false);
 }
 useEffect(()=>{setRoster(null);setRecipient('');if(canInvite)void loadRoster();},[caseId,g.game?.id,canInvite]);
 async function load(){if(!assigned&&!g.teacher)return;const r=await supabase.from('event_discussion_messages').select('*').eq('case_id',caseId).order('created_at',{ascending:false}).limit(100);if(!r.error)setEntries(((r.data||[]) as Entry[]).reverse())}
 useEffect(()=>{if(!assigned&&!g.teacher)return;void load();const id=setInterval(()=>{if(document.visibilityState==='visible')void load()},30000);return()=>clearInterval(id)},[caseId,assigned,g.teacher]);
 async function act(name:string,params:Record<string,unknown>){if(busy)return;setBusy(true);const r=await supabase.rpc(name,params);setNotice(r.error?userError(r.error):'');if(!r.error){setText('');if(name==='invite_event_collaborator')setRecipient('');await Promise.all([onChanged(),load()])}setBusy(false)}
 return <section className="eventCollaboration">
 {assigned&&!closed&&!votingStarted&&<p className="eventInviteExplanation">Кнопка «Пригласить» позволяет привлечь участника с необходимыми полномочиями — например, руководителя профильного ведомства. Приглашённый должен принять приглашение; только после этого он участвует в совместном решении. Это особенно важно, если ваша должность не даёт права самостоятельно принять решение.</p>}
 {myInvite&&!readOnly&&<div className="eventInvitation"><strong>{g.names[myInvite.inviter_id]||'Участник'} приглашает вас к совместному решению</strong><div><button disabled={busy} onClick={()=>void act('respond_event_invitation',{p_id:myInvite.id,p_accept:true})}>Принять приглашение</button><button disabled={busy} onClick={()=>void act('respond_event_invitation',{p_id:myInvite.id,p_accept:false})}>Отклонить</button></div></div>}
 {canInvite&&<div className="eventInviteControls">
  <label>Пригласить участника
   <select aria-label="Кого пригласить к рассмотрению ситуации" value={eligible.some(m=>m.user_id===recipient)?recipient:''} disabled={busy||rosterLoading||eligible.length===0} onChange={e=>setRecipient(e.target.value)}>
    <option value="">{rosterLoading?'Обновляем список участников…':eligible.length?'Выберите участника':'Нет доступных участников'}</option>
    {eligible.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name} · {m.role_title||'Без должности'}</option>)}
   </select>
  </label>
  <button type="button" disabled={busy||rosterLoading||!eligible.some(m=>m.user_id===recipient)} onClick={()=>void act('invite_event_collaborator',{p_case:caseId,p_recipient:recipient})}>Пригласить</button>
  <button type="button" className="eventInviteRefresh" disabled={busy||rosterLoading} onClick={()=>void loadRoster()}>Обновить список</button>
  {!rosterLoading&&eligible.length===0&&<p className="eventInviteEmpty" role="status">Пригласить пока некого: все зарегистрированные действующие студенты уже участвуют в этом событии или ожидают ответа на приглашение. Когда в игру войдут другие участники, нажмите «Обновить список».</p>}
 </div>}
 {invitations.length>0&&<div className="eventInviteStatuses">{invitations.map(i=><span key={i.id}>{g.names[i.recipient_id]||'Участник'}: {i.status==='accepted'?'Принял':i.status==='declined'?'Отклонил':i.status==='cancelled'?'Отменено':'Ожидает ответа'}{i.status==='pending'&&(i.inviter_id===g.me?.user_id||g.teacher)&&!readOnly&&<button disabled={busy} onClick={()=>void act('cancel_event_invitation',{p_id:i.id})}>Отменить приглашение</button>}</span>)}</div>}
 {(assigned||g.teacher)&&<div className="eventTextDiscussion"><h4>Обсуждение ситуации</h4><div className="eventDiscussionLog" role="log" aria-live="polite">{entries.length?entries.map(e=><p key={e.id}><b>{g.names[e.author_id]||'Участник'}</b><span>{e.body}</span></p>):<p>Сообщений пока нет.</p>}</div>{canChat&&!closed&&<form onSubmit={e=>{e.preventDefault();if(text.trim())void act('send_event_discussion',{p_case:caseId,p_body:text})}}><input value={text} onChange={e=>setText(e.target.value)} maxLength={2000} placeholder="Короткое текстовое сообщение" aria-label="Сообщение по ситуации"/><button disabled={busy||!text.trim()}>Отправить</button></form>}</div>}
 {notice&&<p role="status">{notice}</p>}</section>;
}
