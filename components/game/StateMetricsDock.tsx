'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Metric} from './types';

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

export default function StateMetricsDock({g}:{g:ReturnTypeRepublic}){
 const {metrics,metricHistory,teacher,politicalPosts,names}=g;
 const [selected,setSelected]=useState('');
 const [compare,setCompare]=useState<string[]>([]);
 const [bucket,setBucket]=useState<'changes'|'day'|'week'>('changes');
 const visible=useMemo(()=>[...metrics].filter(m=>teacher||m.is_public).sort((a,b)=>a.sort_order-b.sort_order),[metrics,teacher]);
 const chosen=metrics.find(m=>m.id===selected);
 const hist=chosen?metricHistory.filter(h=>h.metric_key===chosen.metric_key):[];
 function grouped(metricKey:string){
  const rows=metricHistory.filter(h=>h.metric_key===metricKey);
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
 const groupedHist=chosen?grouped(chosen.metric_key):[];
 const values=groupedHist.map(h=>Number(h.value));
 const path=spark(values,620,180);
 const compareMetrics=metrics.filter(m=>compare.includes(m.id));
 return <>
  <section className="metricDock" aria-label="Показатели состояния государства">
   <div className="metricDockScroll">{visible.map(m=>{const d=delta(m);return <button key={m.id} onClick={()=>setSelected(m.id)} className={selected===m.id?'active':''}>
    <small>{groupLabel(m.group_key)}</small><b>{m.label}</b><strong>{Number(m.value).toLocaleString('ru-RU')}{m.unit||''}</strong><em className={d>0?'up':d<0?'down':'flat'}>{d>0?'+':''}{d.toFixed(d%1?1:0)}</em>
   </button>})}</div>
  </section>

  {chosen&&<div className="metricModalBackdrop" onClick={()=>setSelected('')}>
   <section className="metricModal" onClick={e=>e.stopPropagation()}>
    <header><div><small>{groupLabel(chosen.group_key).toUpperCase()}</small><h2>{chosen.label}</h2><p>{chosen.description||'Игровой показатель состояния государства.'}</p></div><button onClick={()=>setSelected('')}>×</button></header>
    <div className="metricHeroValue"><strong>{Number(chosen.value).toLocaleString('ru-RU')}{chosen.unit||''}</strong><span className={delta(chosen)>=0?'up':'down'}>{delta(chosen)>=0?'+':''}{delta(chosen).toFixed(1)} с прошлого изменения</span></div>
    <div className="metricBucketTabs"><button className={bucket==='changes'?'active':''} onClick={()=>setBucket('changes')}>Все изменения</button><button className={bucket==='day'?'active':''} onClick={()=>setBucket('day')}>По дням</button><button className={bucket==='week'?'active':''} onClick={()=>setBucket('week')}>По неделям</button></div>
    <div className="metricChart">
     {values.length>1?<svg viewBox="0 0 620 180" role="img" aria-label={'Динамика '+chosen.label}><path d={path} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>:<div className="emptyState">Для графика нужно хотя бы два изменения.</div>}
    </div>
    <div className="metricHistoryList">
     <div className="metricHistoryHead"><b>История изменений</b><span>{hist.length}</span></div>
     {[...hist].reverse().slice(0,20).map(h=>{const p=h.source_id?politicalPosts.find(x=>x.id===h.source_id):undefined;return <article key={h.id}>
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