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
 const [taxLevel,setTaxLevel]=useState<'federal'|'regional'|'municipal'>('federal'),[taxSearch,setTaxSearch]=useState(''),[regionCode,setRegionCode]=useState('54'),[taxKey,setTaxKey]=useState('vat'),[rate,setRate]=useState('22'),[parameters,setParameters]=useState<Record<string,string>>({});
 const scope=[g.game?.id,g.me?.user_id].join('|'),live=useRef(scope),sequence=useRef(0),parameterDirty=useRef(false);live.current=scope;
 const availableTaxes=catalog.taxes.filter(t=>t.level===taxLevel),tax=catalog.taxes.find(t=>t.key===taxKey)!,region=regions.find(r=>r.region_code===regionCode);
 const editableTax=tax.default_rate!==null,filteredTaxes=availableTaxes.filter(t=>t.label.toLocaleLowerCase('ru-RU').includes(taxSearch.trim().toLocaleLowerCase('ru-RU')));
 const taxChangeCount=availableTaxes.filter(t=>t.default_rate!==null).length;
 function chooseTaxLevel(level:'federal'|'regional'|'municipal'){setTaxLevel(level);setTaxSearch('');const first=catalog.taxes.find(t=>t.level===level);if(first)setTaxKey(first.key);}
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
 async function propose(){if(!g.game||readOnly||busy||!canPropose||!editableTax)return;const value=Number(rate);if(!rate.trim()||!Number.isFinite(value)||value<0||(tax.min_rate!==null&&value<tax.min_rate)||(tax.max_rate!==null&&value>tax.max_rate)){setError('Укажите допустимую числовую ставку.');return;}setBusy(true);try{const r=await supabase.rpc('propose_fiscal_rate',{p_game_id:g.game.id,p_region:regionCode,p_tax:taxKey,p_rate:value});if(r.error)setError(userError(r.error));else{setNotice('Инициатива зарегистрирована. Изменение ставки требует принятия соответствующего нормативного акта и его вступления в силу.');await load();}}catch(e){setError(userError(e));}finally{setBusy(false);}}
 async function apply(id:string){if(readOnly||busy||!g.teacher)return;setBusy(true);try{const r=await supabase.rpc('apply_fiscal_rate_proposal',{p_proposal:id,p_document:null});if(r.error)setError(userError(r.error));else{setNotice('Опубликованный налоговый акт учтён. Доходы пересчитаны.');await load();}}catch(e){setError(userError(e));}finally{setBusy(false);}}
 async function saveParameters(){if(!g.game||readOnly||busy||!g.teacher)return;const values=Object.fromEntries(Object.entries(parameters).map(([k,v])=>[k,Number(v)]));if(Object.entries(parameters).some(([k,v])=>!v.trim()||!Number.isFinite(values[k]))){setError('Заполните числовые параметры региона.');return;}setBusy(true);try{const r=await supabase.rpc('set_fiscal_parameters',{p_game_id:g.game.id,p_region:regionCode,p_values:values});if(r.error)setError(userError(r.error));else{parameterDirty.current=false;setNotice('Исходные параметры региона сохранены для всей группы.');await load();}}catch(e){setError(userError(e));}finally{setBusy(false);}}
 const labels:Record<string,string>={enterprises:'Предприятия, ед.',employees_per_firm:'Работники на предприятие, чел.',monthly_wage:'Средняя зарплата в месяц, ₽',profit_per_firm:'Прибыль на предприятие, млн ₽ в год',consumption_per_firm:'Оборот на предприятие, млн ₽ в год',expenditure:'Расходы региона, млн ₽',transfer_in:'Ранее полученные трансферты, млн ₽',debt:'Исходный долг региона, млн ₽',compliance:'Собираемость, от 0 до 1'};
 return <div className="budgetPage"><header className="budgetHero"><div><small>ЭТАП 13 · ФЕДЕРАЛЬНЫЙ БЮДЖЕТ</small><h1>Бюджет</h1><p>Макроэкономические параметры и пять последовательных шагов от расчёта доходов до закона. События, госпрограммы и региональные заявки связаны с общими расходами.</p></div><button type="button" className="secondary" onClick={()=>void load()} disabled={busy}><RefreshCw size={18}/> Обновить данные</button></header>
  {error&&<p role="alert" className="budgetNotice">{error}</p>}
  {!ready?<p role="status">Загружаем общие исходные данные бюджета…</p>:<><FiscalMacroPanel g={g} context={context} readOnly={readOnly} onSaved={async()=>{await load();await g.refreshBudgetPulse?.();}}/><FederalBudgetSimulator key={scope} g={g} context={context} regions={regions} rates={rates} programs={programs} readOnly={readOnly} onOpenDocument={onOpenDocument} onOpenEvents={onOpenEvents} onOpenVotes={onOpenVotes} onOpenStage={onOpenStage} onSaved={load}/>
   <section className="surface budgetMethod budgetTaxWorkspace" aria-label="Налоговые решения и региональные параметры">
     <header className="budgetTaxHeader"><div><small>НОРМАТИВНЫЕ РЕШЕНИЯ</small><h2>Налоговые инициативы</h2><p>Сначала выбирают налог и оценивают последствия. Изменение ставки учитывается только после вступления соответствующего НПА в силу.</p></div></header>
     <div className="budgetTaxSwitch" role="group" aria-label="Уровень налогового решения">
       <button type="button" aria-pressed={taxLevel==='federal'} onClick={()=>chooseTaxLevel('federal')}>Федеральные</button>
       <button type="button" aria-pressed={taxLevel==='regional'} onClick={()=>chooseTaxLevel('regional')}>Региональные</button>
       <button type="button" aria-pressed={taxLevel==='municipal'} onClick={()=>chooseTaxLevel('municipal')}>Местные</button>
     </div>
     <div className="budgetTaxProcess" aria-label="Маршрут налогового решения">
       {(taxLevel==='federal'?['Инициатива','Проект федерального закона','Три чтения Госдумы','Совет Федерации и Президент','Опубликование и вступление в силу']:taxLevel==='regional'?['Инициатива региона','Проект регионального акта','Рассмотрение уполномоченным органом','Принятие и опубликование','Вступление в силу']:['Местная инициатива','Проект муниципального акта','Рассмотрение представительным органом','Принятие и опубликование','Вступление в силу']).map((label,i)=><span key={label}><b>{i+1}</b>{label}</span>)}
     </div>
     <div className="budgetTaxCard"><div className="budgetTaxCardHead"><h3>Подготовить инициативу</h3><p>{taxLevel==='federal'?'Федеральные налоги: единые правила, проект ФЗ и федеральная процедура.':taxLevel==='regional'?'Региональные налоги: решение действует в выбранном субъекте РФ в рамках Налогового кодекса.':'Местные налоги: необходим акт соответствующего муниципального представительного органа.'}</p></div>
       <div className="budgetTaxCatalogHeading"><label htmlFor="budget-tax-search">Поиск по налогам<input id="budget-tax-search" type="search" value={taxSearch} onChange={e=>setTaxSearch(e.target.value)} placeholder="Введите название налога"/></label><span>В справочнике: {availableTaxes.length} · с единой ставкой: {taxChangeCount}</span></div>
       <div className="budgetTaxCatalog" role="group" aria-label="Полный перечень налогов выбранного уровня">{filteredTaxes.length===0?<p>Налоги по запросу не найдены.</p>:filteredTaxes.map(t=><button key={t.key} type="button" className={taxKey===t.key?'selected':''} aria-pressed={taxKey===t.key} onClick={()=>setTaxKey(t.key)}><span>{t.label}<small>НК РФ · {t.chapter}</small></span><em>{t.default_rate===null?'Особая формула / ставки':t.default_rate+' '+t.unit}</em></button>)}</div>
       <div className={styles.fields}>
       {taxLevel!=='federal'&&<StyledSelect label="Субъект РФ" value={regionCode} onChange={value=>{parameterDirty.current=false;setRegionCode(value)}} options={regions.map(r=>({value:r.region_code,label:r.name}))} wrap/>}
       {editableTax&&<label>Предлагаемая ставка, {tax.unit}<input type="number" min={tax.min_rate??undefined} max={tax.max_rate??undefined} step="any" value={rate} onChange={e=>setRate(e.target.value)} disabled={readOnly||!canPropose}/></label>}</div>
       <p className="budgetTaxEffective">{editableTax?<>Действующая ставка в сценарии: <b>{currentRate} {tax.unit}</b>.</>:<b>Единой ставки нет — применяется специальный порядок расчёта.</b>} {tax.explanation} <a href={tax.source_url} target="_blank" rel="noreferrer">Правовая справка ↗</a></p>
       {editableTax?<button type="button" className="primary" onClick={()=>void propose()} disabled={readOnly||busy||!canPropose}>Подготовить налоговую инициативу</button>:<p className="budgetTaxHint">Для этой статьи изменение единой числовой ставки через калькулятор не предусмотрено. Нужен отдельный проект изменения налогового законодательства в реестре НПА.</p>}
       <p className="budgetTaxHint">При наличии полномочий система автоматически создаёт связанный проект документа в реестре НПА. Инициатива не равнозначна принятому акту.</p>
       {availableTaxes.some(t=>t.default_rate===null)&&<details className="budgetTaxSpecial"><summary>Налоги со специальными ставками и формулами</summary><p>Для этих платежей нельзя заменить правовую формулу одним процентом. Просмотрите правила и подготовьте отдельный нормативный документ.</p>{availableTaxes.filter(t=>t.default_rate===null).map(t=><p key={t.key}><b>{t.label}:</b> {t.explanation}</p>)}</details>}
     </div>
     <div className="budgetTaxCard"><h3>Реестр налоговых инициатив</h3>{proposals.length===0?<p className="budgetTaxHint">Пока нет направленных налоговых инициатив.</p>:proposals.map(p=><article key={p.id} className="budgetPlanAllocation"><span><b>{catalog.taxes.find(t=>t.key===p.tax_key)?.label||p.tax_key}</b><small>{p.new_rate} · {p.status==='applied'?'Учтено в расчёте':p.status==='pending'?'Ожидает вступления акта в силу':p.status} · {p.region_code==='00'?'Федеральное решение':regions.find(r=>r.region_code===p.region_code)?.name||'Регион '+p.region_code}</small></span><div className="budgetTaxActions">{p.document_id&&<button type="button" className="secondary" onClick={()=>onOpenDocument(p.document_id!)}>Открыть документ</button>}{p.status==='pending'&&g.teacher&&!readOnly&&<button type="button" className="secondary" disabled={busy||!p.document_id} onClick={()=>void apply(p.id)}>Проверить и применить вступивший в силу акт</button>}</div></article>)}</div>
     {g.teacher&&<details className="budgetTaxParameters"><summary>Исходные параметры выбранного региона</summary><div className={styles.fields}><StyledSelect label="Субъект РФ" value={regionCode} onChange={value=>{parameterDirty.current=false;setRegionCode(value)}} options={regions.map(r=>({value:r.region_code,label:r.name}))} wrap/>{Object.entries(labels).map(([key,label])=><label key={key}>{label}<input type="number" value={parameters[key]??''} onChange={e=>{parameterDirty.current=true;setParameters(p=>({...p,[key]:e.target.value}));}} disabled={readOnly}/></label>)}</div><button type="button" className="secondary" onClick={()=>void saveParameters()} disabled={readOnly||busy}><Save size={18}/> Сохранить параметры региона</button></details>}
     <p className="budgetTaxHint">Региональные доходы не добавляются повторно к федеральным. Бюджетные последствия рассчитываются после применения вступившего в силу акта.</p>
     {notice&&<p role="status" className="budgetNotice">{notice}</p>}
   </section></>}
 </div>;
}
