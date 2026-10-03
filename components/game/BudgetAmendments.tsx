'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowRightLeft,Check,FileText,RefreshCw,Send,Vote,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import StyledSelect from '../ui/StyledSelect';
import type {ReturnTypeRepublic} from './viewTypes';
import type {FiscalContext,FiscalRate,FiscalRegion} from './fiscalMath';
import {billions,calculateFederalBudget,type BudgetCalculation,type BudgetDraft,type BudgetTransfer,type SimulatorState} from './federalBudgetMath';
import {amendmentSections,amendmentStatus,previewBudgetAmendment,type BudgetAmendment,type BudgetPlanSummary} from './budgetAmendmentMath';
import styles from './BudgetAmendments.module.css';

type Board={amendments:BudgetAmendment[];party_ids:string[];can_open:boolean;can_apply:boolean;can_submit_neutral:boolean};
type Props={g:ReturnTypeRepublic;plans:BudgetPlanSummary[];selectedId:string;state:SimulatorState;context:FiscalContext|null;regions:FiscalRegion[];rates:FiscalRate[];requests:BudgetTransfer[];readOnly:boolean;onApplied:(result:{id:string;revision:number;draft:BudgetDraft})=>Promise<void>;onOpenVotes?:(id:string)=>void;onOpenDocument:(id:string)=>void;onOpenCalculator:()=>void};
const sectionName=(key:string)=>amendmentSections.find(l=>l.key===key)?.label||key;
function Comparison({base,next,sections}:{base:BudgetCalculation;next:BudgetCalculation;sections:string[]}){
 const lines=[...sections.map(key=>({key,label:sectionName(key),before:base.expense_lines.find(l=>l.key===key)?.amount??0,after:next.expense_lines.find(l=>l.key===key)?.amount??0})),{key:'total',label:'Всего расходов',before:base.expenditure,after:next.expenditure},{key:'income',label:'Доходы',before:base.revenue,after:next.revenue},{key:'deficit',label:'Дефицит',before:base.deficit,after:next.deficit},{key:'funding',label:'Источники финансирования',before:base.financing,after:next.financing}];
 return <div className={styles.comparison} role="table" aria-label="Сравнение бюджетной поправки"><div className={styles.columns} role="row"><span role="columnheader">Показатель</span><span role="columnheader">До поправки</span><span role="columnheader">После поправки</span><span role="columnheader">Изменение</span></div>{lines.map(l=>{const delta=l.after-l.before;return <div className={styles.row} role="row" key={l.key} data-amendment-row={l.key}><b role="rowheader">{l.label}</b><span role="cell"><small>До поправки</small>{billions(l.before)}</span><span role="cell"><small>После поправки</small>{billions(l.after)}</span><strong role="cell" data-delta={delta}><small>Изменение</small>{delta===0?'Без изменения':(delta>0?'+':'')+billions(delta)}</strong></div>;})}</div>;
}
export default function BudgetAmendments({g,plans,selectedId,state,context,regions,rates,requests,readOnly,onApplied,onOpenVotes,onOpenDocument,onOpenCalculator}:Props){
 const [board,setBoard]=useState<Board|null>(null),[planId,setPlanId]=useState(''),[partyId,setPartyId]=useState(''),[from,setFrom]=useState('04'),[to,setTo]=useState('09'),[amount,setAmount]=useState('10'),[title,setTitle]=useState('Поправка к расходам федерального бюджета'),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const scope=useRef('');scope.current=(g.game?.id||'')+':'+(g.me?.user_id||'');
 const editable=plans.filter(p=>p.status==='draft'),basePlan=editable.find(p=>p.id===planId),partyIds=board?.party_ids||[];
 const maySubmit=!readOnly&&!!board&&(board.can_submit_neutral||partyIds.length>0);
 const base=useMemo(()=>basePlan?calculateFederalBudget(basePlan.draft,state,context,regions,rates,requests):null,[basePlan,state,context,regions,rates,requests]);
 const value=amount.trim()?Number(amount)*1000:NaN;
 const preview=useMemo(()=>basePlan&&base?previewBudgetAmendment(basePlan.draft,base,requests,from,to,value):null,[basePlan,base,requests,from,to,value]);
 async function load(){
  if(!g.game)return;const requestedScope=scope.current;
  try{const r=await supabase.rpc('get_budget_amendments',{p_game_id:g.game.id});if(requestedScope!==scope.current)return;if(r.error)setError(userError(r.error));else{setBoard(r.data as Board);setError('');}}
  catch(e){if(requestedScope===scope.current)setError(userError(e));}
 }
 useEffect(()=>{setBoard(null);setBusy(false);setNotice('');setPlanId('');setPartyId('');setReason('');void load();if(!g.game)return;const timer=setInterval(()=>void load(),15000);let pending:ReturnType<typeof setTimeout>;const update=()=>{clearTimeout(pending);pending=setTimeout(()=>void load(),200);};let channel=supabase.channel('budget-amendments:'+g.game.id);for(const table of ['budget_faction_amendments','budget_simulator_plans','game_votes','game_fiscal_policy','game_fiscal_regions','state_metrics','budget_simulator_state'])channel=channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'game_id=eq.'+g.game.id},update);channel.subscribe();return()=>{clearInterval(timer);clearTimeout(pending);void supabase.removeChannel(channel);};},[g.game?.id,g.me?.user_id]);
 useEffect(()=>{if(!editable.some(p=>p.id===planId))setPlanId(editable.find(p=>p.id===selectedId)?.id||editable[0]?.id||'');},[plans,selectedId,planId]);
 useEffect(()=>{if(!board?.can_submit_neutral&&!partyIds.includes(partyId))setPartyId(partyIds[0]||'');},[board,partyId]);
 async function action(rpc:string,args:Record<string,unknown>,success:string){
  if(busy||readOnly)return null;const requestedScope=scope.current;setBusy(true);setError('');setNotice('');
  try{const r=await supabase.rpc(rpc,args);if(requestedScope!==scope.current)return null;if(r.error){setError(userError(r.error));return null;}setNotice(success);await load();return {data:r.data};}
  catch(e){if(requestedScope===scope.current)setError(userError(e));return null;}
  finally{if(requestedScope===scope.current)setBusy(false);}
 }
 async function submit(){
  if(!maySubmit||!basePlan||!preview||preview.error||reason.trim().length<30||title.trim().length<3)return;
  const r=await action('submit_budget_amendment',{p_plan_id:basePlan.id,p_revision:basePlan.revision,p_party_id:partyId||null,p_title:title.trim(),p_reason:reason.trim(),p_from:from,p_to:to,p_amount:Math.round(value*100)/100},'Поправка направлена. Расчет группы и действующий бюджет пока сохраняют прежние значения.');
  if(r)setReason('');
 }
 async function open(a:BudgetAmendment){const r=await action('open_budget_amendment_vote',{p_amendment_id:a.id},'Предварительное голосование открыто в разделе «Голосования».');if(r){await g.refresh();onOpenVotes?.(String(r.data));}}
 async function apply(a:BudgetAmendment){const r=await action('apply_budget_amendment',{p_amendment_id:a.id},'Одобренная поправка включена в общий черновик. Теперь из него можно подготовить проект НПА.');if(r)await onApplied(r.data);}
 return <section className={styles.amendments} aria-label="Поправки фракций к бюджету">
  <header className={styles.heading}><div><small>ПОДГОТОВКА ОБЩЕГО ПРОЕКТА</small><h3>Поправки фракций</h3><p>Предложите, какие расходы увеличить и какие сократить на ту же сумму. Сравните результат, обсудите его и передайте на предварительное голосование.</p></div><button className="secondary" type="button" onClick={()=>void load()} disabled={busy} aria-label="Обновить бюджетные поправки"><RefreshCw size={18}/></button></header>
  <ol className={styles.steps}><li>Расчет фракции</li><li>Предварительное голосование</li><li>Включение бюджетной командой</li><li>Проект закона в реестре НПА</li></ol>
  {!board&&!error&&<p role="status">Загружаем предложения участников…</p>}
  {editable.length===0?<div className={styles.empty}><ArrowRightLeft size={26}/><h4>Сначала нужен общий черновик</h4><p>Преподаватель или представитель исполнительной власти сохраняет расчет. К нему фракции смогут направлять поправки. Если закон уже внесен, подготовьте новый расчет изменений бюджета.</p><button type="button" className="secondary" onClick={onOpenCalculator}>Открыть калькулятор расходов</button></div>:<>
   <div className={styles.base}><StyledSelect label="Общий расчет для поправки" value={planId} onChange={setPlanId} options={editable.map(p=>({value:p.id,label:p.title+' · редакция '+p.revision}))}/><p>Используются сохраненные значения этого расчета. Личные несохраненные изменения в соседних вкладках в предложение не включаются.</p></div>
   {maySubmit&&basePlan&&base&&<details className={styles.form} open><summary><ArrowRightLeft size={19}/> Подготовить поправку</summary><div className={styles.fields}>
    <StyledSelect label="От имени" value={partyId} onChange={setPartyId} options={[...(board?.can_submit_neutral?[{value:'',label:'Преподаватель'}]:[]),...g.parties.filter(p=>partyIds.includes(p.id)).map(p=>({value:p.id,label:p.name}))]}/>
    <label>Название поправки<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={160}/></label>
    <StyledSelect label="Сократить расходы" value={from} onChange={setFrom} options={amendmentSections.map(l=>({value:l.key,label:l.key+' · '+l.label}))}/>
    <StyledSelect label="Увеличить расходы" value={to} onChange={setTo} options={amendmentSections.map(l=>({value:l.key,label:l.key+' · '+l.label}))}/>
    <label>Сумма перераспределения, млрд ₽<input type="number" min=".00001" max="1000" step=".01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <div className={styles.amount}><small>Перенос между разделами</small><b>{Number.isFinite(value)&&value>0?billions(value):'Укажите сумму'}</b><span>Общий объем расходов сохраняется</span></div>
   </div>
   {preview?.error?<p className={styles.warning} role="status">{preview.error}</p>:preview&&<Comparison base={base} next={preview.calculation} sections={[from,to]}/>}
   <label>Обоснование поправки<textarea rows={4} maxLength={6000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Почему выбран этот приоритет, что получат граждане и какие последствия возникнут для сокращаемого направления?"/></label>
   <div className={styles.actions}><button type="button" className="primary" onClick={()=>void submit()} disabled={busy||!preview||!!preview.error||reason.trim().length<30||title.trim().length<3}><Send size={18}/> Направить поправку</button><span>Обоснование — от 30 символов. Сервер проверит суммы и редакцию.</span></div>
   </details>}
   {board&&!maySubmit&&<p className={styles.access}>{readOnly?'Доступен просмотр финансовых расчетов и предложений.':'Поправки могут направлять студенты своей зарегистрированной фракции и преподаватель. Расчет расходов доступен всем участникам.'}</p>}
  </>}
  {error&&<p className={styles.error} role="alert">{error}</p>}{notice&&<p className={styles.notice} role="status">{notice}</p>}
  <div className={styles.listHeading}><h4>Предложения участников</h4><span>{board?.amendments.length||0} шт.</span></div>
  {board&&board.amendments.length===0&&<p className={styles.access}>Предложений пока нет. Подготовьте обоснованное перераспределение в форме выше.</p>}
  <div className={styles.list}>{board?.amendments.map(a=><article key={a.id} data-budget-amendment={a.id}><header><div><small>{a.party_name} · {a.author_name}</small><h4>{a.title}</h4><span>{a.plan_title} · редакция {a.base_revision}</span></div><b className={styles.badge}>{amendmentStatus(a)}</b></header><p>{sectionName(a.from_section)} → {sectionName(a.to_section)} · <b>{billions(a.amount)}</b></p><details><summary>Обоснование и финансовое сравнение</summary><p className={styles.reason}>{a.reason}</p><Comparison base={a.base_calculation} next={a.proposal_calculation} sections={[a.from_section,a.to_section]}/><p className={styles.caption}>Суммы зафиксированы при подаче предложения. {a.status==='applied'?'Включено в редакцию '+a.applied_revision+'.':a.stale?'После изменения расчета предложение нужно подготовить заново.':'Перед голосованием и включением система проверяет актуальность финансовых условий.'}</p></details>
   {a.vote_status==='closed'&&<p className={styles.results}>За: {a.vote_yes??0} мандатов · Против: {a.vote_no??0} · Воздержались: {a.vote_abstain??0} · Общий состав: {a.vote_eligible??450} мандатов</p>}
   <footer><time dateTime={a.created_at}>{new Date(a.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</time><div className={styles.actions}>
    {a.vote_id&&onOpenVotes&&<button type="button" className="secondary" onClick={()=>onOpenVotes(a.vote_id!)}><Vote size={18}/> {a.vote_status==='open'?'Перейти к голосованию':'Результат голосования'}</button>}
    {!readOnly&&board.can_open&&a.status==='submitted'&&!a.stale&&!a.vote_id&&<button type="button" className="primary" disabled={busy} onClick={()=>void open(a)}><Vote size={18}/> Открыть голосование</button>}
    {!readOnly&&board.can_apply&&a.status==='submitted'&&!a.stale&&a.vote_result==='passed'&&<button type="button" className="primary" disabled={busy} onClick={()=>void apply(a)}><Check size={18}/> Включить в общий расчет</button>}
    {!readOnly&&a.status==='submitted'&&!a.vote_id&&(g.teacher||a.created_by===g.me?.user_id)&&<button type="button" className="secondary" disabled={busy} onClick={()=>void action('withdraw_budget_amendment',{p_amendment_id:a.id},'Предложение отозвано. История сохранена.')}><X size={18}/> Отозвать</button>}
    {a.status==='applied'&&a.document_id&&<button type="button" className="secondary" onClick={()=>onOpenDocument(a.document_id!)}><FileText size={18}/> Проект НПА</button>}
   </div></footer></article>)}</div>
  <details className={styles.procedure}><summary>Как поправка связана с принятием бюджета</summary><p>Предварительное голосование открывает преподаватель. Используется состав Государственной Думы в 450 мандатов, учет распределения мандатов и GV из действующей системы голосований. Для решения нужно не менее 226 голосов «за» и кворум.</p><p>Одобрение сохраняет результат рассмотрения. Исполнительная власть или преподаватель включает предложение в общий черновик. Затем формируется законопроект с расчетными приложениями; действующий бюджет изменяется только после прохождения процедуры и опубликования НПА.</p><p>Эта форма относится к подготовке проекта. Во втором чтении закона распределение расходов рассматривается в пределах общего объема, утвержденного в первом чтении. Изменение налоговых ставок оформляется отдельным НПА.</p><a href="https://www.consultant.ru/document/cons_doc_LAW_19702/03ae3796fecb1fa46381ca01796bd730d254b3ed/" target="_blank" rel="noreferrer">БК РФ · статья 205</a></details>
 </section>;
}
