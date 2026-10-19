'use client';
import {useCallback,useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';

type Candidate={id:string;display_name:string;registration_status:string};
type Complaint={id:string;candidate_id:string;submitted_by:string;subject:string;allegation:string;legal_basis:string|null;status:'pending'|'maintained'|'dismissed'|'removed'|'referred_court';resolution:string|null;created_at:string;resolved_at:string|null};
const outcomes=[
 {value:'maintained',label:'Оставить кандидата на выборах'},
 {value:'dismissed',label:'Отказать в удовлетворении жалобы'},
 {value:'removed',label:'Снять кандидата с выборов'},
 {value:'referred_court',label:'Передать материалы в Верховный Суд Российской Федерации'}
] as const;
export default function PresidentialCecComplaints({g,candidates}:{g:ReturnTypeRepublic;candidates:Candidate[]}){
 const {game,me,teacher,setError}=g;
 const gameId=game?.id||'';
 const [records,setRecords]=useState<Complaint[]>([]);
 const [candidateId,setCandidateId]=useState('');
 const [subject,setSubject]=useState('');
 const [allegation,setAllegation]=useState('');
 const [legalBasis,setLegalBasis]=useState('');
 const [outcome,setOutcome]=useState<Record<string,string>>({});
 const [reason,setReason]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const reload=useCallback(async()=>{
  if(!gameId)return;
  const r=await supabase.from('presidential_cec_complaints').select('*').eq('game_id',gameId).order('created_at',{ascending:false});
  if(r.error)setError(userError(r.error));else setRecords((r.data||[]) as Complaint[]);
 },[gameId,setError]);
 useEffect(()=>{setRecords([]);setCandidateId('');setMessage('');void reload()},[reload]);
 const registered=candidates.filter(c=>c.registration_status==='registered');
 async function submit(){
  if(busy||!candidateId||subject.trim().length<8||allegation.trim().length<30)return;
  setBusy(true);
  const r=await supabase.rpc('submit_presidential_cec_complaint',{p_candidate_id:candidateId,p_subject:subject.trim(),p_allegation:allegation.trim(),p_legal_basis:legalBasis.trim()||null});
  if(r.error)setError(userError(r.error));else{setSubject('');setAllegation('');setLegalBasis('');setMessage('Жалоба зарегистрирована и передана ЦИК.');await reload()}
  setBusy(false);
 }
 async function decide(id:string){
  const choice=outcome[id],explanation=reason[id]?.trim()||'';
  if(!teacher||busy||!choice||explanation.length<30)return;
  setBusy(true);
  const r=await supabase.rpc('resolve_presidential_cec_complaint',{p_complaint_id:id,p_outcome:choice,p_reason:explanation});
  if(r.error)setError(userError(r.error));else{setMessage('Решение ЦИК по жалобе сохранено.');await reload();await g.refresh()}
  setBusy(false);
 }
 return <div className="stage7CecComplaints">
  <section className="stage7Panel cecComplaintForm">
   <div className="stage7PanelHead"><div><small>ЦЕНТРАЛЬНАЯ ИЗБИРАТЕЛЬНАЯ КОМИССИЯ</small><h3>Жалобы на кандидатов</h3><p>На этапе 7 участники могут обратиться в ЦИК по поводу возможных нарушений. Жалоба сама по себе не означает снятия кандидата.</p></div></div>
   {!teacher&&<div className="cecComplaintFields">
    <label>На кого подаётся жалоба<select value={candidateId} onChange={e=>setCandidateId(e.target.value)}><option value="">Выберите зарегистрированного кандидата</option>{registered.map(c=><option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label>
    <label>Предмет жалобы<input maxLength={180} value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Кратко укажите предполагаемое нарушение"/></label>
    <label>Обстоятельства и подтверждающие сведения<textarea rows={5} maxLength={6000} value={allegation} onChange={e=>setAllegation(e.target.value)} placeholder="Что произошло, когда, какие имеются доказательства или ссылки"/></label>
    <label>Правовое основание (если известно)<input maxLength={500} value={legalBasis} onChange={e=>setLegalBasis(e.target.value)} placeholder="Например, статья 84 Федерального закона № 19-ФЗ"/></label>
    <div className="cecComplaintActions"><span>Проверку фактов и принятие решения осуществляет ЦИК.</span><button type="button" className="primary" disabled={busy||!candidateId||subject.trim().length<8||allegation.trim().length<30} onClick={()=>void submit()}>Направить жалобу в ЦИК</button></div>
   </div>}
   {teacher&&<p className="stage7Notice">Рассмотрите жалобы, зафиксируйте мотивированное решение. Направление материалов в Верховный Суд не отменяет регистрацию автоматически.</p>}
   {message&&<p role="status" className="stage7Notice">{message}</p>}
  </section>
  <section className="stage7Panel">
   <div className="stage7PanelHead"><div><small>РЕЕСТР ОБРАЩЕНИЙ</small><h3>{teacher?'Жалобы на рассмотрении ЦИК':'Мои обращения и решения ЦИК'}</h3><p>Служебные материалы доступны заявителю и ЦИК; результат также доступен соответствующему кандидату.</p></div></div>
   <div className="cecComplaintList">{records.length===0?<p className="stage7Empty">Поступивших жалоб нет.</p>:records.map(x=><article className="cecComplaintItem" key={x.id}>
    <header><div><b>{x.subject}</b><small>{candidates.find(c=>c.id===x.candidate_id)?.display_name||'Кандидат'} · {new Date(x.created_at).toLocaleString('ru-RU')}</small></div><span>{x.status==='pending'?'На рассмотрении':outcomes.find(o=>o.value===x.status)?.label||x.status}</span></header>
    <p>{x.allegation}</p>{x.legal_basis&&<small>Указанное заявителем основание: {x.legal_basis}</small>}
    {x.resolution&&<div className="cecComplaintResolution"><b>Решение ЦИК</b><p>{x.resolution}</p></div>}
    {teacher&&x.status==='pending'&&<div className="cecComplaintModeration">
     <label>Результат рассмотрения<select value={outcome[x.id]||''} onChange={e=>setOutcome(v=>({...v,[x.id]:e.target.value}))}><option value="">Выберите решение</option>{outcomes.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</select></label>
     <label>Мотивированное решение<textarea rows={4} maxLength={6000} value={reason[x.id]||''} onChange={e=>setReason(v=>({...v,[x.id]:e.target.value}))} placeholder="Факты, доказательства, применимые нормы. Для снятия укажите статью федерального закона."/></label>
     {outcome[x.id]==='referred_court'&&<p className="stage7Notice">Направление в Верховный Суд фиксируется как отдельное действие; регистрация кандидата остаётся действующей до надлежащего решения.</p>}
     <div className="cecComplaintActions"><button type="button" className="primary" disabled={busy||!outcome[x.id]||(reason[x.id]||'').trim().length<30} onClick={()=>void decide(x.id)}>Принять решение по жалобе</button></div>
    </div>}
   </article>)}</div>
  </section>
 </div>;
}
