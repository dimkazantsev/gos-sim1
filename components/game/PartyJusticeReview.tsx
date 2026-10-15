'use client';
import {useState} from 'react';
import StyledSelect from '../ui/StyledSelect';
import JusticeDocuments from './JusticeDocuments';
import InstitutionEmblemImage from './InstitutionEmblemImage';
import {institutionEmblem} from './institutionEmblems';
import {buildPartyJusticeLetter,PARTY_REQUIRED_DOCS,type JusticeDraftDecision} from './partyJusticeLetter';
import type {Party} from './types';
import type {ReturnTypeRepublic} from './viewTypes';

export default function PartyJusticeReview({g,party}:{g:ReturnTypeRepublic;party:Party}){
 const [decision,setDecision]=useState<JusticeDraftDecision>('registered');
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const docs=g.partyDocuments.filter(d=>d.party_id===party.id);
 const leader=g.members.find(m=>m.user_id===party.leader_user_id);
 const latestDocs=docs.filter(d=>!docs.some(next=>next.doc_kind===d.doc_kind&&(Date.parse(next.created_at)>Date.parse(d.created_at)||(next.created_at===d.created_at&&next.id>d.id))));
 const ready=PARTY_REQUIRED_DOCS.every(req=>latestDocs.some(d=>d.doc_kind===req.kind&&d.status==='accepted'));
 const missingGrounds=decision==='rejected'&&note.includes('[Укажите');
 function draft(next:JusticeDraftDecision=decision){
  setDecision(next);
  setNote(buildPartyJusticeLetter(party,docs,leader?.full_name,next));
  setNotice('Сформирован проект ответа. Проверьте данные и основания, затем подпишите его отдельно.');
 }
 async function send(){
  if(busy||note.trim().length<10||note.includes('[Укажите')||note.includes('[Номер документа]')||note.includes('[Дата подписания]')||note.includes('[ФИО и подпись')||note.includes('[Дата поступления заявления]')||(decision==='registered'&&!ready))return;
  setBusy(true);setNotice('');
  try{
   const ok=await g.reviewPartyRegistration(party.id,decision,note);
   setNotice(ok?'Решение подписано и направлено партии. Официальная публикация добавлена в политические процессы.':'Не удалось оформить решение. Проверьте системное сообщение.');
  }finally{setBusy(false)}
 }
 return <section className="justiceReview">
  <header><InstitutionEmblemImage src={institutionEmblem('minjust','Министерство юстиции Российской Федерации')} width={48} height={48} alt="Эмблема Минюста"/><div><h4>Министерство юстиции</h4><p>Ответ по регистрационному пакету «{party.name}»</p></div></header>
  <StyledSelect label="Решение по заявлению" value={decision} onChange={v=>{setDecision(v as JusticeDraftDecision);setNote('');setNotice('')}} options={[
   {value:'registered',label:'Зарегистрировать партию'},
   {value:'revision',label:'Вернуть на доработку'},
   {value:'rejected',label:'Отказать в регистрации'}
  ]}/>
  <div className="partyJusticeDraftActions">
   <button type="button" className="secondary" onClick={()=>draft()}>Подготовить ответ по данным партии</button>
   <div className="partyJusticeAutoActions" role="group" aria-label="Автоматические проекты ответа Минюста">
    <button type="button" className="secondary" onClick={()=>draft('registered')} disabled={busy||!ready}>Авто-да · Проект одобрения</button>
    <button type="button" className="secondary" onClick={()=>draft('rejected')} disabled={busy}>Авто-нет · Проект отказа</button>
   </div>
   <small>Кнопки заполняют черновик по образцам Минюста. Они не регистрируют партию и не направляют отказ без подписи.</small>
  </div>
  <label>Текст официального ответа<textarea rows={13} value={note} onChange={e=>setNote(e.target.value)} placeholder="Подготовьте ответ и укажите установленные основания решения"/></label>
  {decision==='registered'&&!ready&&<p role="status">Одобрение недоступно до принятия всех шести обязательных документов.</p>}
  {missingGrounds&&<p role="status">Для отказа укажите проверенные нарушения и соответствующие нормы права. Заполнение по шаблону не означает, что нарушения установлены.</p>}
  <button type="button" className="primary" disabled={busy||note.trim().length<10||note.includes('[Укажите')||(decision==='registered'&&!ready)} onClick={()=>void send()}>{busy?'Направляется…':'Подписать и направить от имени Минюста'}</button>
  {notice&&<p role="status">{notice}</p>}
  <JusticeDocuments g={g} partyId={party.id}/>
 </section>;
}
