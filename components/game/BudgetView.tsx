'use client';
import {useEffect,useMemo,useState} from 'react';
import {ArrowRight,ChartNoAxesCombined,Coins,FileText,Landmark,List,Map as MapIcon,RefreshCw,Save,Search} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import catalog from '@/data/taxes-2026.json';
import mapData from '@/data/region-paths.json';
import {fiscalForecast,fiscalTotal,type FiscalRegion,type FiscalRate} from './fiscalMath';
import StyledSelect from '../ui/StyledSelect';
type Proposal={id:string;tax_key:string;region_code:string;new_rate:number;status:string;document_id:string|null;author_id:string};
type Change={id:number;region_code:string|null;note:string;source_type:string;created_at:string};
type Case={id:string;title:string;comic_scene:{region_code?:string};status:string;assigned?:boolean};
const money=(n:number|null)=>n===null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n);
const profileLabel:Record<string,string>={metropolis:'Городская экономика',resources:'Добывающий сектор',agriculture:'Агропромышленный сектор',northern:'Высокая стоимость инфраструктуры',tourism:'Туризм и услуги',industrial:'Промышленность и услуги'};
export default function BudgetView({g,readOnly=false,onOpenDocument,onOpenEvents}:{g:ReturnTypeRepublic;readOnly?:boolean;onOpenDocument:(id:string)=>void;onOpenEvents:()=>void}){
 const [regions,setRegions]=useState<FiscalRegion[]>([]),[rates,setRates]=useState<FiscalRate[]>([]),[proposals,setProposals]=useState<Proposal[]>([]),[ledger,setLedger]=useState<Change[]>([]);
 const [selected,setSelected]=useState('54'),[mode,setMode]=useState<'map'|'table'>('map'),[search,setSearch]=useState(''),[sort,setSort]=useState('name'),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[canPropose,setCanPropose]=useState(false),[notice,setNotice]=useState('');
 const [taxKey,setTaxKey]=useState('corporate_property'),[rate,setRate]=useState('2.2'),[parameters,setParameters]=useState<Record<string,string>>({}),[cases,setCases]=useState<Case[]>([]),[act,setAct]=useState('');
 const region=regions.find(r=>r.region_code===selected),forecast=region?fiscalForecast(region,rates):null;
 const total=useMemo(()=>fiscalTotal(regions,rates),[regions,rates]);
 const tax=catalog.taxes.find(t=>t.key===taxKey)!;
 async function load(){
  if(!g.game)return;const r=await supabase.rpc('get_fiscal_budget',{p_game_id:g.game.id});
  if(r.error){g.setError(r.error.message);return}
  if(r.data&&typeof r.data==='object'){setRegions(r.data.regions||[]);setRates(r.data.rates||[]);setProposals(r.data.proposals||[]);setLedger(r.data.ledger||[]);setCanPropose(!!r.data.can_propose);}setReady(true);
 }
 useEffect(()=>{void load();if(!g.game)return;const id=setInterval(()=>void load(),20000);return()=>clearInterval(id)},[g.game?.id,g.me?.user_id]);
 useEffect(()=>{
  if(!g.game)return;let live=true;void supabase.rpc('list_regional_cases',{p_game_id:g.game.id}).then(r=>{if(live&&!r.error)setCases((r.data||[]) as Case[])});
  return()=>{live=false};
 },[g.game?.id]);
 useEffect(()=>{if(!region)return;setParameters(Object.fromEntries(['enterprises','employees_per_firm','monthly_wage','profit_per_firm','consumption_per_firm','expenditure','transfer_in','debt','compliance'].map(k=>[k,String(region[k as keyof FiscalRegion])])));},[region?.region_code,region?.enterprises,region?.expenditure,region?.monthly_wage]);
 useEffect(()=>{const scope=tax.level==='federal'?'00':selected;setRate(String(rates.find(r=>r.tax_key===taxKey&&r.region_code===scope)?.rate??tax.default_rate??''));},[taxKey,selected,rates]);
 async function propose(){
  if(!g.game||readOnly||busy||!Number.isFinite(Number(rate)))return;
  setBusy(true);const r=await supabase.rpc('propose_fiscal_rate',{p_game_id:g.game.id,p_region:selected,p_tax:taxKey,p_rate:Number(rate)});setBusy(false);
  if(r.error)g.setError(r.error.message);else{setNotice('Предложение записано. Действующая ставка изменится после опубликования и проверки соответствующего акта.');await load()}
 }
 async function saveParameters(){
  if(!g.game||readOnly||!g.teacher||busy)return;
  const values=Object.fromEntries(Object.entries(parameters).map(([k,v])=>[k,Number(v)]));if(Object.values(values).some(v=>!Number.isFinite(v))){setNotice('Заполните числовые параметры.');return}
  setBusy(true);const r=await supabase.rpc('set_fiscal_parameters',{p_game_id:g.game.id,p_region:selected,p_values:values});setBusy(false);
  if(r.error)g.setError(r.error.message);else{setNotice('Параметры сценария сохранены для всей группы.');await load()}
 }
 async function apply(id:string){
  if(readOnly||busy||!g.teacher)return;setBusy(true);const r=await supabase.rpc('apply_fiscal_rate_proposal',{p_proposal:id,p_document:act||null});setBusy(false);
  if(r.error)g.setError(r.error.message);else{setNotice('Ставка учебного прогноза изменена по опубликованному документу.');await load()}
 }
 async function practice(c:Case){
  if(readOnly||busy)return;if(c.assigned){onOpenEvents();return}setBusy(true);const r=await supabase.rpc('start_regional_case',{p_case_id:c.id});setBusy(false);if(r.error)g.setError(r.error.message);else onOpenEvents();
 }
 const filtered=regions.filter(r=>r.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'ru'):sort==='enterprises'?b.enterprises-a.enterprises:fiscalForecast(b,rates).balance-fiscalForecast(a,rates).balance);
 const preview=region&&Number.isFinite(Number(rate))?fiscalForecast(region,rates,{tax:taxKey,rate:Number(rate)}):null;
 const regionCases=cases.filter(c=>c.comic_scene?.region_code===selected);
 return <div className="budgetPage">
 <header className="budgetHero"><div><small>ФЕДЕРАЦИЯ · РЕГИОНЫ · МУНИЦИПАЛИТЕТЫ</small><h1>Бюджет</h1><p>Налоги, публичные обязательства и цена решений. Общая модель для всех участников игры.</p></div><button type="button" className="secondary" onClick={()=>void load()} disabled={busy}><RefreshCw size={18}/> Обновить данные</button></header>
 <div className="budgetScenarioNote"><b>Учебный бюджет · млн рублей</b><span>Числа модели не являются бюджетами реальных регионов. Параметры задаёт преподаватель; нормы зачисления доходов сокращены для игры. Реальные наблюдения показаны отдельно с источником и годом.</span></div>
 {!ready?<p role="status">Загружаем общую бюджетную модель…</p>:<>
 <div className="budgetKpis">{[
 ['Предприятия',money(total.enterprises),'Сценарные налогоплательщики'],
 ['Доходы регионов',money(total.revenue),'Включая входящие трансферты'],
 ['Расходы регионов',money(total.expenditure),'С учётом событий и стоимости'],
 ['Баланс регионов',money(total.revenue-total.expenditure),'Доходы минус расходы'],
 ['Федеральные доходы',money(total.federal),'До трансфертов регионам'],
 ['Местные доходы',money(total.municipal),'Учебные нормативы зачисления']
 ].map(([label,value,note])=><article key={label}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>)}</div>
 <details className="surface budgetMethod"><summary><ChartNoAxesCombined size={18}/> Как решения меняют бюджет</summary><div><p>Налоговая база зависит от предприятий, занятости, зарплаты, прибыли и деловой активности. Доход по выбранной базе = база × ставка × собираемость. Транспортный налог считается по мощности, а не в процентах.</p><p>Расходы = обязательства × коэффициент стоимости. Дефицит увеличивает расчётную потребность в финансировании: долг следующего периода = исходный долг + max(0; расходы − доходы). Это сценарий, заимствование требует отдельного решения.</p><p>Повышение ставки немедленно меняет поступления. В прогнозе следующего периода рост налоговой нагрузки может снижать активность предприятий. Эластичность — учебное допущение, не экономический прогноз. Исходы региональных кейсов меняют предприятия, расходы или коэффициенты только один раз и сохраняют источник в журнале.</p><p>Тип налога не определяет единственный бюджет-получатель. В учебной схеме прибыль делится 32% / 68%, базовый НДФЛ 85% / 15%; остальные выбранные потоки распределяются по уровню. В действующем праве применяются точные нормативы БК РФ, в том числе специальные нормы по категориям доходов.</p></div></details>
 <section className="surface budgetTaxGuide"><header><h2>Налоговая система</h2><span>По состоянию на 1 октября 2026 года</span></header>
 <div className="budgetTaxLevels">{[['federal','Федеральные'],['regional','Региональные'],['municipal','Местные']].map(([level,label])=><section key={level}><h3>{label}</h3>{catalog.taxes.filter(t=>t.level===level).map(t=><details key={t.key}><summary>{t.label}</summary><p>{t.explanation}</p><p>Глава {t.chapter} НК РФ. <a href={t.source_url} target="_blank" rel="noreferrer">Разъяснения ФНС ↗</a></p></details>)}</section>)}</div>
 <details className="budgetSpecialRegimes"><summary>Специальные налоговые режимы</summary><ul>{catalog.special_regimes.map(r=><li key={r.label}>{r.label} · {r.chapter}</li>)}</ul><p>{catalog.note}</p></details>
 </section>
 <section className="surface budgetRegions"><header><div><small>89 РЕГИОНАЛЬНЫХ СЦЕНАРИЕВ</small><h2>Бюджетная карта</h2></div><nav aria-label="Вид регионов"><button type="button" aria-pressed={mode==='map'} onClick={()=>setMode('map')}><MapIcon size={18}/> Карта</button><button type="button" aria-pressed={mode==='table'} onClick={()=>setMode('table')}><List size={18}/> Таблица</button></nav></header>
 <div className="budgetRegionToolbar"><label><Search size={18}/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Найти регион" aria-label="Поиск региона"/></label><StyledSelect label="Регион" value={selected} onChange={setSelected} options={regions.map(r=>({value:r.region_code,label:r.name}))}/><StyledSelect label="Порядок" value={sort} onChange={setSort} options={[{value:'name',label:'По названию'},{value:'enterprises',label:'По предприятиям'},{value:'balance',label:'По балансу'}]}/></div>
 <div className="budgetRegionSplit"><div className="budgetMapPanel">
 {mode==='map'?<><svg className="budgetMap" viewBox="0 0 1280 600" role="group" aria-label="Регионы: выберите область на карте"><defs><pattern id="disputedFiscal" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#e0dcef"/><path d="M0 8 8 0" stroke="#715a96" strokeWidth="1"/></pattern></defs>{mapData.paths.map(p=>{const r=regions.find(x=>x.region_code===p.code);if(!r)return null;const f=fiscalForecast(r,rates);return <path key={p.code} d={p.path} tabIndex={0} role="button" aria-label={r.name+', баланс '+money(f.balance)+' млн рублей'} aria-pressed={selected===p.code} fill={selected===p.code?'#c2438a':r.disputed?'url(#disputedFiscal)':f.balance>=0?'#75c6ac':'#b8c9e8'} stroke={selected===p.code?'#822759':'#fff'} strokeWidth={selected===p.code?2:1} onClick={()=>setSelected(p.code)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(p.code)}}}><title>{r.name}</title></path>})}</svg><div className="budgetMapLegend"><span><i style={{background:'#75c6ac'}}/> Профицит</span><span><i style={{background:'#b8c9e8'}}/> Дефицит</span><span><i style={{background:'#c2438a'}}/> Выбранный регион</span></div><p className="budgetMapSource">89 записей по российскому административному перечню. Спорные территории отмечены штриховкой; показаны справочные границы 2017 года, без линии фактического контроля. <a href="https://www.geoboundaries.org/" target="_blank" rel="noreferrer">geoBoundaries / OpenStreetMap, ODbL 1.0 ↗</a></p></>:<div className="budgetTableWrap"><table><thead><tr><th>Регион</th><th>Предприятия</th><th>Доходы</th><th>Расходы</th><th>Баланс</th></tr></thead><tbody>{filtered.map(r=>{const f=fiscalForecast(r,rates);return <tr key={r.region_code} className={r.region_code===selected?'selected':''}><th><button type="button" onClick={()=>setSelected(r.region_code)}>{r.name}</button></th><td>{money(r.enterprises)}</td><td>{money(f.revenue)}</td><td>{money(f.expenditure)}</td><td>{money(f.balance)}</td></tr>})}</tbody></table></div>}
 </div>
 {region&&forecast&&<aside className="budgetRegionDetail"><header><Landmark size={24}/><div><small>{profileLabel[region.profile]} · учебный профиль</small><h3>{region.name}</h3></div></header>
 <dl>{[['Доходы',forecast.revenue],['Расходы',forecast.expenditure],['Баланс',forecast.balance],['Трансферты',region.transfer_in],['Расчётный долг',forecast.debt],['Рабочие места',forecast.employees]].map(([label,v])=><div key={String(label)}><dt>{label}</dt><dd>{money(Number(v))}{label==='Рабочие места'?'':' млн ₽'}</dd></div>)}</dl>
 <details><summary>Реальная региональная статистика · 2025</summary><p>Налоговые поступления по данным ФНС. Это часть доходов, не весь бюджет региона. Местные суммы уже входят в консолидированные.</p>{Object.entries(region.observations||{}).map(([key,v])=><p key={key}>{({tax_receipts_total:'Поступления ФНС, всего',tax_receipts_federal:'Из них в федеральный бюджет',tax_receipts_consolidated:'В консолидированный бюджет субъекта',tax_receipts_local:'Из него в местные бюджеты',usn_receipts:'Поступления по УСН'} as Record<string,string>)[key]||key}: <b>{v===null?'Нет сопоставимого наблюдения':money(v)+' млн ₽'}</b></p>)}<a href={region.source_url} target="_blank" rel="noreferrer">ФНС, форма 1-НМ · {region.source_year} ↗</a></details>
 <details className="budgetTaxLines"><summary>Из чего складываются налоговые доходы</summary><div className="budgetTableWrap"><table><thead><tr><th>Налог</th><th>База</th><th>Ставка</th><th>Поступления</th></tr></thead><tbody>{forecast.lines.map(t=><tr key={t.key}><th>{t.label}</th><td>{money(t.base)}</td><td>{t.rate===null?'Специальная формула':money(t.rate)+' '+t.unit}</td><td>{t.amount===null?'Нужна отдельная база':money(t.amount)+' млн ₽'}</td></tr>)}</tbody></table></div><p>Суммарный прогноз включает только строки с заданной базой. Остальные платежи изучаются в справочнике и кейсах.</p></details><h4>Региональные правовые задачи</h4>{regionCases.length?regionCases.slice(0,8).map(c=><button type="button" className="budgetCaseLink" key={c.id} disabled={readOnly||busy||g.me?.kind!=='student'||(!c.assigned&&c.status!=='ready')} onClick={()=>void practice(c)}><FileText size={17}/><span>{c.title}{c.status==='resolved'?' · Решено':c.status==='voting'?' · Голосуют':''}</span><ArrowRight size={17}/></button>):<p>Задачи региона появятся после обновления банка.</p>}
 </aside>}
 </div></section>
 {region&&forecast&&<section className="surface budgetRateLab"><header><div><small>НАЛОГОВАЯ ПОЛИТИКА</small><h2>Ставка и её последствия</h2></div><Coins size={24}/></header>
 <div className="budgetRateFields"><StyledSelect label="Налог и база" value={taxKey} onChange={setTaxKey} options={catalog.taxes.filter(t=>t.default_rate!==null).map(t=>({value:t.key,label:t.label}))}/><label>Предлагаемая ставка, {tax.unit}<input type="number" step=".1" min={tax.min_rate??0} max={tax.max_rate??100} value={rate} onChange={e=>setRate(e.target.value)}/></label><button type="button" className="primary" disabled={busy||readOnly||!canPropose||!rate} onClick={()=>void propose()}>Направить предложение</button></div>
 <p>{tax.explanation}</p><div className="budgetPreviewComparison"><div><span>Текущие доходы региона</span><b>{money(forecast.revenue)} млн ₽</b></div><div><span>Если ставка будет принята</span><b>{money(preview?.revenue??null)} млн ₽</b></div><div><span>Активность следующего периода</span><b>{preview?money(preview.nextActivity*100)+'%':'—'}</b></div></div>
 <p>Расчёт предложения виден всем. Исполнительная власть подготавливает изменение; правовую форму и принятие проверяют участники процедуры. Прогноз не меняет действующий бюджет.</p>
 {proposals.filter(p=>p.region_code===selected||p.region_code==='00').slice(0,12).map(p=><article className="budgetProposal" key={p.id}><div><b>{catalog.taxes.find(t=>t.key===p.tax_key)?.label}: {p.new_rate}</b><span>{p.status==='applied'?'Введена актом':'Ожидает принятия акта'}</span></div>{p.document_id&&<button type="button" onClick={()=>onOpenDocument(p.document_id!)}>Проект НПА</button>}{g.teacher&&p.status==='pending'&&!readOnly&&<button type="button" disabled={busy} onClick={()=>void apply(p.id)}>Проверить и применить</button>}</article>)}
 {g.teacher&&!readOnly&&<StyledSelect label="Опубликованный акт для подтверждения меры" value={act} onChange={setAct} options={[{value:'',label:'Использовать связанный акт'},...g.formalDocuments.filter(d=>d.status_code==='published').map(d=>({value:d.id,label:d.registry_no+' · '+d.title}))]}/>}
 </section>}
 {g.teacher&&region&&!readOnly&&<details className="surface budgetParameters"><summary>Параметры экономического сценария · преподаватель</summary><p>Только эти параметры определяют экономическую и финансовую основу; студенты изменяют налоговую политику через предложения.</p><div>{Object.entries(parameters).map(([key,v])=><label key={key}>{({enterprises:'Предприятия, шт.',employees_per_firm:'Работников на предприятие',monthly_wage:'Зарплата, ₽/месяц',profit_per_firm:'Прибыль на предприятие, млн ₽',consumption_per_firm:'Облагаемая добавленная стоимость, млн ₽',expenditure:'Обязательства, млн ₽',transfer_in:'Трансферты, млн ₽',debt:'Исходный долг, млн ₽',compliance:'Собираемость, 0–1'} as Record<string,string>)[key]}<input type="number" step="any" min="0" value={v} onChange={e=>setParameters(old=>({...old,[key]:e.target.value}))}/></label>)}</div><button type="button" className="primary" disabled={busy} onClick={()=>void saveParameters()}><Save size={18}/> Сохранить параметры</button></details>}
 <section className="surface budgetChangeLog"><h2>Движение бюджета</h2>{ledger.length?ledger.map(x=><article key={x.id}><time>{new Date(x.created_at).toLocaleString('ru-RU')}</time><div><b>{x.note}</b><span>{regions.find(r=>r.region_code===x.region_code)?.name||'Федеральный уровень'}</span></div></article>):<p>Налоговые меры, изменения сценария и исходы кейсов будут записаны здесь с источником.</p>}</section>
 </>}
 {notice&&<p className="budgetNotice" role="status">{notice}</p>}
 </div>;
}
