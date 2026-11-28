'use client';
import {userError} from '@/lib/userError';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';
export type EventInvitation={id:string;case_id:string;recipient_id:string;inviter_id:string;status:string;transfer_stage_no?:number|null;transfer_errors?:number};
type Entry={id:number;author_id:string;body:string;created_at:string};
type InviteMember={user_id:string;full_name:string;role_title:string|null;kind:string;roster_archived_at?:string|null};
export default function EventCollaboration({g,caseId,audience,invitations,assignedIds,closed,votingStarted,onChanged,readOnly=false,transferMode=false,collectiveMode=false}:{g:ReturnTypeRepublic;caseId:string;audience:'single'|'group'|'all';invitations:EventInvitation[];assignedIds:string[];closed:boolean;votingStarted:boolean;onChanged:()=>Promise<void>;readOnly?:boolean;transferMode?:boolean;collectiveMode?:boolean}){
 const [entries,setEntries]=useState<Entry[]>([]),[text,setText]=useState(''),[recipient,setRecipient]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [roster,setRoster]=useState<InviteMember[]|null>(null),[rosterLoading,setRosterLoading]=useState(false);
 const myInvite=invitations.find(i=>i.recipient_id===g.me?.user_id&&i.status==='pending');
 const assigned=assignedIds.includes(g.me?.user_id||'');
 const canChat=(assigned||g.teacher)&&!readOnly&&g.me?.kind!=='observer';
 // Single/group cases allow up to 3 people. Accepted invitations already
 // count as assignments; pending ones reserve the remaining seats.
 const pendingSeats=invitations.filter(i=>i.status==='pending').length;
 const acceptedInvites=invitations.filter(i=>i.status==='accepted').length;
 const availableSeats=audience==='all'?30-pendingSeats-acceptedInvites:3-assignedIds.length-pendingSeats;
 const transferred=invitations.some(i=>i.transfer_stage_no!=null);
 const failedTransfers=invitations.filter(i=>i.inviter_id===g.me?.user_id).reduce((n,i)=>n+(i.transfer_errors??0),0);
 const canInvite=!collectiveMode&&assigned&&!closed&&!votingStarted&&!readOnly&&g.me?.kind==='student'&&(transferMode?!transferred&&failedTransfers<2&&pendingSeats===0&&assignedIds.length===1:availableSeats>0);
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
 useEffect(()=>{setRoster(null);setRecipient('');},[caseId,g.game?.id]);
 const discussionScope=(g.game?.id||'')+':'+caseId+':'+(g.me?.user_id||'')+':'+assigned+':'+g.teacher;
 const activeDiscussionScope=useRef(discussionScope);activeDiscussionScope.current=discussionScope;
 useEffect(()=>setEntries([]),[discussionScope]);
 async function load(){
  if(!assigned&&!g.teacher)return;const requestedScope=discussionScope;
  const r=await supabase.from('event_discussion_messages').select('*').eq('case_id',caseId).order('created_at',{ascending:false}).limit(100);
  if(requestedScope===activeDiscussionScope.current&&!r.error)setEntries(((r.data||[]) as Entry[]).reverse());
 }
 useGameTableSync(assigned||g.teacher?g.game?.id:undefined,['event_discussion_messages'],load,discussionScope,undefined,750,60000,0,caseId);
 async function act(name:string,params:Record<string,unknown>){if(busy)return;setBusy(true);const r=await supabase.rpc(name,params);setNotice(r.error?userError(r.error):'');if(!r.error){setText('');if(name==='invite_event_collaborator')setRecipient('');await Promise.all([onChanged(),load()])}setBusy(false)}
 return <section className="eventCollaboration">
 {assigned&&!closed&&!votingStarted&&transferMode&&<p className="eventInviteExplanation"><strong>Проверьте полномочия до принятия решения.</strong> Если ситуация не относится к вашей компетенции, передайте её уполномоченному участнику. До формирования министерств профильный комитет рассматривает ситуацию и предлагает меры, не подменяя исполнительный орган. Передаётся рассмотрение ситуации, а не государственная должность. После принятия передачи вы больше не сможете ответить. За правильную передачу начисляется 0,5 балла.</p>}
 {assigned&&!closed&&!votingStarted&&!transferMode&&!collectiveMode&&<p className="eventInviteExplanation"><strong>Проверьте полномочия до голосования.</strong> Если вашей должности недостаточно, пригласите компетентного участника до первого голоса. В списке доступны все остальные действующие студенты игры, кроме уже назначенных и ожидающих ответа: приглашение само по себе не подтверждает полномочия. Проверяйте должность выбранного участника. Он должен принять приглашение до общего решения.</p>}
 {myInvite&&!readOnly&&<div className="eventInvitation"><strong>{g.names[myInvite.inviter_id]||'Участник'} {transferMode?'предлагает вам рассмотреть ситуацию':'приглашает вас к совместному решению'}</strong><div><button disabled={busy} onClick={()=>void act('respond_event_invitation',{p_id:myInvite.id,p_accept:true})}>{transferMode?'Принять ситуацию':'Принять приглашение'}</button><button disabled={busy} onClick={()=>void act('respond_event_invitation',{p_id:myInvite.id,p_accept:false})}>Отклонить</button></div></div>}
 {transferMode&&assigned&&!closed&&!votingStarted&&<p className="eventInviteExplanation">Ошибочных передач: {failedTransfers} из 2. {failedTransfers>=2?'Обратитесь к преподавателю.':''}</p>}
 {canInvite&&<div className="eventInviteControls">
  <label>{transferMode?'Передать ситуацию':'Пригласить участника с нужными полномочиями'}
   <select aria-label={transferMode?'Кому передать ситуацию':'Кого пригласить к рассмотрению ситуации'} value={eligible.some(m=>m.user_id===recipient)?recipient:''} disabled={busy||rosterLoading||eligible.length===0} onChange={e=>setRecipient(e.target.value)}>
    <option value="">{rosterLoading?'Обновляем список участников…':eligible.length?'Выберите участника':'Нет доступных участников'}</option>
    {eligible.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name} · {m.role_title||'Без должности'}</option>)}
   </select>
  </label>
  <button type="button" disabled={busy||rosterLoading||!eligible.some(m=>m.user_id===recipient)} onClick={()=>void act('invite_event_collaborator',{p_case:caseId,p_recipient:recipient})}>{transferMode?'Передать ситуацию':'Пригласить'}</button>
  <button type="button" className="eventInviteRefresh" disabled={busy||rosterLoading} onClick={()=>void loadRoster()}>Обновить список</button>
  {!rosterLoading&&eligible.length===0&&<p className="eventInviteEmpty" role="status">{transferMode?'Нет доступных получателей. Обратитесь к преподавателю или обновите список.':'Пригласить пока некого: все зарегистрированные действующие студенты уже участвуют в этом событии или ожидают ответа на приглашение. Когда в игру войдут другие участники, нажмите «Обновить список».'}</p>}
 </div>}
 {assigned&&!closed&&!votingStarted&&!transferMode&&!collectiveMode&&availableSeats<=0&&<p className="eventInviteExplanation" role="status">Лимит участников совместного решения достигнут. Новые приглашения недоступны.</p>}
 {transferMode&&invitations.some(i=>i.inviter_id===g.me?.user_id&&i.transfer_stage_no!=null)&&<p className="eventInviteExplanation" role="status"><strong>Ситуация передана.</strong> Кредит за передачу: 0,5 балла. Решение принимает получатель.</p>}
 {transferMode&&assigned&&!closed&&!votingStarted&&!readOnly&&<button type="button" className="eventInviteRefresh" disabled={busy} onClick={()=>void act('send_event_discussion',{p_case:caseId,p_body:'Прошу преподавателя помочь определить компетентного участника для передачи ситуации.'})}>Обратиться к преподавателю</button>}
 {invitations.length>0&&<div className="eventInviteStatuses">{invitations.map(i=><span key={i.id}>{g.names[i.recipient_id]||'Участник'}: {i.status==='accepted'?(transferMode?'Принял ситуацию':'Принял'):i.status==='declined'?(transferMode?'Передача не состоялась':'Отклонил'):i.status==='cancelled'?'Отменено':'Ожидает ответа'}{i.status==='pending'&&(i.inviter_id===g.me?.user_id||g.teacher)&&!readOnly&&<button disabled={busy} onClick={()=>void act('cancel_event_invitation',{p_id:i.id})}>{transferMode?'Отменить передачу':'Отменить приглашение'}</button>}</span>)}</div>}
 {(assigned||g.teacher)&&<div className="eventTextDiscussion"><h4>Обсуждение ситуации</h4><div className="eventDiscussionLog" role="log" aria-live="polite">{entries.length?entries.map(e=><p key={e.id}><b>{g.names[e.author_id]||'Участник'}</b><span>{e.body}</span></p>):<p>Сообщений пока нет.</p>}</div>{canChat&&!closed&&<form onSubmit={e=>{e.preventDefault();if(text.trim())void act('send_event_discussion',{p_case:caseId,p_body:text})}}><input value={text} onChange={e=>setText(e.target.value)} maxLength={2000} placeholder="Короткое текстовое сообщение" aria-label="Сообщение по ситуации"/><button disabled={busy||!text.trim()}>Отправить</button></form>}</div>}
 {notice&&<p role="status">{notice}</p>}</section>;
}
