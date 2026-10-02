'use client';
import {scenarioUnit,scenarioMoney} from '@/lib/formatQuantity';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';

type Scenario={id:string;game_id:string;title:string;budget_year:number;source_note:string|null;gdp:number;oil_price:number|null;cutoff_price:number|null;key_rate:number|null;fx_change_pct:number|null;fx_intervention:number|null;revenue:number;expenditure:number;debt_start:number;financing:number;balance:number;deficit_pct_gdp:number|null;debt_end:number;debt_pct_gdp:number|null;deficit_limit_pct:number|null;debt_limit_pct:number|null;status:'draft'|'final';formal_document_id:string|null;created_by:string;updated_at:string};
type ProgramAllocation={id:string;scenario_id:string;program_id:string;amount:number;note:string|null;created_at:string;updated_at:string};
type AdoptedProgram={id:string;title:string;responsible_ministry:string;total_budget:number;status:string};
type Stream={id:string;scenario_id:string;workstream:'central_bank'|'macro'|'revenue'|'expenditure'|'financing_debt';summary:string;submitted_by:string;updated_at:string};

const streams=[
 ['central_bank','Банк России','Ключевая ставка, валютный курс и интервенции'],
 ['macro','Макропрогноз','ВВП, инфляционные/ценовые предпосылки, нефть и сценарные условия'],
 ['revenue','Доходы','Налоговые и неналоговые доходы, нефтегазовые и иные поступления'],
 ['expenditure','Расходы','Приоритеты расходов, программы, трансферты и обязательства'],
 ['financing_debt','Финансирование и долг','Источники покрытия дефицита, заимствования и долг']
] as const;

