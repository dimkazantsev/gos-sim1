'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import StyledSelect from '../ui/StyledSelect';
import {FORMAL_SUBJECTS} from './formalInstitutions';
import {expenseKopecks,kopecksMoney} from './stateProgramModel';
import {notifyGameDataRefresh,useGameTableSync} from './useGameTableSync';
import {budgetMoney,budgetMoneySum,type BudgetCalculation} from './federalBudgetMath';
import type {FormalDocument} from './types';
import type {ReturnTypeRepublic} from './viewTypes';
import type {BillAmendmentGate} from './BillAmendmentsPanel';
import styles from './BudgetLawAmendmentsPanel.module.css';

type Amendment={id:string;author_id:string;subject_key:string;title:string;rationale:string;competence_note:string;from_section:string;to_section:string;amount:number;source_calculation:BudgetCalculation;status:'submitted'|'voting'|'accepted'|'rejected'|'withdrawn';vote_id:string|null;review_note:string|null;stale:boolean;can_withdraw:boolean};
type Pack={id:string;vote_id:string;status:string;result_label:string|null};
type State={document_id:string;status_code:string;revision:number;subjects:string[];can_manage:boolean;can_submit:boolean;base_ready:boolean;pending_count:number;open_vote_id:string|null;calculation:BudgetCalculation|null;first_reading:BudgetCalculation|null;amendments:Amendment[];packs:Pack[]};
const tables=['budget_law_amendments','budget_law_amendment_packs','formal_documents','game_votes','game_members','game_office_assignments','game_role_consequences','institution_units','institution_assignments'] as const;
const statusLabels:Record<Amendment['status'],string>={submitted:'Внесена',voting:'На голосовании',accepted:'Принята и включена в проект',rejected:'Отклонена',withdrawn:'Отозвана автором'};
const money=(value:number)=>Number.isFinite(value)?kopecksMoney(BigInt(Math.round(value*1e8))):'—';
function sectionLabel(c:BudgetCalculation|null,key:string){const line=c?.expense_lines.find(l=>l.key===key);return line?key+'. '+line.label:key;}
function subjectLabel(key:string){return FORMAL_SUBJECTS.find(s=>s.key===key)?.label||key;}

