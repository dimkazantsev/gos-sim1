'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';
import styles from './LegislativeSessionLab.module.css';
export default function Stage12AgendaText({g,sessionId,documentId,status,canEdit,questions,onOpenDocument}:{
 g:ReturnTypeRepublic;sessionId:string;documentId:string|null;status:'draft'|'open'|'closed';
 canEdit:boolean;questions:number;onOpenDocument?:(id:string)=>void
}){
 const [current,setCurrent]=useState(''),[text,setText]=useState(''),[reason,setReason]=useState('');
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!g.game||!documentId){setCurrent('');setText('');return;}
  let active=true;setLoading(true);
  void supabase.from('formal_documents').select('body_text').eq('game_id',g.game.id).eq('id',documentId).maybeSingle()
   .then(result=>{if(!active)return;if(result.error)setError(userError(result.error));else{const next=result.data?.body_text||'';setCurrent(next);setText(next)}setLoading(false)});
  return()=>{active=false};
 },[g.game?.id,documentId,sessionId,questions]);
 async function save(){
  if(!documentId||busy||!canEdit||status==='closed'||text.trim().length<80||text.length>20000||text.trim()===current.trim()||
   status==='open'&&reason.trim().length<10)return;
  setBusy(true);setError('');
  const r=await supabase.rpc('edit_stage12_duma_agenda_text',{
   p_session_id:sessionId,p_body:text.trim(),p_expected_body:current,
   p_reason:status==='open'?reason.trim():null
  });
  if(r.error)setError(userError(r.error));
  else{setCurrent(text.trim());setEditing(false);setReason('')}
  setBusy(false);
 }
 return <section className={styles.agendaTextPanel} aria-label="Автоматическая повестка заседания">
  <div className={styles.agendaTextHeading}>
   <div><b>Повестка заседания</b>
    <p>{status==='draft'?'Автоматически пополняется подготовленными пакетами до открытия заседания.':
      'После открытия разрешена корректировка только текста, без изменения состава вопросов.'}</p></div>
   {documentId&&onOpenDocument&&<button type="button" className="secondary" onClick={()=>onOpenDocument(documentId)}>Документ повестки</button>}
   {canEdit&&status!=='closed'&&documentId&&<button type="button" className="secondary" aria-expanded={editing}
    onClick={()=>{setEditing(value=>!value);setText(current)}}>{editing?'Отменить правку':'Редактировать текст'}</button>}
  </div>
  {!documentId?<p role="status">Документ повестки появится после создания заседания.</p>:
   loading?<p role="status">Загрузка повестки…</p>:
   editing?<div className={styles.agendaTextEditor}>
    <label>Текст документа повестки<textarea rows={8} maxLength={20000} value={text} onChange={event=>setText(event.target.value)}/></label>
    {status==='open'&&<label>Основание корректировки после открытия заседания<textarea rows={2} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>}
    <button type="button" className="primary" disabled={busy||text.trim().length<80||text.length>20000||text.trim()===current.trim()||status==='open'&&reason.trim().length<10} onClick={()=>void save()}>
     Сохранить текст повестки
    </button>
   </div>:<div className={styles.agendaTextPreview}><p>{current||'Повестка ещё не сформирована.'}</p></div>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
