'use client';
import {metricQuantity} from '@/lib/formatQuantity';
import {IconAction} from '../ui/IconAction';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,BadgeCheck,Globe2,Handshake,HeartHandshake,MessageSquare,Scale,ShieldCheck,TrendingUp,UsersRound,Wallet} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Metric} from './types';
import {drawMetricChart,METRIC_COLORS,pointsForMetric} from './metricChart';

const PRIMARY=['public_trust','economy','budget','social_stability','lawfulness','international_standing'];
const MAX_CHART_SERIES=4;
const HISTORY_PREVIEW_COUNT=6;

function spark(points:number[],w=220,h=64){
 if(points.length<2)return '';
 const min=Math.min(...points),max=Math.max(...points),span=Math.max(1,max-min);
 return points.map((v,i)=>{
  const x=i/(points.length-1)*w;
  const y=h-((v-min)/span*h);
  return (i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1);
 }).join(' ');
}
function delta(m:Metric){return Number(m.value)-Number(m.previous_value??m.value)}
function groupLabel(k:string){return k==='society'?'Общество':k==='elites'?'Элиты':k==='international'?'Международное':k==='economy'?'Экономика':'Государство'}
function changeTone(m:Metric,d:number){
 if(d===0)return 'flat';
 if(m.metric_key==='social_tension')return d>0?'bad':'good';
 if(m.metric_key==='budget')return 'neutral';
 return d>0?'good':'bad';
}
function metricIcon(k:string){
 const Icon=k==='public_trust'?Handshake:
  k==='economy'?TrendingUp:
  k==='budget'?Wallet:
  k==='social_stability'?HeartHandshake:
  k==='lawfulness'?Scale:
  k==='international_standing'?Globe2:
  k==='elite_support'?UsersRound:
  k==='security'?ShieldCheck:
  k==='social_tension'?Activity:
  k==='media_climate'?MessageSquare:
  k==='legitimacy'?BadgeCheck:Activity;
 return <Icon aria-hidden="true" size={18} strokeWidth={1.75}/>;
}