export default function BudgetLawAmendmentsPanel({g,document,onOpenVotes,readOnly=false,onPendingChange}:{g:ReturnTypeRepublic;document:FormalDocument;onOpenVotes:(id?:string)=>void;readOnly?:boolean;onPendingChange?:(gate:BillAmendmentGate)=>void}){
 const [result,setResult]=useState<{scope:string;data:State}|null>(null),[failure,setFailure]=useState<{scope:string;message:string}|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [subject,setSubject]=useState(''),[title,setTitle]=useState(''),[rationale,setRationale]=useState(''),[competence,setCompetence]=useState(''),[from,setFrom]=useState('04'),[to,setTo]=useState('09'),[amount,setAmount]=useState('');
 const [selected,setSelected]=useState<string[]>([]),[reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
 const scope=JSON.stringify([g.game?.id,g.me?.user_id,document.id,readOnly]),active=useRef(scope),request=useRef(0),mounted=useRef(true),notify=useRef(onPendingChange);
 active.current=scope;notify.current=onPendingChange;
 const data=result?.scope===scope?result.data:null,error=failure?.scope===scope?failure.message:'';
 const phase=['amendments','reading2'].includes(data?.status_code||document.status_code),canManage=!!data?.can_manage&&!readOnly;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++}},[]);
 useEffect(()=>{setSubject('');setTitle('');setRationale('');setCompetence('');setFrom('04');setTo('09');setAmount('');setSelected([]);setReviewNotes({});setBusy(false);return()=>{request.current++}},[scope]);
 useEffect(()=>{notify.current?.({documentId:document.id,pending:!!data?.pending_count,checked:!!data&&!error});},[document.id,data,error]);
 async function load(){
  const version=++request.current,current=()=>mounted.current&&active.current===scope&&request.current===version;
  setLoading(true);
  try{
   if(!g.game||document.game_id!==g.game.id)throw new Error('Выберите проект бюджета текущей игры.');
   const r=await supabase.rpc('get_budget_law_amendments',{p_document_id:document.id});if(!current())return;
   if(r.error)throw new Error(r.error.message);
   const value=r.data as State;
   if(!value||value.document_id!==document.id||typeof value.status_code!=='string'||!Number.isInteger(value.revision)||value.revision<1||typeof value.can_manage!=='boolean'||typeof value.can_submit!=='boolean'||typeof value.base_ready!=='boolean'||!Array.isArray(value.subjects)||value.subjects.some(s=>typeof s!=='string')||!Number.isInteger(value.pending_count)||value.pending_count<0||!Array.isArray(value.amendments)||!Array.isArray(value.packs)||(value.calculation&&!Array.isArray(value.calculation.expense_lines)))throw new Error('Не удалось проверить таблицу поправок и текущую редакцию бюджета.');
   setResult({scope,data:value});setFailure(null);
   setSubject(s=>value.subjects.includes(s)?s:value.subjects[0]||'');
   setSelected(ids=>ids.filter(id=>value.amendments.some(a=>a.id===id&&a.status==='submitted'&&!a.stale)));
  }catch(e){if(current()){setResult(null);setFailure({scope,message:e instanceof Error?e.message:'Не удалось загрузить бюджетные поправки.'});}}
  finally{if(current())setLoading(false);}
 }
 useGameTableSync(g.game?.id,tables,load,'budget-law-amendments:'+document.id+':'+(g.me?.user_id||''));
 useEffect(()=>{void load()},[scope,document.updated_at]);
 async function mutate(name:string,args:Record<string,unknown>,success?:(value:unknown)=>void){
  if(readOnly||busy||!data||document.game_id!==g.game?.id)return;setBusy(true);
  try{
   const r=await supabase.rpc(name,args);if(!mounted.current||active.current!==scope)return;
   if(r.error){g.setError(r.error.message);return;}
   success?.(r.data);await load();await g.refresh();if(g.game)notifyGameDataRefresh(g.game.id);
  }catch(e){if(mounted.current&&active.current===scope)g.setError(e);}
  finally{if(mounted.current&&active.current===scope)setBusy(false);}
 }
 const cents=expenseKopecks(amount),amountM=cents===null?NaN:budgetMoney(Number(cents)/1e8);
 const fromLine=data?.calculation?.expense_lines.find(l=>l.key===from),court=['ks','vs'].includes(subject);
 const canSubmit=!!data?.can_submit&&!readOnly&&!data.open_vote_id&&title.trim().length>=3&&rationale.trim().length>=30&&from!==to&&from!=='13'&&to!=='13'&&Number.isFinite(amountM)&&amountM>0&&amountM<=1e6&&amountM<=(fromLine?.base_amount??0)&&(!court||competence.trim().length>=10);
 const options=data?.calculation?.expense_lines.filter(l=>l.key!=='13').map(l=>({value:l.key,label:l.key+'. '+l.label}))||[];
 const chosen=data?.amendments.filter(a=>selected.includes(a.id)&&a.status==='submitted'&&!a.stale)||[];
 if(document.workflow_key!=='budget')return null;
 return <section className={styles.panel} aria-label="Поправки ко второму чтению бюджета">
  <header className={styles.heading}><div><small>II чтение · Федеральный бюджет</small><h3>Таблица бюджетных поправок</h3><p>Субъекты законодательной инициативы предлагают перераспределение. Комитет по бюджету рассматривает предложения и выбирает пакет. Зарегистрированные депутаты ГД принимают или отклоняют выбранные поправки.</p></div><button type="button" className="secondary" disabled={loading||busy} onClick={()=>void load()}>Обновить поправки</button></header>
  {error&&<p role="alert" className={styles.notice}>{error}</p>}
  {!data&&!error&&<p role="status">Проверяю редакцию и полномочия…</p>}
  {data&&<>
   {data.base_ready&&data.first_reading&&<dl className={styles.totals} aria-label="Утверждённые основные характеристики бюджета">{[['Доходы',data.first_reading.revenue],['Расходы',data.first_reading.expenditure],['Дефицит',data.first_reading.deficit],['Финансирование',data.first_reading.financing]].map(([label,n])=><div key={String(label)}><dt>{String(label)} · I чтение</dt><dd>{money(Number(n))}</dd></div>)}</dl>}
   <p className={styles.notice}>После I чтения основные характеристики закреплены. Здесь меняется только распределение свободных базовых расходов. Госпрограммы, отдельные мероприятия, региональные трансферты и обслуживание долга сохраняются. Исполнение начинается после опубликования ФЗ.</p>
   <p role="status" className={styles.gate}>{data.pending_count?`Ожидают решения: ${data.pending_count}. Рассмотрите или отзовите все поправки перед II чтением бюджета в целом.`:phase?'Нерассмотренных поправок нет. После завершения работы с таблицей можно продолжить маршрут бюджета.':'Новые поправки вносятся при подготовке и проведении II чтения.'}{!data.base_ready&&' Сначала требуется утверждённый расчёт и принятое I чтение.'}</p>
   {data.open_vote_id&&<div className={styles.actions}><button type="button" className="primary" onClick={()=>onOpenVotes(data.open_vote_id!)}>Голосование по выбранным поправкам</button>{canManage&&<button type="button" className="secondary" disabled={busy} onClick={()=>void mutate('close_budget_law_amendment_vote',{p_vote_id:data.open_vote_id,p_note:'Рассмотрены выбранные бюджетные поправки ко II чтению.'})}>Завершить голосование по пакету</button>}</div>}
   {phase&&data.can_submit&&!readOnly&&<form className={styles.form} onSubmit={e=>{e.preventDefault();if(canSubmit)void mutate('submit_budget_law_amendment',{p_document_id:document.id,p_revision:data.revision,p_subject_key:subject,p_title:title.trim(),p_rationale:rationale.trim(),p_from:from,p_to:to,p_amount:amountM,p_competence_note:court?competence.trim():null},()=>{setTitle('');setRationale('');setCompetence('');setAmount('');});}}>
    <h4>Предложить перераспределение</h4><div className={styles.fields}><StyledSelect wrap label="Субъект законодательной инициативы" value={subject} onChange={setSubject} options={data.subjects.map(s=>({value:s,label:subjectLabel(s)}))} disabled={busy||!!data.open_vote_id}/><label>Название поправки<input value={title} maxLength={160} onChange={e=>setTitle(e.target.value)} disabled={busy||!!data.open_vote_id}/></label><StyledSelect wrap label="Из какого раздела перенести" value={from} onChange={setFrom} options={options} disabled={busy||!!data.open_vote_id}/><StyledSelect wrap label="В какой раздел добавить" value={to} onChange={setTo} options={options} disabled={busy||!!data.open_vote_id}/><label>Сумма перераспределения, ₽<input inputMode="decimal" value={amount} maxLength={20} onChange={e=>setAmount(e.target.value)} placeholder="1000000,00" disabled={busy||!!data.open_vote_id}/></label><p className={styles.available}>Свободные базовые расходы источника: <b>{money(fromLine?.base_amount??0)}</b>. Общая сумма бюджета сохраняется.</p></div><label>Обоснование поправки<textarea rows={3} value={rationale} maxLength={4000} onChange={e=>setRationale(e.target.value)} disabled={busy||!!data.open_vote_id}/><small>Какой результат финансируется и почему можно сократить выбранный источник. Не менее 30 знаков.</small></label>{court&&<label>Связь с вопросами ведения суда<textarea rows={2} value={competence} maxLength={4000} onChange={e=>setCompetence(e.target.value)} disabled={busy||!!data.open_vote_id}/></label>}
    <div className={styles.actions}><button type="submit" className="primary" disabled={busy||!canSubmit}>Внести бюджетную поправку</button></div>
   </form>}
   <section className={styles.tableSection}><header className={styles.heading}><h4>Предложения и решения</h4><span>{data.amendments.length} шт.</span></header>
    {!data.amendments.length?<p>Поправок пока нет. Если перераспределение не требуется, продолжите установленный маршрут бюджета.</p>:data.amendments.map(a=><article key={a.id} className={styles.amendment} data-status={a.status} data-budget-law-amendment={a.id}>
     <header><div className={styles.choice}>{canManage&&phase&&a.status==='submitted'&&<input type="checkbox" aria-label={'Включить в пакет: '+a.title} checked={selected.includes(a.id)} disabled={busy||!!data.open_vote_id||a.stale} onChange={e=>setSelected(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/>}<div><h4>{a.title}</h4><small>{g.members.find(m=>m.user_id===a.author_id)?.full_name||'Участник'} · {subjectLabel(a.subject_key)}</small></div></div><span className={styles.pill}>{statusLabels[a.status]}</span></header>
     <p>{a.rationale}</p>{a.competence_note&&<p>Вопросы ведения суда: {a.competence_note}</p>}
     <div className={styles.tableWrap} tabIndex={0} aria-label={'Суммы до и после поправки: '+a.title}><table className={styles.table}><caption>Перераспределение {money(a.amount)}</caption><thead><tr><th scope="col">Раздел расходов</th><th scope="col">До поправки</th><th scope="col">После поправки</th></tr></thead><tbody>{[a.from_section,a.to_section].map(key=>{const before=a.source_calculation.expense_lines.find(l=>l.key===key)?.amount??0,after=budgetMoneySum(before,key===a.from_section?-a.amount:a.amount);return <tr key={key}><th scope="row">{sectionLabel(a.source_calculation,key)}</th><td><del>{money(before)}</del></td><td><ins>{money(after)}</ins></td></tr>;})}</tbody></table></div>
     {a.stale&&a.status==='submitted'&&<p className={styles.notice} role="status">Исходная редакция изменилась. Автор может отозвать и повторно внести поправку; комитет — мотивированно не включить её.</p>}{a.review_note&&<p><b>Решение:</b> {a.review_note}</p>}
     <div className={styles.actions}>{a.vote_id&&<button type="button" className="secondary" onClick={()=>onOpenVotes(a.vote_id!)}>Результат голосования</button>}{a.can_withdraw&&!readOnly&&<button type="button" className="secondary" disabled={busy} onClick={()=>void mutate('withdraw_budget_law_amendment',{p_amendment_id:a.id})}>Отозвать поправку</button>}</div>
     {canManage&&phase&&a.status==='submitted'&&<div className={styles.review}><label>Причина невключения в пакет<textarea rows={2} value={reviewNotes[a.id]||''} maxLength={4000} onChange={e=>setReviewNotes(n=>({...n,[a.id]:e.target.value}))} disabled={busy||!!data.open_vote_id}/></label><button type="button" className="secondary" disabled={busy||!!data.open_vote_id||(reviewNotes[a.id]||'').trim().length<10} onClick={()=>void mutate('reject_budget_law_amendment',{p_amendment_id:a.id,p_note:reviewNotes[a.id].trim()})}>Не включать в пакет</button></div>}
    </article>)}
    {canManage&&phase&&!data.open_vote_id&&<div className={styles.actions}><span>Выбрано поправок: {chosen.length}</span><button type="button" className="primary" disabled={busy||!chosen.length} onClick={()=>void mutate('open_budget_law_amendment_vote',{p_document_id:document.id,p_amendment_ids:chosen.map(a=>a.id)},value=>{setSelected([]);onOpenVotes(String(value));})}>Голосовать по выбранным поправкам</button></div>}
   </section>
   {data.packs.length>0&&<details className={styles.history}><summary>История пакетов и голосований</summary>{data.packs.map(p=><article key={p.id}><p>{p.result_label||'Идёт голосование'}</p><button type="button" className="secondary" onClick={()=>onOpenVotes(p.vote_id)}>Открыть голосование</button></article>)}</details>}
  </>}
 </section>;
}
