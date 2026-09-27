'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Metric} from './types';

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
 if(k==='public_trust')return '◉';
 if(k==='economy')return '⌁';
 if(k==='budget')return '₽';
 if(k==='social_stability')return '≈';
 if(k==='lawfulness')return '§';
 if(k==='international_standing')return '◎';
 if(k==='elite_support')return '◆';
 if(k==='security')return '◇';
 if(k==='social_tension')return '!';
 if(k==='media_climate')return '◌';
 if(k==='legitimacy')return '◈';
 return '•';
}

export default function StateMetricsDock({g}:{g:ReturnTypeRepublic}){
 const {metrics,metricHistory,teacher,politicalPosts,names}=g;
 const [selected,setSelected]=useState('');
 const [compare,setCompare]=useState<string[]>([]);
 const [bucket,setBucket]=useState<'changes'|'day'|'week'>('changes');
 const [more,setMore]=useState(false);
 const allowed=useMemo(()=>[...metrics].filter(m=>teacher||m.is_public).sort((a,b)=>a.sort_order-b.sort_order),[metrics,teacher]);
 const primary=PRIMARY.map(k=>allowed.find(m=>m.metric_key===k)).filter(Boolean) as Metric[];
 const secondary=allowed.filter(m=>!PRIMARY.includes(m.metric_key));
 const chosen=metrics.find(m=>m.id===selected);

 function rowsFor(metricKey:string){return metricHistory.filter(h=>h.metric_key===metricKey)}
 function grouped(metricKey:string){
  const rows=rowsFor(metricKey);
  if(bucket==='changes')return rows;
  const map=new Map<string,typeof rows[number]>();
  for(const h of rows){
   const d=new Date(h.recorded_at);
   let key='';
   if(bucket==='day')key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
   else{
    const t=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    const day=(t.getDay()+6)%7;t.setDate(t.getDate()-day);
    key=t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
   }
   map.set(key,h);
  }
  return [...map.values()];
 }
 const hist=chosen?rowsFor(chosen.metric_key):[];
 const groupedHist=chosen?grouped(chosen.metric_key):[];
 const values=groupedHist.map(h=>Number(h.value));
 const path=spark(values,620,180);
 const compareMetrics=metrics.filter(m=>compare.includes(m.id));

 function card(m:Metric){
  const d=delta(m);
  const rows=rowsFor(m.metric_key);
  const mini=rows.slice(-12).map(h=>Number(h.value));
  const last=rows.at(-1);
  const pct=m.max_value!=null&&m.min_value!=null?Math.max(0,Math.min(100,(Number(m.value)-Number(m.min_value))/Math.max(1,Number(m.max_value)-Number(m.min_value))*100)):null;
  return <button key={m.id} className={'statePulseMetric '+m.group_key} onClick={()=>setSelected(m.id)}>
   <span className="statePulseIcon">{metricIcon(m.metric_key)}</span>
   <div className="statePulseCopy"><small>{groupLabel(m.group_key)}</small><b>{m.label}</b><span>{last?.note||m.description||'Игровой показатель'}</span></div>
   <div className="statePulseValue"><strong>{Number(m.value).toLocaleString('ru-RU')}{m.unit||''}</strong><em className={changeTone(m,d)}>{d>0?'▲ +':d<0?'▼ ':'• '}{Math.abs(d).toFixed(Math.abs(d)%1?1:0)}</em></div>
   <div className="statePulseTrend">
    {mini.length>1&&<svg viewBox="0 0 120 32" aria-hidden="true"><path d={spark(mini,120,32)} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg>}
    {pct!=null&&<i><span style={{width:pct+'%'}}/></i>}
   </div>
  </button>;
 }

 return <>
  <section className="statePulseDock" aria-label="Состояние государства">
   <div className="statePulseTop">
    <div><small>СОСТОЯНИЕ ГОСУДАРСТВА · LIVE</small><b>Последствия решений видны сразу</b></div>
    {secondary.length>0&&<button className={more?'active':''} onClick={()=>setMore(v=>!v)}>{more?'Скрыть':'Ещё показатели'} <span>{secondary.length}</span></button>}
   </div>
   <div className="statePulseGrid">{primary.map(card)}</div>
   {more&&<div className="statePulseSecondary">{secondary.map(card)}</div>}
  </section>

  {chosen&&<div className="metricModalBackdrop" onClick={()=>setSelected('')}>
   <section className="metricModal redesigned" onClick={e=>e.stopPropagation()}>
    <header><div className="metricModalTitle"><span>{metricIcon(chosen.metric_key)}</span><div><small>{groupLabel(chosen.group_key).toUpperCase()}</small><h2>{chosen.label}</h2><p>{chosen.description||'Игровой показатель состояния государства.'}</p></div></div><button onClick={()=>setSelected('')}>×</button></header>
    <div className="metricHeroValue"><strong>{Number(chosen.value).toLocaleString('ru-RU')}{chosen.unit||''}</strong><span className={changeTone(chosen,delta(chosen))}>{delta(chosen)>=0?'▲ +':'▼ '}{Math.abs(delta(chosen)).toFixed(1)} с прошлого изменения</span></div>
    {hist.at(-1)&&<div className="metricLastCause"><small>ПОСЛЕДНЯЯ ПРИЧИНА</small><b>{hist.at(-1)?.note||hist.at(-1)?.source_type}</b><span>{new Date(hist.at(-1)!.recorded_at).toLocaleString('ru-RU')}</span></div>}
    <div className="metricBucketTabs"><button className={bucket==='changes'?'active':''} onClick={()=>setBucket('changes')}>Все изменения</button><button className={bucket==='day'?'active':''} onClick={()=>setBucket('day')}>По дням</button><button className={bucket==='week'?'active':''} onClick={()=>setBucket('week')}>По неделям</button></div>
    <div className="metricChart">
     {values.length>1?<svg viewBox="0 0 620 180" role="img" aria-label={'Динамика '+chosen.label}><path d={path} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>:<div className="emptyState">Для графика нужно хотя бы два изменения.</div>}
    </div>
    <div className="metricHistoryList">
     <div className="metricHistoryHead"><b>Почему менялся показатель</b><span>{hist.length} записей</span></div>
     {[...hist].reverse().slice(0,30).map(h=>{const p=h.source_id?politicalPosts.find(x=>x.id===h.source_id):undefined;return <article key={h.id}>
      <time>{new Date(h.recorded_at).toLocaleString('ru-RU')}</time>
      <div><b>{Number(h.previous_value??h.value).toLocaleString('ru-RU')} → {Number(h.value).toLocaleString('ru-RU')} {chosen.unit||''}</b><p>{h.note||p?.title||h.source_type}</p>{h.actor_id&&<small>{names[h.actor_id]||'Участник'}</small>}</div>
      <strong className={Number(h.delta)>=0?'up':'down'}>{Number(h.delta)>0?'+':''}{Number(h.delta||0).toFixed(1)}</strong>
     </article>})}
    </div>
    {teacher&&<details className="metricCompare">
     <summary>Сравнить с другими показателями</summary>
     <div className="metricComparePicker">{metrics.filter(m=>m.id!==chosen.id).map(m=><label key={m.id}><input type="checkbox" checked={compare.includes(m.id)} onChange={e=>setCompare(x=>e.target.checked?[...x,m.id]:x.filter(id=>id!==m.id))}/>{m.label}</label>)}</div>
     {compareMetrics.length>0&&<div className="metricCompareRows">{[chosen,...compareMetrics].map(m=>{const hh=grouped(m.metric_key).map(h=>Number(h.value));return <div key={m.id}><b>{m.label}</b><span>{Number(m.value).toLocaleString('ru-RU')}{m.unit||''}</span><svg viewBox="0 0 220 64"><path d={spark(hh)} fill="none" stroke="currentColor" strokeWidth="3"/></svg></div>})}</div>}
    </details>}
   </section>
  </div>}
 </>;
}