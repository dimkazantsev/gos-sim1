'use client';
import {useEffect,useRef,useState} from 'react';
import {RefreshCw,Save} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {useGameTableSync} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';
import catalog from '@/data/taxes-2026.json';
import type {FiscalContext,FiscalRegion,FiscalRate} from './fiscalMath';
import FiscalMacroPanel from './FiscalMacroPanel';
import FederalBudgetSimulator from './FederalBudgetSimulator';
import type {SignedBudgetProgram} from './BudgetExpenses';
import StyledSelect from '../ui/StyledSelect';
import styles from './FederalBudgetSimulator.module.css';
type Proposal={id:string;tax_key:string;region_code:string;new_rate:number;status:string;document_id:string|null;author_id:string};
export default function BudgetView({g,readOnly=false,onOpenDocument,onOpenEvents,onOpenStage,onOpenVotes}:{g:ReturnTypeRepublic;readOnly?:boolean;onOpenDocument:(id:string)=>void;onOpenEvents:()=>void;onOpenVotes?:(id:string)=>void;onOpenStage?:(stageNo:number)=>void}){
 const [regions,setRegions]=useState<FiscalRegion[]>([]),[rates,setRates]=useState<FiscalRate[]>([]),[context,setContext]=useState<FiscalContext|null>(null),[programs,setPrograms]=useState<SignedBudgetProgram[]>([]),[proposals,setProposals]=useState<Proposal[]>([]);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[canPropose,setCanPropose]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [regionCode,setRegionCode]=useState('54'),[taxKey,setTaxKey]=useState('vat'),[rate,setRate]=useState('22'),[act,setAct]=useState(''),[parameters,setParameters]=useState<Record<string,string>>({});
 const scope=[g.game?.id,g.me?.user_id].join('|'),live=useRef(scope),sequence=useRef(0),parameterDirty=useRef(false);live.current=scope;
 const tax=catalog.taxes.find(t=>t.key===taxKey)!,region=regions.find(r=>r.region_code===regionCode);
 const currentRate=rates.find(r=>r.tax_key===taxKey&&r.region_code===(tax.level==='federal'?'00':regionCode))?.rate??tax.default_rate??0;
 useEffect(()=>{sequence.current++;setReady(false);setRegions([]);setRates([]);setContext(null);setPrograms([]);setProposals([]);setError('');setNotice('');parameterDirty.current=false;},[scope]);
 async function load(){
  if(!g.game)return;const requested=scope,version=++sequence.current;
  try{const [f,m,p]=await Promise.all([supabase.rpc('get_fiscal_budget',{p_game_id:g.game.id}),supabase.rpc('get_fiscal_context',{p_game_id:g.game.id}),supabase.rpc('get_signed_state_program_budget',{p_game_id:g.game.id})]);if(live.current!==requested||version!==sequence.current)return;
   const failure=f.error||m.error||p.error;if(failure){setError(userError(failure));return;}
   if(!f.data||!m.data){setError('Не удалось получить общие исходные данные бюджета. Обновите раздел.');return;}
   setRegions(f.data.regions||[]);setRates(f.data.rates||[]);setProposals(f.data.proposals||[]);setCanPropose(!!f.data.can_propose);setContext(m.data);setPrograms(p.data||[]);setReady(true);setError('');
  }catch(e){if(live.current===requested&&version===sequence.current)setError(userError(e));}
 }
 useGameTableSync(g.game?.id,['game_fiscal_policy','game_fiscal_regions','game_fiscal_rates','fiscal_rate_proposals','fiscal_change_ledger','state_metrics','state_programs','state_program_budget_commitments'],load,scope);
 useEffect(()=>{setRate(String(currentRate))},[currentRate,taxKey,regionCode,scope]);
 useEffect(()=>{if(!region||parameterDirty.current)return;setParameters(Object.fromEntries(['enterprises','employees_per_firm','monthly_wage','profit_per_firm','consumption_per_firm','expenditure','transfer_in','debt','compliance'].map(k=>[k,String(region[k as keyof FiscalRegion])])));},[region]);
 async function propose(){if(!g.game||readOnly||busy||!canPropose)return;const value=Number(rate);if(!rate.trim()||!Number.isFinite(value)||value<0){setError('Укажите допустимую числовую ставку.');return;}setBusy(true);try{const r=await supabase.rpc('propose_fiscal_rate',{p_game_id:g.game.id,p_region:regionCode,p_tax:taxKey,p_rate:value});if(r.error)setError(userError(r.error));else{setNotice('Предложение сохранено. Ставка изменится после опубликования и проверки отдельного налогового акта.');await load();}}catch(e){setError(userError(e));}finally{setBusy(false);}}
 async function apply(id:string){if(readOnly||busy||!g.teacher)return;setBusy(true);try{const r=await supabase.rpc('apply_fiscal_rate_proposal',{p_proposal:id,p_document:act||null});if(r.error)setError(userError(r.error));else{setNotice('Опубликованный налоговый акт учтён. Доходы пересчитаны.');await load();}}catch(e){setError(userError(e));}finally{setBusy(false);}}
 async function saveParameters(){if(!g.game||readOnly||busy||!g.teacher)return;const values=Object.fromEntries(Object.entries(parameters).map(([k,v])=>[k,Number(v)]));if(Object.entries(parameters).some(([k,v])=>!v.trim()||!Number.isFinite(values[k]))){setError('Заполните числовые параметры региона.');return;}setBusy(true);try{const r=await supabase.rpc('set_fiscal_parameters',{p_game_id:g.game.id,p_region:regionCode,p_values:values});if(r.error)setError(userError(r.error));else{parameterDirty.current=false;setNotice('Исходные параметры региона сохранены для всей группы.');await load();}}catch(e){setError(userError(e));}finally{setBusy(false);}}
 const labels:Record<string,string>={enterprises:'Предприятия, ед.',employees_per_firm:'Работники на предприятие, чел.',monthly_wage:'Средняя зарплата в месяц, ₽',profit_per_firm:'Прибыль на предприятие, млн ₽ в год',consumption_per_firm:'Оборот на предприятие, млн ₽ в год',expenditure:'Расходы региона, млн ₽',transfer_in:'Ранее полученные трансферты, млн ₽',debt:'Исходный долг региона, млн ₽',compliance:'Собираемость, от 0 до 1'};
 return <div className="budgetPage"><header className="budgetHero"><div><small>ЭТАП 13 · ФЕДЕРАЛЬНЫЙ БЮДЖЕТ</small><h1>Бюджет</h1><p>Пять последовательных шагов от расчёта доходов до закона. События, госпрограммы и региональные заявки связаны с общими расходами.</p></div><button type="button" className="secondary" onClick={()=>void load()} disabled={busy}><RefreshCw size={18}/> Обновить данные</button></header>
  {error&&<p role="alert" className="budgetNotice">{error}</p>}
  {!ready?<p role="status">Загружаем общие исходные данные бюджета…</p>:<><FederalBudgetSimulator key={scope} g={g} context={context} regions={regions} rates={rates} programs={programs} readOnly={readOnly} onOpenDocument={onOpenDocument} onOpenEvents={onOpenEvents} onOpenVotes={onOpenVotes} onOpenStage={onOpenStage} onSaved={load}/>
   <details className="surface budgetMethod"><summary>Параметры сценария и налоговые решения</summary><p>Основной расчёт находится в пяти шагах выше. Здесь — настройки макроэкономики, предложения по отдельным налоговым НПА и исходные данные для преподавателя.</p><FiscalMacroPanel g={g} context={context} readOnly={readOnly} onSaved={load}/>
    <h3>Налоговая ставка меняется отдельным актом</h3><div className={styles.fields}><StyledSelect label="Налог" value={taxKey} onChange={setTaxKey} options={catalog.taxes.filter(t=>t.default_rate!==null).map(t=>({value:t.key,label:t.label}))} wrap/><StyledSelect label="Регион налогового решения" value={regionCode} onChange={value=>{parameterDirty.current=false;setRegionCode(value)}} options={regions.map(r=>({value:r.region_code,label:r.name}))} wrap/><label>Предлагаемая ставка<input type="number" value={rate} onChange={e=>setRate(e.target.value)} disabled={readOnly||!canPropose}/></label></div><p>Действующая ставка в игре: {currentRate}{taxKey==='transport'?' ₽ / л. с.':'%'}. {tax.explanation}</p><button type="button" className="secondary" onClick={()=>void propose()} disabled={readOnly||busy||!canPropose}>Подготовить предложение по ставке</button>
    {proposals.length>0&&<><label>Идентификатор опубликованного налогового НПА<input value={act} onChange={e=>setAct(e.target.value)} disabled={readOnly||!g.teacher}/></label>{proposals.map(p=><article key={p.id} className="budgetPlanAllocation"><span><b>{catalog.taxes.find(t=>t.key===p.tax_key)?.label||p.tax_key}</b><small>{p.new_rate} · {p.status==='applied'?'Применено':p.status==='pending'?'Ожидает налогового акта':p.status} · Регион {p.region_code}</small></span>{p.document_id&&<button type="button" className="secondary" onClick={()=>onOpenDocument(p.document_id!)}>Открыть акт</button>}{p.status==='pending'&&g.teacher&&!readOnly&&<button type="button" className="secondary" disabled={busy||!act.trim()} onClick={()=>void apply(p.id)}>Учесть опубликованный акт</button>}</article>)}</>}
    {g.teacher&&<details><summary>Исходные параметры выбранного региона</summary><div className={styles.fields}>{Object.entries(labels).map(([key,label])=><label key={key}>{label}<input type="number" value={parameters[key]??''} onChange={e=>{parameterDirty.current=true;setParameters(p=>({...p,[key]:e.target.value}));}} disabled={readOnly}/></label>)}</div><button type="button" className="secondary" onClick={()=>void saveParameters()} disabled={readOnly||busy}><Save size={18}/> Сохранить параметры региона</button></details>}
    <p>Федеральный план и региональные сценарии используют разные исходные данные. Региональные доходы не складываются с федеральными повторно. Источники и допущения сохранены в расчёте и проекте ФЗ.</p>{notice&&<p role="status" className="budgetNotice">{notice}</p>}
   </details></>}
 </div>;
}
