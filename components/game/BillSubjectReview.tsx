'use client';
import {useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {FORMAL_SUBJECTS} from './formalInstitutions';
import type {ReturnTypeRepublic} from './viewTypes';
import styles from './Stage12ReadingWorkspace.module.css';

export default function BillSubjectReview({g,readOnly,onOpenDocument}:{g:ReturnTypeRepublic;readOnly:boolean;onOpenDocument?:(id:string)=>void}){
 const bills=g.formalDocuments.filter(d=>d.stage_no===12&&d.workflow_key==='bill'&&['registered','committee','council','reading1','amendments','reading2','reading3'].includes(d.status_code));
 const [open,setOpen]=useState(false),[billId,setBillId]=useState(''),[subjects,setSubjects]=useState<string[]>([]),[subject,setSubject]=useState(''),[text,setText]=useState(''),[competence,setCompetence]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const request=useRef(0),court=['ks','vs'].includes(subject);
 async function choose(id:string){
  const version=++request.current;setBillId(id);setSubjects([]);setSubject('');setMessage('');setBusy(true);
  try{const r=await supabase.rpc('get_stage12_bill_review_subjects',{p_document_id:id});if(request.current!==version)return;if(r.error)throw r.error;const keys=r.data as string[];if(!Array.isArray(keys)||keys.some(k=>typeof k!=='string'))throw new Error('Сервер не подтвердил полномочия субъекта.');setSubjects(keys);setSubject(keys[0]||'');if(!keys.length)setMessage('Для подачи отзыва необходимо действующее полномочие субъекта законодательной инициативы.')}
  catch(error){if(request.current===version)setMessage(userError(error))}finally{if(request.current===version)setBusy(false)}
 }
 async function submit(){
  if(readOnly||busy||!bills.some(d=>d.id===billId)||!subjects.includes(subject)||text.trim().length<30||court&&competence.trim().length<10)return;setBusy(true);setMessage('');
  try{const r=await supabase.rpc('submit_stage12_bill_review',{p_document_id:billId,p_subject_key:subject,p_review:text.trim(),p_competence:court?competence.trim():null});if(r.error)throw r.error;setText('');setCompetence('');setMessage('Отзыв сохранён в сопровождении законопроекта. Профильный комитет и участники игры увидят его в досье.');await g.refresh()}
  catch(error){setMessage(userError(error))}finally{setBusy(false)}
 }
 return <div className={styles.reviewAction}>
  {!readOnly&&<button type="button" className="secondary" aria-expanded={open} onClick={()=>{setOpen(!open);if(!open&&!billId&&bills[0])void choose(bills[0].id)}}>Оставить отзыв на законопроект</button>}
  {open&&!readOnly&&<form className={styles.reviewForm} onSubmit={event=>{event.preventDefault();void submit()}}>
   {bills.length?<><label>Законопроект<select value={billId} disabled={busy||!!text.trim()} onChange={e=>void choose(e.target.value)}>{bills.map(d=><option key={d.id} value={d.id}>{d.registry_no} · {d.title}</option>)}</select></label>
    <label>Субъект законодательной инициативы<select value={subject} disabled={busy} onChange={e=>setSubject(e.target.value)}><option value="">Выберите полномочие</option>{subjects.map(key=><option key={key} value={key}>{FORMAL_SUBJECTS.find(s=>s.key===key)?.label||key}</option>)}</select></label>
    <label>Отзыв, предложения и замечания<textarea rows={4} minLength={30} maxLength={8000} value={text} onChange={e=>setText(e.target.value)} disabled={busy} placeholder="Позиция по законопроекту и её обоснование, не менее 30 символов"/></label>
    {court&&<label>Связь с вопросами ведения суда<textarea rows={2} maxLength={2000} value={competence} onChange={e=>setCompetence(e.target.value)} disabled={busy}/></label>}
    <div className={styles.actions}><button type="submit" className="primary" disabled={busy||!subject||text.trim().length<30||court&&competence.trim().length<10}>{busy?'Сохранение…':'Направить отзыв в досье'}</button>{onOpenDocument&&<button type="button" className="secondary" onClick={()=>onOpenDocument(billId)}>Открыть досье и отзывы</button>}</div></>:<p>Отзывы можно направлять после внесения законопроекта и до завершения чтений.</p>}
  </form>}
  {message&&<p role="status">{message}</p>}
 </div>;
}
