'use client';
import {useState} from 'react';
import PartyJusticeReview from './PartyJusticeReview';
import {partyLatestDocuments,partyVersionLabel,partyDocumentStatus} from './partyDocumentVersions';
import PartyChairFallback from './PartyChairFallback';
import PartyUnregisteredFiles from './PartyUnregisteredFiles';
import TeacherPartyStatistics from './TeacherPartyStatistics';
import {FileText,Trash2,UsersRound,Landmark,ShieldAlert,X,ExternalLink,MessageCircle} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
import type {ReturnTypeRepublic} from './viewTypes';
const docLabels:Record<string,string>={application:'Заявление',charter:'Устав',program:'Программа',fee:'Пошлина',symbol:'Символика',congress_minutes:'Учредительный съезд',other:'Дополнительный документ'};
export default function TeacherPartyDossiers({g,onOpenChat}:{g:ReturnTypeRepublic;onOpenChat?:(channelId:string)=>void}){
 const {parties,members,partyDocuments,partyInvitations,politicalPosts,channels,teacher,deleteParty}=g;
 const [selected,setSelected]=useState<string|null>(null);
 const [confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false);
 const [reviewingId,setReviewingId]=useState('');
 const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
 const [reviewNotice,setReviewNotice]=useState<{id:string;success:boolean;message:string}|null>(null);
 async function review(id:string,status:'accepted'|'revision'){
  if(reviewingId)return;
  setReviewingId(id);setReviewNotice(null);
  try{
   const ok=await g.reviewPartyDocument(id,status,status==='revision'?reviewNotes[id]:undefined);
   setReviewNotice({id,success:ok,message:ok?(status==='accepted'?'Версия принята. Партия увидит решение в разделе «Партии».':'Версия возвращена на доработку. Партия увидит замечание и сможет загрузить следующую версию.'):'Изменение не подтверждено. Проверьте сообщение об ошибке.'});
   if(ok&&status==='revision')setReviewNotes(previous=>{const next={...previous};delete next[id];return next});
  }
  finally{setReviewingId('')}
 }
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 const target=parties.find(p=>p.id===selected);
 const close=()=>{if(!busy){setSelected(null);setConfirm('');setError('')}};
 const dialogRef=useDialog(selected!==null,close);
 async function remove(){
  if(!target||confirm!==target.name||busy)return;
  setBusy(true);setError('');
  const ok=await deleteParty(target.id);
  setBusy(false);
  if(ok){setNotice('Партия «'+target.name+'» удалена. Связанные документы и публикации исключены из базы.');close()}
  else setError('Удаление не выполнено. Проверьте системное сообщение.');
 }
 if(!teacher)return null;
 return <section className="teacherPartyDossiers" aria-label="Расширенные партийные досье">
  <header className="teacherPartyDossierHead"><div><small>ПОЛНОЕ ДОСЬЕ</small><h2>Партии, руководство и регистрация</h2><p>Председателя избирают члены партии. Преподавателю доступно резервное переназначение и рассмотрение регистрационных документов.</p></div><span>{parties.length} партий</span></header>
  <div className="teacherPartyDossierGrid">{parties.length===0?<div className="journalEmpty">Партии пока не созданы.</div>:parties.map(p=>{
   const staff=members.filter(m=>m.kind==='student'&&m.team===p.name);
   const leader=members.find(m=>m.user_id===p.leader_user_id);
   const docs=partyDocuments.filter(d=>d.party_id===p.id);
   const latestIds=new Set(partyLatestDocuments(docs).map(d=>d.id));
   const posts=politicalPosts.filter(x=>x.actor_key==='party'&&x.actor_label===p.name);
   const invites=partyInvitations.filter(i=>i.party_id===p.id&&i.status==='pending');
   return <article key={p.id} className="teacherPartyDossier">
    <header><span className="teacherPartyMark" style={{background:p.color}}>{p.name.slice(0,2).toUpperCase()}</span><div><h3>{p.name}</h3><p>{p.ideology||'Идеология не указана'} · {({registered:'Зарегистрирована',submitted:'На регистрации',draft:'Регистрация: Черновик',revision:'Регистрация: На доработке',rejected:'Регистрация: Отклонена'}[p.registration_status]||'Регистрация: Не определена')}</p></div><button type="button" title="Открыть партийный чат" aria-label={'Перейти в чат партии '+p.name}
 className="teacherPartyChat" disabled={!channels.some(c=>c.name==='Фракция · '+p.name)}
 onClick={()=>{const c=channels.find(x=>x.name==='Фракция · '+p.name);if(c)onOpenChat?.(c.id)}}>
 <MessageCircle size={18} aria-hidden="true"/></button></header>
    {p.description&&<p className="teacherPartyDescription">{p.description}</p>}
    <TeacherPartyStatistics g={g} party={p} invitations={invites.length}/>
    <div className="teacherPartySection"><h4><Landmark size={15} aria-hidden="true"/> Руководство и состав</h4>
     <p><b>Председатель:</b> {leader?.full_name||'Не назначен'}</p>
     {staff.length?<ul>{staff.map(m=><li key={m.user_id}><span>{m.full_name}<small>{m.user_id===p.leader_user_id?'Председатель партии «'+p.name+'»':m.role_title||'Участник'}</small></span></li>)}</ul>:<p className="teacherPartyMuted"><UsersRound size={15} aria-hidden="true"/> Участники пока не вступили в партию</p>}
     <PartyChairFallback g={g} party={p}/>
    </div>
    <div className="teacherPartySection"><h4><FileText size={15} aria-hidden="true"/> Документы ({docs.length})</h4>
     {docs.length?<ul>{docs.map(d=><li key={d.id}><span>{docLabels[d.doc_kind]||d.doc_kind}<small>{partyVersionLabel(d)} · {d.title} · {d.file_name} · {members.find(m=>m.user_id===d.uploaded_by)?.full_name||'Участник'} · {partyDocumentStatus(d)}{latestIds.has(d.id)?' · Текущая версия':' · Архивная версия'}</small></span>{d.url?<a href={d.url} target="_blank" rel="noreferrer" aria-label={'Открыть '+d.title}><ExternalLink size={15}/></a>:<span>—</span>}{d.note&&<p className="teacherPartyMuted"><b>Замечание по {partyVersionLabel(d)}:</b> {d.note}</p>}<div className="civicDocReview"><label className="civicPartyUploadField"><span>Замечание при возврате</span><input type="text" value={reviewNotes[d.id]||''} onChange={e=>setReviewNotes(previous=>({...previous,[d.id]:e.target.value}))} placeholder="Что необходимо исправить" aria-label={'Замечание к документу '+d.title} disabled={!!reviewingId}/></label><button type="button" className={d.status==='accepted'?'primary':'secondary'} disabled={!!reviewingId||d.status==='accepted'||d.status==='revision'||!latestIds.has(d.id)} aria-disabled={d.status==='accepted'} onClick={()=>void review(d.id,'accepted')}>{reviewingId===d.id?'Рассматривается…':d.status==='accepted'?'Принято':'Принять'}</button><button type="button" className="secondary" disabled={!!reviewingId||d.status==='revision'||d.status==='accepted'||!latestIds.has(d.id)} onClick={()=>void review(d.id,'revision')}>На доработку</button></div>{reviewNotice?.id===d.id&&<p className={'civicPartyInviteFeedback '+(reviewNotice.success?'isSuccess':'isError')} role={reviewNotice.success?'status':'alert'}>{reviewNotice.message}</p>}</li>)}</ul>:<p className="teacherPartyMuted">Документы не загружены</p>}
    </div>
    {g.game?.id&&<PartyUnregisteredFiles gameId={g.game.id} partyId={p.id} registered={docs}/>}
    <PartyJusticeReview g={g} party={p}/>
    <footer><span>{posts.length} партийных публикаций · {staff.length} участников</span><button type="button" onClick={()=>{setSelected(p.id);setConfirm('');setNotice('')}}><Trash2 size={15} aria-hidden="true"/> Удалить партию</button></footer>
   </article>;
  })}</div>
  {notice&&<p className="teacherPartyNotice" role="status">{notice}</p>}
  {target&&<div className="teacherResetBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
   <section ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="party-delete-title" aria-describedby="party-delete-desc" className="teacherResetDialog">
    <div className="teacherResetDialogTop"><span className="teacherResetWarningIcon"><ShieldAlert size={24} aria-hidden="true"/></span><button type="button" className="teacherResetClose" aria-label="Закрыть" onClick={close} disabled={busy}><X size={18}/></button></div>
    <h2 id="party-delete-title">Удалить «{target.name}»?</h2>
    <p id="party-delete-desc">Будут удалены партийное досье, документы, приглашения, мандаты и публикации от имени этой партии с их вложениями. Участники сохранятся без партии. История независимых действий студентов и утверждённые оценки останутся. Удаление необратимо.</p>
    <label className="teacherResetWord">Введите точное название партии для подтверждения:
     <input type="text" autoComplete="off" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder={target.name} disabled={busy}/>
    </label>
    {error&&<p className="teacherResetError" role="alert">{error}</p>}
    <div className="teacherResetDialogActions"><button type="button" className="teacherResetCancel" onClick={close} disabled={busy}>Отмена</button><button type="button" className="teacherResetConfirm" disabled={busy||confirm!==target.name} onClick={()=>void remove()}><Trash2 size={16}/>{busy?'Удаление…':'Удалить партию'}</button></div>
   </section>
  </div>}
 </section>;
}
