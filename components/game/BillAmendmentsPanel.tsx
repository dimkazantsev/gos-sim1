'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import StyledSelect from '../ui/StyledSelect';
import type {FormalDocument} from './types';
import type {ReturnTypeRepublic} from './viewTypes';
import {FORMAL_SUBJECTS} from './formalInstitutions';
import {notifyGameDataRefresh,useGameTableSync} from './useGameTableSync';
import styles from './StageForms.module.css';

type Amendment={id:string;author_id:string;subject_key:string;old_text:string;new_text:string;rationale:string;competence_note:string;status:'submitted'|'voting'|'accepted'|'rejected'|'withdrawn';vote_id:string|null;review_note:string|null;can_withdraw:boolean;stale:boolean};
type Pack={id:string;vote_id:string;status:string;result_label:string|null};
type AmendmentState={document_id:string;body_text:string;status_code:string;can_manage:boolean;can_submit:boolean;subjects:string[];pending_count:number;open_vote_id:string|null;amendments:Amendment[];packs:Pack[]};
export type BillAmendmentGate={documentId:string;pending:boolean;checked:boolean};
const labels:Record<Amendment['status'],string>={submitted:'Внесена',voting:'На голосовании',accepted:'Принята и включена в текст',rejected:'Отклонена',withdrawn:'Отозвана автором'};
const tables=['bill_amendments','bill_amendment_packs','formal_documents','game_votes','game_members','game_office_assignments','game_role_consequences','institution_assignments','institution_units','bill_submission_profiles'] as const;

