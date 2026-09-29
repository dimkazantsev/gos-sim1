'use client';
import {useState} from 'react';
import {FileText,Trash2,UsersRound,Landmark,ShieldAlert,X,ExternalLink} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
import type {ReturnTypeRepublic} from './viewTypes';
const docLabels:Record<string,string>={application:'Заявление',charter:'Устав',program:'Программа',fee:'Пошлина',symbol:'Символика',congress_minutes:'Учредительный съезд',other:'Дополнительный документ'};
export default function TeacherPartyDossiers({g}:{g:ReturnTypeRepublic}){
 const {parties,members,partyDocuments,partyMandates,partyInvitations,politicalPosts,teacher,deleteParty}=g;
 const [selected,setSelected]=useState<string|null>(null);
 const [confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false);
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
  <header className="teacherPartyDossierHead"><div><small>ПОЛНОЕ ДОСЬЕ</small><h2>Фракции, состав и партийные документы</h2><p>Информация из раздела «Партии» собрана вместе с управлением мандатами и регистрацией.</p></div><span>{parties.length} партий · {parties.reduce((v,p)=>v+Number(p.mandates||0),0)}/450 мандатов</span></header>
  <div className="teacherPartyDossierGrid">{parties.length===0?<div className="journalEmpty">Партии пока не созданы.</div>:parties.map(p=>{
   const staff=members.filter(m=>m.kind==='student'&&m.team===p.name);
   const leader=members.find(m=>m.user_id===p.leader_user_id);
   const docs=partyDocuments.filter(d=>d.party_id===p.id);
   const posts=politicalPosts.filter(x=>x.actor_key==='party'&&x.actor_label===p.name);
   const invites=partyInvitations.filter(i=>i.party_id===p.id&&i.status==='pending');
   return <article key={p.id} className="teacherPartyDossier">
    <header><span className="teacherPartyMark" style={{background:p.color}}>{p.name.slice(0,2).toUpperCase()}</span><div><h3>{p.name}</h3><p>{p.ideology||'Идеология не указана'} · {p.registration_status==='registered'?'Зарегистрирована':p.registration_status==='submitted'?'На регистрации':'Регистрация: '+p.registration_status}</p></div><button type="button" title="Удалить партию и связанные материалы" aria-label={'Удалить партию '+p.name} className="teacherPartyDelete" onClick={()=>{setSelected(p.id);setConfirm('');setNotice('')}}><Trash2 size={17} aria-hidden="true"/></button></header>
    {p.description&&<p className="teacherPartyDescription">{p.description}</p>}
    <div className="teacherPartyKpis">
     <span><strong>{p.mandates}</strong> мандатов</span><span><strong>{p.support}</strong> поддержка</span>
     <span><strong>{p.regions}</strong> регионов</span><span><strong>{p.budget}</strong> бюджет</span>
     <span><strong>{p.ghost_loss_current}</strong> потеря GV</span><span><strong>{invites.length}</strong> приглашений</span>
    </div>
    <div className="teacherPartySection"><h4><Landmark size={15} aria-hidden="true"/> Руководство и состав</h4>
     <p><b>Председатель:</b> {leader?.full_name||'Не назначен'}</p>
     {staff.length?<ul>{staff.map(m=>{const alloc=partyMandates.find(a=>a.party_id===p.id&&a.user_id===m.user_id);return <li key={m.user_id}><span>{m.full_name}<small>{m.role_title||'Участник'}</small></span><b>{alloc?.effective_mandates||0} гол.</b></li>})}</ul>:<p className="teacherPartyMuted"><UsersRound size={15} aria-hidden="true"/> Участники пока не назначены</p>}
    </div>
    <div className="teacherPartySection"><h4><FileText size={15} aria-hidden="true"/> Документы ({docs.length})</h4>
     {docs.length?<ul>{docs.map(d=><li key={d.id}><span>{docLabels[d.doc_kind]||d.doc_kind}<small>{d.title} · {d.status==='accepted'?'Принят':d.status==='revision'?'На доработке':'Загружен'}</small></span>{d.url?<a href={d.url} target="_blank" rel="noreferrer" aria-label={'Открыть '+d.title}><ExternalLink size={15}/></a>:<span>—</span>}</li>)}</ul>:<p className="teacherPartyMuted">Документы не загружены</p>}
    </div>
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
