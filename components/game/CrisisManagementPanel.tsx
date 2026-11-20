'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {Crisis} from './types';
import {crisisPressure,crisisPressureLabel,crisisReadyToClose,crisisRule,crisisThreat} from './crisisManagementModel';
import styles from './CrisisRoom.module.css';

type Kind='escalate'|'stabilize'|'finish';
type Result={revision:number;threat:number;containment:number;status:'active'|'resolved'};
type History={id:number;kind:Kind;old_threat:number;new_threat:number;old_containment:number;new_containment:number;reason:string;created_at:string};
// A reason alone must be sufficient for a one-click change. Preserve explicit slider edits.
function suggestedChange(kind:'escalate'|'stabilize',current:{threat:number;containment:number}){
 if(kind==='escalate'){
  if(current.threat<100)return {threat:Math.min(100,current.threat+10),containment:current.containment};
  if(current.containment>0)return {threat:current.threat,containment:Math.max(0,current.containment-10)};
 }else{
  if(current.containment<100)return {threat:current.threat,containment:Math.min(100,current.containment+10)};
  if(current.threat>0)return {threat:Math.max(0,current.threat-10),containment:current.containment};
 }
 return null;
}
// Each action accepts only its own direction of change. An unrelated slider
// adjustment must never disable both buttons or be silently written as an
// opposite action. Fall back to the existing 10-point step when needed.
function actionTarget(kind:'escalate'|'stabilize',current:{threat:number;containment:number},draft:{threat:number;containment:number}){
 const target=kind==='escalate'
  ?{threat:Math.max(current.threat,draft.threat),containment:Math.min(current.containment,draft.containment)}
  :{threat:Math.min(current.threat,draft.threat),containment:Math.max(current.containment,draft.containment)};
 return target.threat!==current.threat||target.containment!==current.containment?target:suggestedChange(kind,current);
}
export default function CrisisManagementPanel({crisis,teacher,readOnly=false,onChanged,setError}:{
 crisis:Crisis;teacher:boolean;readOnly?:boolean;onChanged:()=>Promise<void>;setError:(value:unknown)=>void;
}){
 const source:Result={revision:crisis.management_revision??0,threat:crisisThreat(crisis),containment:crisis.containment_level??0,status:crisis.status};
 const [confirmed,setConfirmed]=useState<(Result&{id:string})|null>(null);
 const current=confirmed?.id===crisis.id&&confirmed.revision>source.revision?confirmed:source;
 const [threat,setThreat]=useState(current.threat);
 const [containment,setContainment]=useState(current.containment);
 const [reason,setReason]=useState('');
 const [checks,setChecks]=useState<[boolean,boolean,boolean]>([false,false,false]);
 const [busy,setBusy]=useState(false);
 const [historyOpen,setHistoryOpen]=useState(false);
 const [history,setHistory]=useState<History[]>([]);
 const [historyError,setHistoryError]=useState('');
 const [historyBusy,setHistoryBusy]=useState(false);
 const [historyVersion,setHistoryVersion]=useState(0);
 const pending=useRef<{fingerprint:string;id:string}|null>(null);
 const rule=crisisRule(crisis.crisis_type);
 const requirements=rule?.checks??[
  'Непосредственная опасность устранена','Неотложные действия подтверждены','Защита людей и необходимые услуги обеспечены'
 ] as const;
 const editable=teacher&&!readOnly&&current.status==='active';
 const changed=threat!==current.threat||containment!==current.containment;
 const escalation=actionTarget('escalate',current,{threat,containment});
 const stabilization=actionTarget('stabilize',current,{threat,containment});
 const canEscalate=escalation!==null;
 const canStabilize=stabilization!==null;
 const validReason=reason.trim().length>=10&&reason.trim().length<=1200;
 const closeReady=crisisReadyToClose(current.threat,current.containment);
 const mayClose=editable&&closeReady&&!changed&&checks.every(Boolean)&&reason.trim().length>=20&&reason.trim().length<=1200;
 const pressure=crisisPressure(current.threat,current.containment);
 useEffect(()=>{setThreat(current.threat);setContainment(current.containment)},[crisis.id,current.revision,current.threat,current.containment]);
 useEffect(()=>{
  if(!historyOpen)return;
  let cancelled=false;
  setHistoryBusy(true);setHistoryError('');
  void Promise.resolve(supabase.from('crisis_management_history')
   .select('id,kind,old_threat,new_threat,old_containment,new_containment,reason,created_at')
   .eq('game_id',crisis.game_id).eq('crisis_id',crisis.id)
   .order('id',{ascending:false}).limit(20))
   .then(result=>{
    if(cancelled)return;
    if(result.error)setHistoryError(userError(result.error));
    else setHistory((result.data||[]) as History[]);
    setHistoryBusy(false);
   }).catch(e=>{if(!cancelled){setHistoryError(userError(e));setHistoryBusy(false)}});
  return()=>{cancelled=true};
 },[historyOpen,historyVersion,crisis.game_id,crisis.id]);
 async function apply(kind:Kind){
  if(!editable||busy||!validReason)return;
  if(kind==='escalate'&&!canEscalate||kind==='stabilize'&&!canStabilize||kind==='finish'&&!mayClose)return;
  const note=reason.trim();
  const target=kind==='escalate'?escalation:kind==='stabilize'?stabilization:current;
  const nextThreat=target?.threat??current.threat;
  const nextContainment=target?.containment??current.containment;
  const confirmations=kind==='finish'?checks:[false,false,false];
  const fingerprint=JSON.stringify([crisis.id,current.revision,kind,nextThreat,nextContainment,note,confirmations]);
  if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID()};
  const id=pending.current.id;setBusy(true);
  try{
   const {data,error}=await supabase.rpc('manage_crisis',{
    p_crisis_id:crisis.id,p_action_id:id,p_expected_revision:current.revision,
    p_kind:kind,p_threat:nextThreat,p_containment:nextContainment,
    p_reason:note,p_confirmed_conditions:confirmations
   });
   if(error){setError(userError(error));return}
   const result=data as Result|null;
   if(!result||!Number.isInteger(result.revision)){setError('Не получено подтверждение от сервера');return}
   setConfirmed({...result,id:crisis.id});setReason('');setChecks([false,false,false]);pending.current=null;
   if(historyOpen)setHistoryVersion(n=>n+1);
   try{await onChanged()}catch{setError('Решение сохранено, но обновление экрана не удалось. Обновите страницу.')}
  }catch(error){setError(userError(error))}
  finally{setBusy(false)}
 }
 return <section className={styles.management} aria-label="Динамика кризиса">
  <div className={styles.managementHead}>
   <div><small>ДИНАМИКА КРИЗИСА</small><h3>Развитие и локализация</h3></div>
   <span className={styles.managementPressure}>{crisisPressureLabel(pressure)} · {pressure} из 100</span>
  </div>
  <p className={styles.managementNote}>Это условные игровые показатели текущей угрозы и выполненных мер. Оценки студентов и показатели Республики не изменяются.</p>
  <div className={styles.managementMeters}>
   <label className={styles.managementMeter}>
    <span><b>Сила кризиса</b><strong>{editable?threat:current.threat} из 100</strong></span>
    <input type="range" min={0} max={100} step={5} value={editable?threat:current.threat}
     disabled={!editable||busy} onChange={e=>setThreat(Number(e.target.value))}/>
    <small>{rule?.threat??'Непосредственная опасность населению и государственным службам'}</small>
   </label>
   <label className={styles.managementMeter}>
    <span><b>Локализация</b><strong>{editable?containment:current.containment} из 100</strong></span>
    <input type="range" min={0} max={100} step={5} value={editable?containment:current.containment}
     disabled={!editable||busy} onChange={e=>setContainment(Number(e.target.value))}/>
    <small>{rule?.containment??'Подтверждённые меры защиты и восстановления'}</small>
   </label>
  </div>
  {editable&&<div className={styles.managementEditor}>
   <label className={styles.managementReason}>Основание
    <textarea rows={2} maxLength={1200} value={reason} onChange={e=>setReason(e.target.value)}
     placeholder="Опишите реальное осложнение или выполненную меру. Не менее 10 символов."/>
   </label>
   <div className={styles.managementActions}>
    <button type="button" className="secondary" disabled={busy||!validReason||!canEscalate} onClick={()=>void apply('escalate')}>Обострить</button>
    <button type="button" className="primary" disabled={busy||!validReason||!canStabilize} onClick={()=>void apply('stabilize')}>Стабилизировать</button>
   </div>
   <p className={styles.managementNote}>После ввода основания выберите действие. «Обострить» учитывает усиление угрозы, «Стабилизировать» — увеличение локализации или снижение угрозы. Противоположные изменения ползунков не применяются; если нужный показатель не менялся, используется шаг 10 пунктов.</p>
   {!canEscalate&&<p className={styles.managementNote} role="status">Сила кризиса уже 100, локализация — 0. Дальнейшее числовое обострение невозможно.</p>}
   <fieldset className={styles.managementChecks}>
    <legend>Условия завершения острой фазы</legend>
    {requirements.map((text,index)=><label key={index}>
     <input type="checkbox" checked={checks[index]} onChange={e=>setChecks(prev=>prev.map((v,i)=>i===index?e.target.checked:v) as [boolean,boolean,boolean])}/>
     <span>{text}</span>
    </label>)}
   </fieldset>
   <div className={styles.managementFinish}>
    <p>{closeReady?'Числовые условия выполнены. Подтвердите три обстоятельства и опишите итог.':'Для завершения нужны сила кризиса не выше 30 и локализация не ниже 70. Последствия могут устраняться дальше.'}</p>
    <button type="button" className="primary" disabled={busy||!mayClose} onClick={()=>void apply('finish')}>Завершить кризис</button>
   </div>
  </div>}
  {current.status==='resolved'&&<p className={styles.managementNote} role="status">Острая фаза завершена. Журнал изменений сохранён.</p>}
  <button type="button" className={styles.managementHistoryButton} aria-expanded={historyOpen} onClick={()=>setHistoryOpen(v=>!v)}>
   {historyOpen?'Скрыть журнал':'Показать журнал изменений'}
  </button>
  {historyOpen&&<div className={styles.managementHistory} aria-live="polite">
   {historyBusy?<p>Загрузка изменений…</p>:historyError?<p role="alert">{historyError}</p>:history.length===0?<p>Изменений пока нет.</p>:
   <ol>{history.map(row=><li key={row.id}>
    <b>{row.kind==='escalate'?'Обострение':row.kind==='stabilize'?'Стабилизация':'Завершение'}</b>
    <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString('ru-RU')}</time>
    <p>Сила: {row.old_threat} → {row.new_threat}; локализация: {row.old_containment} → {row.new_containment}.</p>
    <p>{row.reason}</p>
   </li>)}</ol>}
   {history.length===20&&<small>Показаны последние 20 изменений. Более ранние записи сохраняются в базе.</small>}
  </div>}
 </section>;
}
