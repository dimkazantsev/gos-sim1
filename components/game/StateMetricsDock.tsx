'use client';
import {useMemo,useState} from 'react';
import {Check} from 'lucide-react';
import {Activity,BadgeCheck,Globe2,Handshake,HeartHandshake,MessageSquare,Scale,ShieldCheck,TrendingUp,UsersRound,Wallet} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Metric} from './types';
import {drawMetricChart,METRIC_COLORS,pointsForMetric} from './metricChart';

const PRIMARY=['public_trust','economy','budget','social_stability','lawfulness','international_standing'];

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

export default function StateMetricsDock({g}:{g:ReturnTypeRepublic}){
 const {game,metrics,metricHistory,teacher,politicalPosts,names}=g;
 const [selected,setSelected]=useState('');
 const dialogRef=useDialog(!!selected,()=>setSelected(''));
 const [compare,setCompare]=useState<string[]>([]);
 const [bucket,setBucket]=useState<'changes'|'day'|'week'>('changes');
 const allowed=useMemo(()=>[...metrics].filter(m=>teacher||m.is_public).sort((a,b)=>a.sort_order-b.sort_order),[metrics,teacher]);
 const primary=PRIMARY.map(k=>allowed.find(m=>m.metric_key===k)).filter(Boolean) as Metric[];
 const secondary=allowed.filter(m=>!PRIMARY.includes(m.metric_key));
 const visibleMetrics=[...primary,...secondary];
 const chosen=allowed.find(m=>m.id===selected);

 function rowsFor(metricKey:string){return metricHistory.filter(h=>h.metric_key===metricKey)}
 const hist=chosen?rowsFor(chosen.metric_key).sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at)):[];
 const comparisonOptions=visibleMetrics.filter(m=>m.id!==chosen?.id);
 const activeMetrics=chosen?[chosen,...comparisonOptions.filter(m=>compare.includes(m.id))]:[];
 const snapshotAt=useMemo(()=>Date.now(),[selected]);
 const series=activeMetrics.map((metric,index)=>({
  metric,
  color:METRIC_COLORS[index%METRIC_COLORS.length],
  points:pointsForMetric(metric,metricHistory,bucket,game?.created_at,snapshotAt)
 }));
 const geometry=drawMetricChart(series);
 const chosenPoints=series[0]?.points||[];
 const singlePoint=geometry.lines.length===1&&chosenPoints.length===1;
 const formatValue=(v:number,unit:string|null)=>v.toLocaleString('ru-RU',{maximumFractionDigits:2})+(unit||'');
 const formatTime=(timestamp:number)=>new Date(timestamp).toLocaleString('ru-RU',{
  day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
 });

 function card(m:Metric){
  const d=delta(m);
  const rows=rowsFor(m.metric_key);
  const mini=rows.slice(-12).map(h=>Number(h.value));
  const last=rows.at(-1);
  const pct=m.max_value!=null&&m.min_value!=null?Math.max(0,Math.min(100,(Number(m.value)-Number(m.min_value))/Math.max(1,Number(m.max_value)-Number(m.min_value))*100)):null;
  return <button key={m.id} className={'statePulseMetric '+m.group_key+' metric-'+m.metric_key} onClick={()=>{setCompare([]);setBucket('changes');setSelected(m.id)}}>
   <span className="statePulseIcon" aria-hidden="true">{metricIcon(m.metric_key)}</span>
   <div className="statePulseCopy"><small>{groupLabel(m.group_key)}</small><b>{m.label}</b><span>{last?.note||m.description||'Игровой показатель'}</span></div>
   <div className="statePulseValue"><strong>{Number(m.value).toLocaleString('ru-RU')}{m.unit||''}</strong><em className={changeTone(m,d)}>{d===0?'—':`${d>0?'▲ +':'▼ '}${Math.abs(d).toFixed(Math.abs(d)%1?1:0)}`}</em></div>
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
    <header><div className="metricModalTitle"><span>{metricIcon(chosen.metric_key)}</span><div><small>{groupLabel(chosen.group_key).toUpperCase()}</small><h2 id="metric-title">{chosen.label}</h2><p>{chosen.description||'Игровой показатель состояния государства.'}</p></div></div><button onClick={()=>setSelected('')} aria-label="Закрыть показатель">×</button></header>
    <div className="metricHeroValue"><strong>{Number(chosen.value).toLocaleString('ru-RU')}{chosen.unit||''}</strong><span className={changeTone(chosen,delta(chosen))}>{delta(chosen)>=0?'▲ +':'▼ '}{Math.abs(delta(chosen)).toFixed(1)} с прошлого изменения</span></div>
    {hist.at(-1)&&<div className="metricLastCause"><small>ПОСЛЕДНЯЯ ПРИЧИНА</small><b>{hist.at(-1)?.note||hist.at(-1)?.source_type}</b><span>{new Date(hist.at(-1)!.recorded_at).toLocaleString('ru-RU')}</span></div>}
    <div className="metricBucketTabs"><button className={bucket==='changes'?'active':''} onClick={()=>setBucket('changes')}>Все изменения</button><button className={bucket==='day'?'active':''} onClick={()=>setBucket('day')}>По дням</button><button className={bucket==='week'?'active':''} onClick={()=>setBucket('week')}>По неделям</button></div>
    <div className="metricChart redesignedChart">
     <div className="metricChartCaption"><b>{geometry.comparing?'Динамика показателей':'История показателя'}</b><span>{bucket==='changes'?'По игровым событиям':bucket==='day'?'По дням':'По неделям'}</span></div>
     <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-label={'Временной график: '+activeMetrics.map(m=>m.label).join(', ')}>
      {geometry.yTicks.map((tick,i)=><g key={i}>
       <line className="metricGridLine" x1={geometry.left} x2={geometry.width-geometry.right} y1={tick.y} y2={tick.y}/>
       <text className="metricAxisText" x={geometry.left-8} y={tick.y+4} textAnchor="end">{geometry.comparing?tick.value+'%':tick.value.toLocaleString('ru-RU',{maximumFractionDigits:1})}</text>
      </g>)}
      {geometry.xTicks.map((tick,i)=><g key={i}>
       <line className="metricDateLine" x1={tick.x} x2={tick.x} y1={geometry.top} y2={geometry.height-geometry.bottom}/>
       <text className="metricAxisText" x={tick.x} y={geometry.height-12} textAnchor={i===0&&geometry.xTicks.length>1?'start':i===geometry.xTicks.length-1&&geometry.xTicks.length>1?'end':'middle'}>{new Date(tick.at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}</text>
      </g>)}
      {geometry.lines.map(line=><g key={line.metric.id} style={{color:line.color}}>
       {line.pointsOnChart.length>1&&<path d={line.path} className="metricSeriesPath" stroke="currentColor"/>}
       {line.pointsOnChart.length===1&&<line x1={geometry.left} x2={geometry.width-geometry.right} y1={line.pointsOnChart[0].y} y2={line.pointsOnChart[0].y} className="metricSingleGuide" stroke="currentColor"/>}
       {line.pointsOnChart.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={4.5} className="metricChartPoint" fill="currentColor" stroke="#fff" strokeWidth="2"><title>{line.metric.label}: {formatValue(p.value,line.metric.unit)}. {formatTime(p.at)}. {p.note}</title></circle>)}
      </g>)}
     </svg>
     <div className="metricChartLegend" aria-label="Показатели на графике">
      {series.map(s=><span key={s.metric.id}><i style={{background:s.color}}/>{s.metric.label}</span>)}
     </div>
     {singlePoint&&<p className="metricChartNotice">{chosenPoints[0].kind==='snapshot'?'Показано текущее значение. Записи об изменениях пока отсутствуют.':'Показана исходная точка. Линия динамики появится после первого изменения.'}</p>}
     {geometry.comparing&&<p className="metricChartNotice">Сравнение: каждая линия приведена к своей шкале 0–100%. Для бюджета используется диапазон зафиксированных значений. Точные значения доступны при наведении на точки.</p>}
    </div>
    <div className="metricSeriesControls">
     <div className="metricSeriesControlsHead"><b>Добавить показатели на график</b><span>Включайте и выключайте параметры. Начальная метрика всегда видна.</span></div>
     <div className="metricSeriesToggleRow">
      {comparisonOptions.map((m,i)=>{
       const active=compare.includes(m.id);
       const color=METRIC_COLORS[(1+comparisonOptions.filter(x=>compare.includes(x.id)).findIndex(x=>x.id===m.id))%METRIC_COLORS.length];
       return <button key={m.id} type="button" className={'metricSeriesToggle '+(active?'active':'')} aria-pressed={active} onClick={()=>setCompare(list=>list.includes(m.id)?list.filter(id=>id!==m.id):[...list,m.id])}>
        <i style={{background:active?color:'#bbc6dc'}}/><span>{m.label}</span>{active&&<Check size={14} aria-hidden="true"/>}
       </button>;
      })}
     </div>
    </div>
    <div className="metricHistoryList">
     <div className="metricHistoryHead"><b>Почему менялся показатель</b><span>{hist.length} записей</span></div>
     {[...hist].reverse().slice(0,30).map(h=>{const p=h.source_id?politicalPosts.find(x=>x.id===h.source_id):undefined;return <article key={h.id}>
      <time>{new Date(h.recorded_at).toLocaleString('ru-RU')}</time>
      <div><b>{Number(h.previous_value??h.value).toLocaleString('ru-RU')} → {Number(h.value).toLocaleString('ru-RU')} {chosen.unit||''}</b><p>{h.note||p?.title||h.source_type}</p>{h.actor_id&&<small>{names[h.actor_id]||'Участник'}</small>}</div>
      <strong className={Number(h.delta)>=0?'up':'down'}>{Number(h.delta)>0?'+':''}{Number(h.delta||0).toFixed(1)}</strong>
     </article>})}
    </div>

   </section>
  </div>}
 </>;
}