export default function BudgetLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,formalDocuments,setError}=g;
 const [scenarios,setScenarios]=useState<Scenario[]>([]);
 const [work,setWork]=useState<Stream[]>([]);
 const [allocations,setAllocations]=useState<ProgramAllocation[]>([]);
 const [adoptedPrograms,setAdoptedPrograms]=useState<AdoptedProgram[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [title,setTitle]=useState('Базовый сценарий федерального бюджета');
 const [year,setYear]=useState(new Date().getFullYear()+1);
 const [source,setSource]=useState('');
 const [gdp,setGdp]=useState('');
 const [oil,setOil]=useState('');
 const [cutoff,setCutoff]=useState('');
 const [rate,setRate]=useState('');
 const [fx,setFx]=useState('');
 const [intervention,setIntervention]=useState('');
 const [revenue,setRevenue]=useState('');
 const [expenditure,setExpenditure]=useState('');
 const [debt,setDebt]=useState('');
 const [financing,setFinancing]=useState('');
 const [deficitLimit,setDeficitLimit]=useState('');
 const [debtLimit,setDebtLimit]=useState('');
 const [streamDraft,setStreamDraft]=useState<Record<string,string>>({});
 const [allocationProgram,setAllocationProgram]=useState('');
 const [allocationAmount,setAllocationAmount]=useState('');
 const [allocationNote,setAllocationNote]=useState('');
 const [busy,setBusy]=useState(false);
 const role=(me?.role_title||'').toLowerCase();
 const canFinalize=teacher||(role.includes('председател')&&role.includes('правительств'))||(role.includes('министр')&&role.includes('финанс'));

 async function load(){
  if(!game)return;
  const [s,w,a,p]=await Promise.all([
   supabase.from('budget_scenarios').select('*').eq('game_id',game.id).order('created_at',{ascending:true}),
   supabase.from('budget_workstreams').select('*').eq('game_id',game.id),
   supabase.from('budget_program_allocations').select('*').eq('game_id',game.id),
   supabase.from('state_programs').select('id,title,responsible_ministry,total_budget,status').eq('game_id',game.id).eq('status','adopted').order('title')
  ]);
  if(!s.error){const rows=(s.data||[]) as Scenario[];setScenarios(rows);if(!selectedId&&rows[0])setSelectedId(rows[0].id)}
  if(!w.error){const rows=(w.data||[]) as Stream[];setWork(rows);setStreamDraft(v=>({...v,...Object.fromEntries(rows.map(x=>[x.scenario_id+'-'+x.workstream,x.summary]))}))}
  if(!a.error)setAllocations((a.data||[]) as ProgramAllocation[]);
  if(!p.error)setAdoptedPrograms((p.data||[]) as AdoptedProgram[]);
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('budget-lab:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'budget_scenarios',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'budget_workstreams',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'budget_program_allocations',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'state_programs',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 const selected=scenarios.find(s=>s.id===selectedId);
 useEffect(()=>{
  if(!selected)return;
  setTitle(selected.title);setYear(selected.budget_year);setSource(selected.source_note||'');setGdp(String(selected.gdp));setOil(String(selected.oil_price??''));setCutoff(String(selected.cutoff_price??''));setRate(String(selected.key_rate??''));setFx(String(selected.fx_change_pct??''));setIntervention(String(selected.fx_intervention??''));setRevenue(String(selected.revenue));setExpenditure(String(selected.expenditure));setDebt(String(selected.debt_start));setFinancing(String(selected.financing));setDeficitLimit(String(selected.deficit_limit_pct??''));setDebtLimit(String(selected.debt_limit_pct??''));
 },[selected?.id,selected?.updated_at]);

 if(!game||!me)return null;
 const activeGame=game;
 const num=(x:string)=>x.trim()===''?null:Number(x);
 const n=(x:string)=>Number(x)||0;
 const previewBalance=n(revenue)-n(expenditure);
 const previewDeficit=n(gdp)>0?Math.max(0,-previewBalance)/n(gdp)*100:null;
 const previewDebt=Math.max(0,n(debt)+Math.max(0,-previewBalance)-n(financing));
 const previewDebtPct=n(gdp)>0?previewDebt/n(gdp)*100:null;
 const myWork=selected?work.filter(x=>x.scenario_id===selected.id):[];
 const myAllocations=selected?allocations.filter(x=>x.scenario_id===selected.id):[];
 const allocatedTotal=myAllocations.reduce((sum,x)=>sum+Number(x.amount||0),0);
 const allocationCoverage=n(expenditure)>0?allocatedTotal/n(expenditure)*100:0;
 const budgetDocument=selected?.formal_document_id?formalDocuments.find(d=>d.id===selected.formal_document_id):undefined;
 const name=(id:string)=>members.find(m=>m.user_id===id)?.full_name||'Участник';
 const limitFlag=(value:number|null,limit:string)=>value!=null&&limit.trim()!==''&&value>Number(limit);

 async function save(newScenario=false){
  setBusy(true);
  const r=await supabase.rpc('save_budget_scenario',{
   p_game_id:activeGame.id,p_scenario_id:newScenario?null:(selected?.id||null),p_title:title,p_budget_year:year,p_source_note:source.trim()||null,
   p_gdp:n(gdp),p_oil_price:num(oil),p_cutoff_price:num(cutoff),p_key_rate:num(rate),p_fx_change_pct:num(fx),p_fx_intervention:num(intervention),
   p_revenue:n(revenue),p_expenditure:n(expenditure),p_debt_start:n(debt),p_financing:n(financing),p_deficit_limit_pct:num(deficitLimit),p_debt_limit_pct:num(debtLimit)
  });
  if(r.error)setError(userError(r.error));else{if(newScenario&&r.data)setSelectedId(String(r.data));await load()}setBusy(false);
 }
 async function submitStream(key:string){
  if(!selected)return;const text=(streamDraft[selected.id+'-'+key]||'').trim();if(text.length<10)return;
  setBusy(true);const r=await supabase.rpc('submit_budget_workstream',{p_scenario_id:selected.id,p_workstream:key,p_summary:text,p_assumptions:{}});
  if(r.error)setError(userError(r.error));else await load();setBusy(false);
 }
 async function finalize(){if(!selected)return;setBusy(true);const r=await supabase.rpc('finalize_budget_scenario',{p_scenario_id:selected.id});if(r.error)setError(userError(r.error));else await load();setBusy(false)}
 async function setAllocation(){
  if(!selected||!allocationProgram||Number(allocationAmount)<0)return;
  setBusy(true);const r=await supabase.rpc('set_budget_program_allocation',{p_scenario_id:selected.id,p_program_id:allocationProgram,p_amount:Number(allocationAmount)||0,p_note:allocationNote.trim()||null});
  if(r.error)setError(userError(r.error));else{setAllocationProgram('');setAllocationAmount('');setAllocationNote('');await load()}setBusy(false);
 }
 async function deleteAllocation(id:string){setBusy(true);const r=await supabase.rpc('delete_budget_program_allocation',{p_allocation_id:id});if(r.error)setError(userError(r.error));else await load();setBusy(false)}
 async function createBudgetDocument(){if(!selected)return;setBusy(true);const r=await supabase.rpc('create_budget_document_from_scenario',{p_scenario_id:selected.id});if(r.error)setError(userError(r.error));else await load();setBusy(false)}

 return <section className="budgetLab">
  <header className="budgetLabHead"><div><small>МАКРОЭКОНОМИКА И ПУБЛИЧНЫЕ ФИНАНСЫ · ЭТАП 13</small><h2>Бюджетная лаборатория</h2><p>Пять аналитических потоков собираются в один проверяемый сценарий. Система автоматически считает баланс, дефицит к ВВП и долг, но не подменяет преподавателя: параметры бюджетного правила и сценарные ограничения вводятся с источником.</p></div><div className="budgetEquation"><b>Баланс</b><span>доходы − расходы</span><b>Дефицит, % ВВП</b><span>max(0, −баланс) / ВВП × 100</span><b>Долг</b><span>начальный долг + дефицит − финансирование</span></div></header>

  <div className="budgetScenarioTabs"><div>{scenarios.map(s=><button key={s.id} className={s.id===selectedId?'active':''} onClick={()=>setSelectedId(s.id)}><b>{s.budget_year}</b><span>{s.title}</span><em>{s.status==='final'?'зафиксирован':'черновик'}</em></button>)}</div><button onClick={()=>{setSelectedId('');setTitle('Базовый сценарий федерального бюджета');setYear(new Date().getFullYear()+1);setSource('');setGdp('');setRevenue('');setExpenditure('');setDebt('');setFinancing('')}}>＋ Новый сценарий</button></div>

  {(!selected||selected.status==='draft')&&<div className="budgetInputs">
   <label>Год<input type="number" value={year} onChange={e=>setYear(Number(e.target.value))}/></label>
   <label className="budgetTitle">Название сценария<input value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <label>ВВП, {scenarioUnit(source)}<input type="number" value={gdp} onChange={e=>setGdp(e.target.value)}/></label>
   <label>Цена нефти, $/баррель<input type="number" value={oil} onChange={e=>setOil(e.target.value)}/></label>
   <label>Цена отсечения, $/баррель<input type="number" value={cutoff} onChange={e=>setCutoff(e.target.value)}/></label>
   <label>Ключевая ставка, %<input type="number" value={rate} onChange={e=>setRate(e.target.value)}/></label>
   <label>Изменение курса, %<input type="number" value={fx} onChange={e=>setFx(e.target.value)}/></label>
   <label>Валютные интервенции, {scenarioUnit(source)}<input type="number" value={intervention} onChange={e=>setIntervention(e.target.value)}/></label>
   <label>Доходы, {scenarioUnit(source)}<input type="number" value={revenue} onChange={e=>setRevenue(e.target.value)}/></label>
   <label>Расходы, {scenarioUnit(source)}<input type="number" value={expenditure} onChange={e=>setExpenditure(e.target.value)}/></label>
   <label>Долг на начало, {scenarioUnit(source)}<input type="number" value={debt} onChange={e=>setDebt(e.target.value)}/></label>
   <label>Иное финансирование, {scenarioUnit(source)}<input type="number" value={financing} onChange={e=>setFinancing(e.target.value)}/></label>
   <label>Лимит дефицита, % ВВП<input type="number" value={deficitLimit} onChange={e=>setDeficitLimit(e.target.value)}/></label>
   <label>Лимит долга, % ВВП<input type="number" value={debtLimit} onChange={e=>setDebtLimit(e.target.value)}/></label>
   <label className="budgetSource">Источник и допущения<textarea rows={3} value={source} onChange={e=>setSource(e.target.value)} placeholder="Дата данных, источник, единицы измерения, сценарные допущения. Не смешивайте реальные показатели и учебные числа без пометки."/></label>
   <button className="primary" disabled={busy} onClick={()=>void save(!selected)}>Сохранить и пересчитать</button>
  </div>}

  <div className="budgetDashboard">
   <article><small>ДОХОДЫ</small><strong>{scenarioMoney(n(revenue),source)}</strong></article>
   <article><small>РАСХОДЫ</small><strong>{scenarioMoney(n(expenditure),source)}</strong></article>
   <article className={previewBalance<0?'bad':'good'}><small>БАЛАНС</small><strong>{scenarioMoney(previewBalance,source)}</strong><span>{previewBalance<0?'дефицит':'профицит / баланс'}</span></article>
   <article className={limitFlag(previewDeficit,deficitLimit)?'bad':''}><small>ДЕФИЦИТ / ВВП</small><strong>{previewDeficit==null?'—':previewDeficit.toFixed(2)+'%'}</strong>{deficitLimit&&<span>лимит {deficitLimit}%</span>}</article>
   <article><small>ДОЛГ НА КОНЕЦ</small><strong>{scenarioMoney(previewDebt,source)}</strong></article>
   <article className={limitFlag(previewDebtPct,debtLimit)?'bad':''}><small>ДОЛГ / ВВП</small><strong>{previewDebtPct==null?'—':previewDebtPct.toFixed(2)+'%'}</strong>{debtLimit&&<span>лимит {debtLimit}%</span>}</article>
  </div>

  {selected&&<section className="budgetPrograms">
   <div className="budgetProgramsHead"><div><small>ПРОГРАММНЫЕ РАСХОДЫ</small><h3>Принятые ГП → федеральный бюджет</h3><p>Здесь бюджетный сценарий получает содержательную структуру: принятые Правительством государственные программы превращаются в конкретные расходные обязательства.</p></div><div><strong>{scenarioMoney(allocatedTotal,source)}</strong><span>{allocationCoverage.toFixed(1)}% расходов распределено по ГП</span></div></div>
   <div className="budgetAllocationList">{myAllocations.length===0?<div className="emptyState">Принятые государственные программы пока не связаны с этим бюджетом.</div>:myAllocations.map(a=>{const p=adoptedPrograms.find(x=>x.id===a.program_id);return <article key={a.id}><div><b>{p?.title||'Государственная программа'}</b><small>{p?.responsible_ministry||'Ответственный исполнитель'}</small>{a.note&&<p>{a.note}</p>}</div><strong>{scenarioMoney(Number(a.amount),source)}</strong>{selected.status==='draft'&&canFinalize&&<button onClick={()=>void deleteAllocation(a.id)}>×</button>}</article>})}</div>
   {selected.status==='draft'&&canFinalize&&adoptedPrograms.length>0&&<div className="budgetAllocationForm"><select value={allocationProgram} onChange={e=>{setAllocationProgram(e.target.value);const p=adoptedPrograms.find(x=>x.id===e.target.value);if(p)setAllocationAmount(String(p.total_budget||0))}}><option value="">Выберите принятую ГП…</option>{adoptedPrograms.filter(p=>!myAllocations.some(a=>a.program_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.title} · {p.responsible_ministry}</option>)}</select><input type="number" min="0" value={allocationAmount} onChange={e=>setAllocationAmount(e.target.value)} aria-label={"Сумма финансирования, "+scenarioUnit(source)} placeholder={"Сумма, "+scenarioUnit(source)}/><input value={allocationNote} onChange={e=>setAllocationNote(e.target.value)} placeholder="Комментарий / приоритет / корректировка"/><button disabled={busy||!allocationProgram} onClick={()=>void setAllocation()}>Добавить финансирование</button></div>}
  </section>}

  {selected&&<div className="budgetStreams">{streams.map(([key,label,hint])=>{
   const existing=myWork.find(x=>x.workstream===key);const dkey=selected.id+'-'+key;
   return <article className={existing?'done':''} key={key}><header><span>{existing?'✓':'○'}</span><div><b>{label}</b><small>{hint}</small></div></header><textarea rows={4} disabled={selected.status==='final'} value={streamDraft[dkey]??existing?.summary??''} onChange={e=>setStreamDraft(v=>({...v,[dkey]:e.target.value}))} placeholder="Ключевые расчёты, предпосылки и выводы вашей группы…"/><footer>{existing?<span>{name(existing.submitted_by)} · {new Date(existing.updated_at).toLocaleString('ru-RU')}</span>:<span>Не представлено</span>}{selected.status==='draft'&&<button disabled={busy||(streamDraft[dkey]||'').trim().length<10} onClick={()=>void submitStream(key)}>Сдать блок</button>}</footer></article>
  })}</div>}

  {selected&&<footer className="budgetFinalize"><div><small>ГОТОВНОСТЬ СЦЕНАРИЯ</small><h3>{myWork.length}/5 аналитических блоков</h3><p>{selected.status==='final'?(budgetDocument?'Проект федерального бюджета уже создан в реестре НПА: '+budgetDocument.registry_no+'.':'Сценарий зафиксирован. Следующий шаг — сформировать из него проект федерального бюджета в реестре НПА.'):'После фиксации сценарий становится общей количественной базой для последующей бюджетной процедуры.'}</p></div><div>{canFinalize&&selected.status==='draft'&&<button className="primary" disabled={busy||myWork.length<5} onClick={()=>void finalize()}>Зафиксировать сценарий</button>}{canFinalize&&selected.status==='final'&&!selected.formal_document_id&&<button className="primary" disabled={busy} onClick={()=>void createBudgetDocument()}>Создать проект бюджета →</button>}{budgetDocument&&<span className="budgetDocBadge">{budgetDocument.registry_no} · {budgetDocument.status_label}</span>}</div></footer>}
 </section>;
}