export default function StateMetricsDock({g,initialSelectedMetricId='',initialCompareIds=[]}:{g:ReturnTypeRepublic;initialSelectedMetricId?:string;initialCompareIds?:string[]}){
 const {game,metrics,metricHistory,teacher,politicalPosts,names}=g;
 const [selected,setSelected]=useState(initialSelectedMetricId);
 const dialogRef=useDialog(!!selected,()=>setSelected(''));
 const [compare,setCompare]=useState<string[]>(initialCompareIds.slice(0,MAX_CHART_SERIES-1));
 const [showFullHistory,setShowFullHistory]=useState(false);
 const [bucket,setBucket]=useState<'changes'|'day'|'week'>('changes');
 const plotRef=useRef<HTMLDivElement>(null);
 const [plotWidth,setPlotWidth]=useState(700);
 const [focusedPoint,setFocusedPoint]=useState<{id:string;at:number}|null>(null);
 const allowed=useMemo(()=>[...metrics].filter(m=>teacher||m.is_public).sort((a,b)=>a.sort_order-b.sort_order),[metrics,teacher]);
 const primary=PRIMARY.map(k=>allowed.find(m=>m.metric_key===k)).filter(Boolean) as Metric[];
 const secondary=allowed.filter(m=>!PRIMARY.includes(m.metric_key));
 const visibleMetrics=[...primary,...secondary];
 const chosen=allowed.find(m=>m.id===selected&&(m.metric_key!=='budget'||g.budgetPulse));
 useEffect(()=>{
  if(!chosen||!plotRef.current)return;
  const node=plotRef.current;
  const update=()=>{const measured=Math.round((node.querySelector('svg')||node).getBoundingClientRect().width);if(measured>0)setPlotWidth(old=>Math.abs(old-measured)>1?measured:old)};
  update();
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(update):null;
  observer?.observe(node);
  window.addEventListener('resize',update);
  return()=>{observer?.disconnect();window.removeEventListener('resize',update)};
 },[chosen?.id]);

 function rowsFor(metricKey:string){return metricHistory.filter(h=>h.metric_key===metricKey)}
 const hist=chosen?rowsFor(chosen.metric_key).sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at)):[];
 const comparisonOptions=visibleMetrics.filter(m=>m.id!==chosen?.id&&(m.metric_key!=='budget'||g.budgetPulse));
 const activeMetrics=chosen?[chosen,...comparisonOptions.filter(m=>compare.includes(m.id))]:[];
 const comparisonLimitReached=activeMetrics.length>=MAX_CHART_SERIES;
 const snapshotAt=useMemo(()=>Date.now(),[selected]);
 const series=activeMetrics.map(metric=>({
  metric,
  color:metric.id===chosen?.id?METRIC_COLORS[0]:METRIC_COLORS[(1+comparisonOptions.findIndex(option=>option.id===metric.id))%METRIC_COLORS.length],
  points:pointsForMetric(metric,metricHistory,bucket,game?.created_at,snapshotAt)
 }));
 const geometry=drawMetricChart(series,series.length>1,Math.max(240,plotWidth),plotWidth<460?222:250);
 const chosenPoints=series[0]?.points||[];
 const singlePoint=geometry.lines.length===1&&chosenPoints.length===1;
 const activePoint=series.flatMap(s=>s.points.map(point=>({...point,metric:s.metric,color:s.color}))).find(p=>focusedPoint?.id===p.metric.id&&focusedPoint.at===p.at)
  ||(series[0]&&chosenPoints.length?{...chosenPoints[chosenPoints.length-1],metric:series[0].metric,color:series[0].color}:null);
 const formatValue=(v:number,unit:string|null)=>metricQuantity(v,unit,unit?.startsWith('млн')?'budget':undefined);
 const formatTime=(timestamp:number)=>new Date(timestamp).toLocaleString('ru-RU',{
  day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
 });
 const visibleTicks=plotWidth<440&&geometry.xTicks.length>2?[geometry.xTicks[0],geometry.xTicks[geometry.xTicks.length-1]]:geometry.xTicks;
 const daySpan=geometry.xTicks.length>1&&geometry.xTicks.at(-1)!.at-geometry.xTicks[0].at<86400000*2;
 const axisDate=(at:number)=>new Date(at).toLocaleString('ru-RU',daySpan?{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}:{day:'2-digit',month:'2-digit'});

 function card(m:Metric){
  const d=delta(m);
  const pending=m.metric_key==='budget'&&!g.budgetPulse;
  const rows=rowsFor(m.metric_key);
  const mini=rows.slice(-12).map(h=>Number(h.value));
  const last=rows.at(-1);
  const pct=m.max_value!=null&&m.min_value!=null?Math.max(0,Math.min(100,(Number(m.value)-Number(m.min_value))/Math.max(1,Number(m.max_value)-Number(m.min_value))*100)):null;
  return <button key={m.id} className={'statePulseMetric '+m.group_key+' metric-'+m.metric_key} data-budget-metric-value={m.metric_key==='budget'&&!pending?m.value:undefined} disabled={pending} onClick={()=>{setCompare([]);setBucket('changes');setFocusedPoint(null);setShowFullHistory(false);setSelected(m.id)}}>
   <span className="statePulseIcon" aria-hidden="true">{metricIcon(m.metric_key)}</span>
   <div className="statePulseCopy"><small>{groupLabel(m.group_key)}</small><b>{m.metric_key==='budget'?'Доходы бюджета':m.label}</b><span>{pending?(g.budgetPulseError||'Получаем общий федеральный прогноз…'):last?.note||m.description||'Игровой показатель'}</span></div>
   <div className="statePulseValue"><strong>{pending?'…':metricQuantity(Number(m.value),m.unit,m.metric_key)}</strong><em className={changeTone(m,d)}>{pending||d===0?'—':`${d>0?'▲ +':'▼ '}${m.metric_key==='budget'?metricQuantity(Math.abs(d),m.unit,m.metric_key):Math.abs(d).toFixed(Math.abs(d)%1?1:0)}`}</em></div>
   <div className="statePulseTrend">
    {mini.length>1&&<svg viewBox="0 0 120 32" aria-hidden="true"><path d={spark(mini,120,32)} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg>}
    {pct!=null&&<i><span style={{width:pct+'%'}}/></i>}
   </div>
  </button>;
 }

 return <>
  <section className="statePulseDock" aria-label="Состояние государства">
   {visibleMetrics.length?<div className="statePulseGrid">{visibleMetrics.map(card)}</div>:<div className="emptyState">Показатели появятся после настройки игры преподавателем.</div>}
  </section>

  {chosen&&<div className="metricModalBackdrop" onClick={()=>setSelected('')}>
   <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="metric-title" className="metricModal redesigned" onClick={e=>e.stopPropagation()}>
    <header><div className="metricModalTitle"><span>{metricIcon(chosen.metric_key)}</span><div><small>{groupLabel(chosen.group_key).toUpperCase()}</small><h2 id="metric-title">{chosen.label}</h2><p>{chosen.description||'Игровой показатель состояния государства.'}</p></div></div><IconAction onClick={()=>setSelected('')} label="Закрыть показатель"/></header>
    <div className="metricModalBody">
    <div className="metricHeroValue"><strong>{metricQuantity(Number(chosen.value),chosen.unit,chosen.metric_key)}</strong><span className={changeTone(chosen,delta(chosen))}>{delta(chosen)===0?'Без изменений':(delta(chosen)>0?'▲ +':'▼ ')+(chosen.metric_key==='budget'?metricQuantity(Math.abs(delta(chosen)),chosen.unit,'budget'):Math.abs(delta(chosen)).toFixed(1))+' с прошлого изменения'}</span></div>
    {hist.at(-1)&&<div className="metricLastCause"><small>ПОСЛЕДНЯЯ ПРИЧИНА</small><b>{hist.at(-1)?.note||hist.at(-1)?.source_type}</b><span>{new Date(hist.at(-1)!.recorded_at).toLocaleString('ru-RU')}</span></div>}
    <div className="metricBucketTabs"><button className={bucket==='changes'?'active':''} aria-pressed={bucket==='changes'} onClick={()=>{setFocusedPoint(null);setBucket('changes')}}>Все изменения</button><button className={bucket==='day'?'active':''} aria-pressed={bucket==='day'} onClick={()=>{setFocusedPoint(null);setBucket('day')}}>По дням</button><button className={bucket==='week'?'active':''} aria-pressed={bucket==='week'} onClick={()=>{setFocusedPoint(null);setBucket('week')}}>По неделям</button></div>
    <section className="metricChart redesignedChart" aria-label="График динамики показателей">
     <div className="metricChartCaption"><b>{geometry.comparing?'Динамика показателей':'История показателя'}</b><span>{bucket==='changes'?'По игровым событиям':bucket==='day'?'По дням':'По неделям'} · {activeMetrics.length} из {MAX_CHART_SERIES} линий</span></div>
     <div className="metricPlotViewport" ref={plotRef}>
     <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="group" aria-label={'Временной график: '+activeMetrics.map(m=>m.label).join(', ')} preserveAspectRatio="xMidYMid meet">
      {geometry.yTicks.map((tick,i)=><g key={i}>
       <line className="metricGridLine" x1={geometry.left} x2={geometry.width-geometry.right} y1={tick.y} y2={tick.y}/>
       <text className="metricAxisText" x={geometry.left-8} y={tick.y+4} textAnchor="end">{geometry.comparing?tick.value+'%':tick.value.toLocaleString('ru-RU',{maximumFractionDigits:1})}</text>
      </g>)}
      {visibleTicks.map((tick,i)=><g key={i}>
       <line className="metricDateLine" x1={tick.x} x2={tick.x} y1={geometry.top} y2={geometry.height-geometry.bottom}/>
       <text className="metricAxisText" x={tick.x} y={geometry.height-12} textAnchor={i===0&&visibleTicks.length>1?'start':i===visibleTicks.length-1&&visibleTicks.length>1?'end':'middle'}>{axisDate(tick.at)}</text>
      </g>)}
      {geometry.lines.map(line=><g key={line.metric.id} style={{color:line.color}}>
       {line.pointsOnChart.length>1&&<path d={line.path} className="metricSeriesPath" stroke="currentColor"/>}
       {line.pointsOnChart.length===1&&<line x1={geometry.left} x2={geometry.width-geometry.right} y1={line.pointsOnChart[0].y} y2={line.pointsOnChart[0].y} className="metricSingleGuide" stroke="currentColor"/>}
       {line.pointsOnChart.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={focusedPoint?.id===line.metric.id&&focusedPoint.at===p.at?6:4.5} className="metricChartPoint" fill="currentColor" stroke="#fff" strokeWidth="2" tabIndex={0} role="button" aria-label={`${line.metric.label}: ${formatValue(p.value,line.metric.unit)}, ${formatTime(p.at)}. ${p.note}`} onClick={()=>setFocusedPoint({id:line.metric.id,at:p.at})} onFocus={()=>setFocusedPoint({id:line.metric.id,at:p.at})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setFocusedPoint({id:line.metric.id,at:p.at})}}}><title>{`${line.metric.label}: ${formatValue(p.value,line.metric.unit)}. ${formatTime(p.at)}. ${p.note}`}</title></circle>)}
      </g>)}
     </svg>
     </div>
     {activePoint&&<div className="metricPointDetail" aria-live="polite">
      <span className="metricPointDot" style={{background:activePoint.color}} aria-hidden="true"/>
      <span className="metricPointText"><b>{activePoint.metric.label} · {formatValue(activePoint.value,activePoint.metric.unit)}</b><small>{formatTime(activePoint.at)} · {activePoint.note}</small></span>
     </div>}
     {singlePoint&&<p className="metricChartNotice">{chosenPoints[0].kind==='snapshot'?'Показано текущее значение. Записи об изменениях пока отсутствуют.':'Показана исходная точка. Линия динамики появится после первого изменения.'}</p>}
     {geometry.comparing&&<p className="metricChartNotice">Линии приведены к собственным шкалам. Точные значения показаны при выборе точки.</p>}
     <div className="metricSeriesControls">
      <div className="metricSeriesControlsHead">
       <div><b>Показатели для сравнения</b><span>Выберите до {MAX_CHART_SERIES-1} дополнительных показателей.</span></div>
       {compare.length>0&&<button type="button" className="metricClearCompare" onClick={()=>{setCompare([]);setFocusedPoint(null)}}>Сбросить сравнение</button>}
      </div>
      <div className="metricSeriesToggleRow" aria-label="Выбор показателей для сравнения">
       <span className="metricSeriesPrimary" title="Основной показатель, всегда на графике"><i style={{background:METRIC_COLORS[0]}}/>{chosen.label}<span className="metricSeriesPinned">Основной</span></span>
       {comparisonOptions.map(m=>{
        const active=compare.includes(m.id);
        const disabled=!active&&comparisonLimitReached;
        const color=METRIC_COLORS[(1+comparisonOptions.findIndex(x=>x.id===m.id))%METRIC_COLORS.length];
        return <button key={m.id} type="button" className={'metricSeriesToggle '+(active?'active':'')} aria-pressed={active} disabled={disabled} title={disabled?'Для нового показателя сначала отключите одну из линий':active?'Скрыть '+m.label:'Показать '+m.label} onClick={()=>{setFocusedPoint(null);setCompare(list=>list.includes(m.id)?list.filter(id=>id!==m.id):list.length<MAX_CHART_SERIES-1?[...list,m.id]:list)}}>
         <i style={{background:active?color:'#b8c5dd'}}/><span>{m.label}</span>{active&&<span className="metricSeriesCheck" aria-hidden="true">✓</span>}
        </button>;
       })}
      </div>
      {comparisonLimitReached&&<p className="metricCompareLimit" role="status">Для добавления другого параметра сначала отключите одну из выбранных линий.</p>}
     </div>
    </section>
    <div className="metricHistoryList">
     <div className="metricHistoryHead"><b>Журнал показателя</b><span>{hist.length} записей</span></div>
     {[...hist].reverse().slice(0,showFullHistory?30:HISTORY_PREVIEW_COUNT).map(h=>{const p=h.source_id?politicalPosts.find(x=>x.id===h.source_id):undefined;return <article key={h.id}>
      <time>{new Date(h.recorded_at).toLocaleString('ru-RU')}</time>
      <div><b>{Number(h.previous_value??h.value).toLocaleString('ru-RU')} → {Number(h.value).toLocaleString('ru-RU')} {chosen.unit||''}</b><p>{h.note||p?.title||h.source_type}</p>{h.actor_id&&<small>{names[h.actor_id]||'Участник'}</small>}</div>
      <strong className={Number(h.delta)>=0?'up':'down'}>{Number(h.delta)>0?'+':''}{Number(h.delta||0).toFixed(1)}</strong>
     </article>})}
     {hist.length>HISTORY_PREVIEW_COUNT&&<button type="button" className="metricHistoryMore" onClick={()=>setShowFullHistory(v=>!v)}>{showFullHistory?'Свернуть журнал':`Показать ещё ${Math.min(hist.length,30)-HISTORY_PREVIEW_COUNT} записей`}</button>}
    </div>
    </div>
   </section>
  </div>}
 </>;
}
