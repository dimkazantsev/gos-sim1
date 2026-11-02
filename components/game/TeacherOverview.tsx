'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Activity,ArrowRight,BookOpenText,FileText,GraduationCap,Landmark,Newspaper,RefreshCw,UsersRound,Vote,Wallet,Zap} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {moneyMillions,quantity} from '@/lib/formatQuantity';
import {budgetModeLabel} from './useBudgetPulse';
import {budgetDisplay} from './federalBudgetMath';
import type {FiscalContext} from './fiscalMath';
import type {ReturnTypeRepublic} from './viewTypes';
import styles from './TeacherOverview.module.css';
import {GAME_DATA_REFRESH_EVENT} from './useGameTableSync';

type Snapshot={as_of:string;students:number;online:number;active_day:number;actions_day:number;stages_total:number;stages_completed:number;stages_overdue:number;documents_total:number;documents_draft:number;documents_published:number;documents_moving:number;votes_open:number;votes_closed:number;votes_failed_quorum:number;ballots_open:number;parties_total:number;parties_registered:number;parties_waiting:number;party_files:number;mandates:number;mandates_available:number;mandates_allocated:number;cases_active:number;case_invites_waiting:number;cases_resolved:number;posts_public:number;media_waiting:number;grades_final:number;grades_waiting:number;grade_average:number|null;changes_day:number};
type Destination='documents'|'votes'|'budget'|'actions';
type OverviewCache={snapshot:Snapshot;fullAt:number;liveAt:number;macro:FiscalContext|null;macroAt:number};
const overviewCache=new Map<string,OverviewCache>();
const overviewInFlight=new Map<string,Promise<{data:Partial<Snapshot>;full:boolean}>>();
function keepOverview(key:string,value:OverviewCache){
 overviewCache.delete(key);overviewCache.set(key,value);
 if(overviewCache.size>8)overviewCache.delete(overviewCache.keys().next().value!);
}
async function fetchOverview(key:string,gameId:string,full:boolean){
 const pending=overviewInFlight.get(key);
 if(pending)return pending;
 const task=(async()=>{
  let data:Partial<Snapshot>;
  if(full){
   const r=await supabase.rpc('get_teacher_overview',{p_game_id:gameId});
   if(r.error)throw r.error;
   data=r.data as Snapshot;
  }else{
   const r=await supabase.rpc('get_teacher_overview_live',{p_game_id:gameId});
   if(r.error&&['PGRST202','42883'].includes(String(r.error.code||''))){
    const old=await supabase.rpc('get_teacher_overview',{p_game_id:gameId});
    if(old.error)throw old.error;
    return {data:old.data as Snapshot,full:true};
   }
   if(r.error)throw r.error;
   data=r.data as Partial<Snapshot>;
  }
  if(!data?.as_of)throw new Error('Обзор управления не вернул данные.');
  return {data,full};
 })();
 overviewInFlight.set(key,task);
 try{return await task}finally{if(overviewInFlight.get(key)===task)overviewInFlight.delete(key)}
}
export default function TeacherOverview({g,onWorkspace,onNavigate}:{g:ReturnTypeRepublic;onWorkspace:(key:'stages'|'parties'|'grades'|'event'|'impact'|'journal')=>void;onNavigate?:(destination:Destination)=>void}){
 const gameId=g.game?.id,cacheKey=gameId&&g.me?.user_id?gameId+':'+g.me.user_id:'';
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState('');
 const [macro,setMacro]=useState<FiscalContext|null>(null);
 const request=useRef(0),alive=useRef(false),scope=useRef(cacheKey),snapshotScope=useRef('');
 const dirtyStatic=useRef(false);scope.current=cacheKey;
 const refresh=useCallback(async(mode:'auto'|'changed'|'manual'='auto')=>{
  if(!gameId||!g.teacher||!cacheKey)return;
  const saved=overviewCache.get(cacheKey),now=Date.now();
  const full=mode==='manual'||!saved||now-saved.fullAt>=240000||
   mode==='changed'&&now-saved.fullAt>=60000;
  if(mode!=='manual'&&saved&&now-saved.liveAt<45000&&!full)return;
  const ticket=++request.current;
  try{
   const r=await fetchOverview(cacheKey,gameId,full);
   if(!alive.current||ticket!==request.current||scope.current!==cacheKey)return;
   const existing=overviewCache.get(cacheKey);
   const value:OverviewCache={
    snapshot:{...(existing?.snapshot||saved?.snapshot||{}),...r.data} as Snapshot,
    fullAt:r.full?Date.now():existing?.fullAt||saved?.fullAt||Date.now(),
    liveAt:Date.now(),
    macro:existing?.macro||saved?.macro||null,
    macroAt:existing?.macroAt||saved?.macroAt||0
   };
   keepOverview(cacheKey,value);
   snapshotScope.current=cacheKey;setSnapshot(value.snapshot);setError('');
   if(r.full)dirtyStatic.current=false;
   if(!value.macroAt||Date.now()-value.macroAt>=300000){
    // Fiscal context is stable across ordinary activity and is shared across tab visits.
    value.macroAt=Date.now();
    void supabase.rpc('get_fiscal_context',{p_game_id:gameId}).then(result=>{
     if(result.error||!result.data?.policy||!alive.current||scope.current!==cacheKey)return;
     const current=overviewCache.get(cacheKey);
     if(current){keepOverview(cacheKey,{...current,macro:result.data as FiscalContext,macroAt:Date.now()});setMacro(result.data as FiscalContext)}
    });
   }
  }catch(e){if(alive.current&&ticket===request.current&&scope.current===cacheKey)setError(userError(e));}
 },[gameId,g.teacher,cacheKey]);
 useEffect(()=>{
  if(!gameId||!g.teacher||!cacheKey)return;
  alive.current=true;dirtyStatic.current=false;setError('');
  const cached=overviewCache.get(cacheKey);
  setSnapshot(cached?.snapshot||null);setMacro(cached?.macro||null);
  snapshotScope.current=cached?cacheKey:'';
  void refresh('auto');
  let lastAutomaticAt=Date.now(),pending:ReturnType<typeof setTimeout>|undefined;
  const automatic=()=>{
   if(document.visibilityState!=='visible'||Date.now()-lastAutomaticAt<45000)return;
   lastAutomaticAt=Date.now();void refresh(dirtyStatic.current?'changed':'auto');
  };
  const tables=new Set(['game_stages','formal_documents','game_votes','game_parties','political_posts']);
  const changed=(event:Event)=>{
   const detail=(event as CustomEvent<{gameId?:string;table?:string}>).detail;
   if(detail?.gameId!==gameId||(detail.table&&!tables.has(detail.table)))return;
   dirtyStatic.current=true;
   if(pending!==undefined)return;
   pending=setTimeout(()=>{pending=undefined;automatic()},1800);
  };
  const timer=setInterval(automatic,60000+Math.floor(Math.random()*15000));
  document.addEventListener('visibilitychange',automatic);
  window.addEventListener(GAME_DATA_REFRESH_EVENT,changed);
  return()=>{alive.current=false;request.current++;clearInterval(timer);clearTimeout(pending);document.removeEventListener('visibilitychange',automatic);window.removeEventListener(GAME_DATA_REFRESH_EVENT,changed)};
 },[gameId,cacheKey,refresh,g.teacher]);
 if(!g.teacher||!gameId)return null;
 const s=snapshotScope.current===cacheKey?snapshot:null,number=(n:number|undefined)=>n===undefined?'…':quantity(n,''),pulse=g.budgetPulse,c=pulse?.calculation;
 const waiting=(s?.parties_waiting??0)+(s?.media_waiting??0)+(s?.grades_waiting??0)+(s?.stages_overdue??0);
 const navigate=(destination:Destination)=>()=>onNavigate?.(destination);
 const cards=[
  {key:'documents',title:'Реестр НПА',Icon:FileText,value:s?.documents_total,unit:'документов',items:[['Черновики',s?.documents_draft],['На согласовании',s?.documents_moving],['Опубликовано',s?.documents_published]],action:navigate('documents'),button:'Открыть реестр'},
  {key:'parties',title:'Партии и фракции',Icon:UsersRound,value:s?.parties_registered,unit:'партий зарегистрировано',items:[['Заявки на регистрацию',s?.parties_waiting],['Загружено документов',s?.party_files],['Всего партий',s?.parties_total]],action:()=>onWorkspace('parties'),button:'Проверить документы'},
  {key:'mandates',title:'Мандаты Государственной Думы',Icon:Landmark,value:s?.mandates_allocated,unit:'мандатов распределено студентам',items:[['У фракций',s?.mandates],['Доступно с учётом отсутствующих депутатов и штрафов',s?.mandates_available],['Нормативный состав ГД',450]],action:()=>onWorkspace('parties'),button:'Открыть фракции'},
  {key:'votes',title:'Голосования',Icon:Vote,value:s?.ballots_open,unit:'бюллетеней в открытых процедурах',items:[['Процедур завершено',s?.votes_closed],['Без кворума',s?.votes_failed_quorum],['Сейчас открыто',s?.votes_open]],action:navigate('votes'),button:'Открыть голосование'},
  {key:'events',title:'Правовые ситуации',Icon:Zap,value:s?.cases_active,unit:'кейсов ожидают решения',items:[['Решено ситуаций',s?.cases_resolved],['Приглашения без ответа',s?.case_invites_waiting]],action:()=>onWorkspace('event'),button:'Открыть ситуации'},
  {key:'grades',title:'Оценки за этапы',Icon:GraduationCap,value:s?.grades_final,unit:'оценок подтверждено',items:[['Ожидают проверки',s?.grades_waiting],['Средний подтвержденный балл',s?s.grade_average===null?'Нет оценок':quantity(s.grade_average,'из 3'):'…']],action:()=>onWorkspace('grades'),button:'Открыть журнал оценок'},
  {key:'media',title:'Политический процесс',Icon:Newspaper,value:s?.posts_public,unit:'публичных публикаций',items:[['Предложено новостей в СМИ',s?.media_waiting]],action:navigate('actions'),button:'Проверить новости'},
  {key:'impact',title:'Состояние государства',Icon:Activity,value:s?.changes_day,unit:'изменений показателей за 24 часа',items:[['Просрочено открытых этапов',s?.stages_overdue]],action:()=>onWorkspace('impact'),button:'Открыть модель последствий'}
 ];
 return <section className={styles.overview} aria-label="Мониторинг текущей игры" data-teacher-overview={s?'ready':error?'error':'loading'}>
  <div className={styles.freshness}><span>{s?'Обновлено '+new Date(s.as_of).toLocaleTimeString('ru-RU'):'Загрузка показателей текущей игры…'} · Автоматическое обновление с ограничением частоты</span><button type="button" className="secondary" aria-label="Обновить показатели обзора" onClick={()=>void refresh('manual')}><RefreshCw size={18}/></button></div>
  {error&&<p className={styles.error} role="alert">{error}{s?' Показаны последние полученные данные.':''}</p>}
  <div className="teacherOverviewStats">
   <article><small>В ИГРЕ СЕЙЧАС</small><strong data-overview-kpi="online">{number(s?.online)}</strong><span>из {number(s?.students)} участников · активность за 90 секунд</span></article>
   <article><small>ОТКРЫТЫЕ ГОЛОСОВАНИЯ</small><strong data-overview-kpi="votes_open">{number(s?.votes_open)}</strong><span>{number(s?.ballots_open)} бюллетеней подано в этих процедурах</span></article>
   <article><small>АКТИВНОСТЬ ЗА 24 ЧАСА</small><strong data-overview-kpi="actions_day">{number(s?.actions_day)}</strong><span>{number(s?.active_day)} участников совершали действия</span></article>
   <article><small>ПРОХОЖДЕНИЕ ЭТАПОВ</small><strong data-overview-kpi="stages_completed">{number(s?.stages_completed)} / {number(s?.stages_total)}</strong><span>{number(s?.stages_overdue)} открытых этапов просрочено</span></article>
  </div>
  <section className={styles.queue} aria-label="Очередь проверки преподавателя"><header><BookOpenText size={21}/><h2>Требуют внимания</h2><b>{s?waiting:'…'}</b></header><div>{[{label:'Регистрация партий',count:s?.parties_waiting,action:()=>onWorkspace('parties')},{label:'Новости для СМИ',count:s?.media_waiting,action:navigate('actions')},{label:'Оценки на проверке',count:s?.grades_waiting,action:()=>onWorkspace('grades')},{label:'Просроченные этапы',count:s?.stages_overdue,action:()=>onWorkspace('stages')}].map(q=><button type="button" key={q.label} onClick={q.action}><span>{q.label}</span><b>{number(q.count)}</b><ArrowRight size={16}/></button>)}</div></section>
  <div className={styles.grid}>{cards.map(({key,title,Icon,value,unit,items,action,button})=><article key={key} data-overview-card={key}><header><span><Icon size={20}/></span><h2>{title}</h2></header><strong data-overview-kpi={key}>{number(value)}</strong><small>{unit}</small><dl>{items.map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{typeof value==='string'?value:number(value as number|undefined)}</dd></div>)}</dl><button type="button" className="secondary" onClick={action}>{button}<ArrowRight size={16}/></button></article>)}</div>
  {macro&&<section className={styles.budget} aria-label="Макроэкономические показатели"><header><Landmark size={21}/><div><h2>Макроэкономические показатели</h2><p>Единые параметры бюджета и финансового прогноза. Обновляются после решений и событий.</p></div><button type="button" className="secondary" onClick={navigate('budget')}>Открыть параметры<ArrowRight size={16}/></button></header><div className={styles.budgetNumbers}>{[{label:'Ключевая ставка',value:quantity(macro.policy.key_rate,'% годовых')},{label:'Курс',value:quantity(macro.policy.fx_rate,'руб. за долл. США')},{label:'Нефть',value:quantity(macro.policy.oil_price,'долл. США за баррель')},{label:'Инфляция',value:quantity(macro.policy.inflation,'%')}].map(x=><article key={x.label}><span>{x.label}</span><strong>{x.value}</strong></article>)}</div></section>}
  <section className={styles.budget} aria-label="Общий федеральный прогноз"><header><Wallet size={21}/><div><h2>Федеральный бюджет · 2026</h2><p>{pulse?budgetModeLabel(pulse.mode):'Загрузка общего расчета…'}</p></div><button type="button" className="secondary" onClick={navigate('budget')}>Открыть бюджет<ArrowRight size={16}/></button></header><div className={styles.budgetNumbers}>{[{label:'Планируемые доходы',value:c?.revenue,key:'income'},{label:'Планируемые расходы',value:c?.expenditure,key:'expense'},{label:c&&c.balance>=0?'Профицит':'Дефицит',value:c?c.balance>=0?c.surplus:c.deficit:undefined,key:'balance'},{label:'Госдолг на конец периода',value:c?.debt_total,key:'debt'}].map(k=><article key={k.key}><span>{k.label}</span><strong data-budget-shared={k.key} data-budget-value={k.value}>{k.value===undefined?'…':budgetDisplay(k.value)}</strong></article>)}</div><p>{pulse?.note} До опубликования закона показан прогноз. Несохраненные изменения личного калькулятора сюда не входят.</p>{g.budgetPulseError&&<p role="alert" className={styles.error}>{g.budgetPulseError} {pulse?'Показан последний полученный расчет.':''}</p>}</section>
  <p className={styles.note}>Счетчики учитывают текущую игру. Активность и оценки — действующих студентов; завершенные процедуры и документы остаются в истории игры.</p>
 </section>;
}