export default function BillAmendmentsPanel({g,document,onOpenVotes,readOnly=false,onPendingChange}:{g:ReturnTypeRepublic;document:FormalDocument;onOpenVotes:(id?:string)=>void;readOnly?:boolean;onPendingChange?:(gate:BillAmendmentGate)=>void}){
 const [result,setResult]=useState<{scope:string;data:AmendmentState}|null>(null),[failure,setFailure]=useState<{scope:string;message:string}|null>(null);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [subject,setSubject]=useState(''),[oldText,setOldText]=useState(''),[newText,setNewText]=useState(''),[rationale,setRationale]=useState(''),[competence,setCompetence]=useState('');
 const [selected,setSelected]=useState<string[]>([]),[reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
 const scope=JSON.stringify([g.game?.id,g.me?.user_id,document.id,readOnly]),active=useRef(scope),request=useRef(0),mounted=useRef(true),notify=useRef(onPendingChange);
 active.current=scope;notify.current=onPendingChange;
 const data=result?.scope===scope?result.data:null,error=failure?.scope===scope?failure.message:'';
 const phase=['amendments','reading2'].includes(data?.status_code||document.status_code),canManage=!!data?.can_manage&&!readOnly;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++}},[]);
 useEffect(()=>{setSubject('');setOldText('');setNewText('');setRationale('');setCompetence('');setSelected([]);setReviewNotes({});setBusy(false);return()=>{request.current++}},[scope]);
 useEffect(()=>{notify.current?.({documentId:document.id,pending:!!data?.pending_count,checked:!!data&&!error});},[document.id,data,error]);
 async function load(){
  const version=++request.current,current=()=>mounted.current&&active.current===scope&&version===request.current;
  setLoading(true);
  try{
   const r=await supabase.rpc('get_bill_amendments',{p_document_id:document.id});if(!current())return;
   if(r.error)throw new Error(r.error.message);
   const value=r.data as AmendmentState;
   if(!value||value.document_id!==document.id||!Array.isArray(value.amendments)||!Array.isArray(value.subjects)||!Array.isArray(value.packs)||typeof value.pending_count!=='number')throw new Error('Сервер не вернул проверку поправок.');
   setResult({scope,data:value});setFailure(null);
   setSelected(ids=>ids.filter(id=>value.amendments.some(a=>a.id===id&&a.status==='submitted'&&!a.stale)));
   setSubject(currentSubject=>value.subjects.includes(currentSubject)?currentSubject:value.subjects[0]||'');
  }catch(e){if(current()){setResult(null);setFailure({scope,message:e instanceof Error?e.message:'Не удалось загрузить поправки.'});}}
  finally{if(current())setLoading(false);}
 }
 useGameTableSync(g.game?.id,tables,load,'bill-amendments:'+document.id+':'+(g.me?.user_id||''));
 useEffect(()=>{void load()},[scope,document.updated_at]);
 async function mutate(name:string,args:Record<string,unknown>,success?:(value:unknown)=>void){
  if(readOnly||busy||!data)return;setBusy(true);
  try{
   const r=await supabase.rpc(name,args);if(!mounted.current||active.current!==scope)return;
   if(r.error){g.setError(r.error.message);return;}
   success?.(r.data);await load();await g.refresh();
   if(g.game)notifyGameDataRefresh(g.game.id);
  }catch(e){if(mounted.current&&active.current===scope)g.setError(e);}
  finally{if(mounted.current&&active.current===scope)setBusy(false);}
 }
 const quoteStart=data?.body_text.indexOf(oldText)??-1;
 const uniqueQuote=oldText.trim().length>0&&quoteStart>=0&&data?.body_text.indexOf(oldText,quoteStart+1)===-1;
 const court=['ks','vs'].includes(subject);
 const canSubmit=!!data?.can_submit&&!readOnly&&!data.open_vote_id&&uniqueQuote&&oldText!==newText&&rationale.trim().length>=10&&(!court||competence.trim().length>=10);
 const chosen=data?.amendments.filter(a=>selected.includes(a.id)&&a.status==='submitted'&&!a.stale)||[];
 const openVote=data?.open_vote_id;
 if(document.workflow_key!=='bill')return null;
 return <section className={styles.panel} aria-label="Поправки ко второму чтению">
  <header className={styles.sectionHead}><div><small>II ЧТЕНИЕ · ЗАКОНОПРОЕКТ</small><h3>Поправки к тексту</h3><p>Субъекты законодательной инициативы предлагают изменения. Председатель ГД или профильный комитет выбирает пакет, а зарегистрированные депутаты голосуют. Принятые поправки входят в текст законопроекта.</p></div><button type="button" className="secondary" disabled={loading||busy} onClick={()=>void load()} aria-label="Повторить загрузку поправок">Обновить</button></header>
  {error&&<p role="alert">{error}</p>}
  {!data&&!error&&<p role="status">Загружаю поправки и проверяю полномочия…</p>}
  {data&&<>
   <p className={styles.notice} role="status">{data.pending_count?`Ожидают решения: ${data.pending_count}. Сначала рассмотрите или отзовите эти поправки, затем продолжайте чтения законопроекта.`:phase?'Нерассмотренных поправок нет. Законопроект может продолжить установленный маршрут.':'Внести новую поправку можно при подготовке и проведении II чтения.'}</p>
   {openVote&&<div className={styles.actions}><button type="button" className="primary" onClick={()=>onOpenVotes(openVote)}>Открыть голосование по пакету</button>{canManage&&<button type="button" disabled={busy} onClick={()=>void mutate('close_procedural_vote',{p_vote_id:openVote,p_note:'Итог пакета поправок ко II чтению'})}>Завершить голосование по пакету</button>}</div>}
   {phase&&data.can_submit&&!readOnly&&<form className={styles.form} onSubmit={e=>{e.preventDefault();if(canSubmit)void mutate('submit_bill_amendment',{p_document_id:document.id,p_subject_key:subject,p_old_text:oldText,p_new_text:newText,p_rationale:rationale.trim(),p_competence_note:court?competence.trim():null},()=>{setOldText('');setNewText('');setRationale('');setCompetence('')});}}>
    <StyledSelect wrap label="Субъект законодательной инициативы" value={subject} onChange={setSubject} options={data.subjects.map(key=>({value:key,label:FORMAL_SUBJECTS.find(s=>s.key===key)?.label||key}))} disabled={busy}/>
    <div className={styles.grid}><label className={styles.field}>Действующий фрагмент<textarea rows={4} maxLength={120000} value={oldText} onChange={e=>setOldText(e.target.value)} placeholder="Скопируйте точную уникальную цитату из текста законопроекта" disabled={busy}/></label><label className={styles.field}>Предлагаемая редакция<textarea rows={4} maxLength={120000} value={newText} onChange={e=>setNewText(e.target.value)} placeholder="Новый текст; пустое поле означает удаление фрагмента" disabled={busy}/></label></div>
    {oldText&&!uniqueQuote&&<p role="status">Цитата должна точно встречаться в действующем тексте один раз.</p>}
    <label className={styles.field}>Обоснование поправки<textarea rows={3} maxLength={4000} value={rationale} onChange={e=>setRationale(e.target.value)} disabled={busy}/></label>
    {court&&<label className={styles.field}>Связь с вопросами ведения суда<textarea rows={3} maxLength={4000} value={competence} onChange={e=>setCompetence(e.target.value)} disabled={busy}/><span>КС РФ и ВС РФ вносят поправки только по вопросам своего ведения. Укажите конкретную связь с компетенцией суда.</span></label>}
    {oldText&&<div className={styles.amendment} aria-label="Предпросмотр поправки"><small>ДЕЙСТВУЮЩАЯ РЕДАКЦИЯ</small><del>{oldText}</del><small>ПРЕДЛАГАЕМАЯ РЕДАКЦИЯ</small><ins>{newText||'Фрагмент предлагается удалить'}</ins></div>}
    <div className={styles.actions}><button type="submit" className="primary" disabled={busy||!canSubmit}>Внести поправку</button></div>
   </form>}
   <div className={styles.section}><header className={styles.sectionHead}><h3>Таблица поправок</h3><span>{data.amendments.length}</span></header>
    {!data.amendments.length?<p>Поправки ещё не внесены.</p>:data.amendments.map(a=><article key={a.id} className={styles.amendment} data-status={a.status}>
     <header><label>{canManage&&phase&&a.status==='submitted'&&<input type="checkbox" aria-label={'Включить поправку '+a.id+' в пакет'} checked={selected.includes(a.id)} disabled={busy||!!openVote||a.stale} onChange={e=>setSelected(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/>}<span><b>{g.members.find(m=>m.user_id===a.author_id)?.full_name||'Участник'}</b><br/>{FORMAL_SUBJECTS.find(s=>s.key===a.subject_key)?.short||a.subject_key}</span></label><span className={styles.pill}>{labels[a.status]}</span></header>
     {a.stale&&a.status==='submitted'&&<p role="status">Текст изменился после внесения. Автор может отозвать поправку и внести её заново; комитет может мотивированно не включить её.</p>}
     <small>ДЕЙСТВУЮЩАЯ РЕДАКЦИЯ НА МОМЕНТ ВНЕСЕНИЯ</small><del>{a.old_text}</del><small>ПРЕДЛАГАЕМАЯ РЕДАКЦИЯ</small><ins>{a.new_text||'Удалить фрагмент'}</ins><p>{a.rationale}</p>{a.competence_note&&<p>Вопросы ведения суда: {a.competence_note}</p>}{a.review_note&&<p>Решение комитета: {a.review_note}</p>}
     <div className={styles.actions}>{a.vote_id&&<button type="button" className="secondary" onClick={()=>onOpenVotes(a.vote_id!)}>Голосование</button>}{a.can_withdraw&&!readOnly&&<button type="button" disabled={busy} onClick={()=>void mutate('withdraw_bill_amendment',{p_amendment_id:a.id})}>Отозвать поправку</button>}</div>
     {canManage&&a.status==='submitted'&&<div className={styles.grid}><label className={styles.field}>Причина невключения в пакет<textarea rows={2} maxLength={4000} value={reviewNotes[a.id]||''} onChange={e=>setReviewNotes(notes=>({...notes,[a.id]:e.target.value}))} disabled={busy}/></label><div className={styles.actions}><button type="button" disabled={busy||(reviewNotes[a.id]||'').trim().length<10} onClick={()=>void mutate('reject_bill_amendment',{p_amendment_id:a.id,p_note:reviewNotes[a.id].trim()})}>Не включать в пакет</button></div></div>}
    </article>)}
    {canManage&&phase&&!openVote&&<div className={styles.actions}><span>Выбрано: {chosen.length}</span><button type="button" className="primary" disabled={busy||!chosen.length} onClick={()=>void mutate('open_bill_amendment_vote',{p_document_id:document.id,p_amendment_ids:chosen.map(a=>a.id)},value=>{setSelected([]);onOpenVotes(String(value));})}>Открыть голосование по выбранным поправкам</button></div>}
   </div>
   {data.packs.length>0&&<details className={styles.section}><summary>История пакетов и голосований</summary>{data.packs.map(p=><div className={styles.row} key={p.id}><b>{p.status==='accepted'?'Поправки приняты':p.status==='no_quorum'?'Нет кворума; поправки вновь доступны':p.status==='rejected'?'Пакет отклонён':'Идёт голосование'}</b><p>{p.result_label}</p><button type="button" className="secondary" onClick={()=>onOpenVotes(p.vote_id)}>Открыть результат голосования</button></div>)}</details>}
  </>}
 </section>;
}
