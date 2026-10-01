import {ArrowRight,TrendingUp} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {PoliticalPost} from './types';
export type RecordedPostChange={key:string;label:string;previous:number;current:number;delta:number;unit:string};
export function recordedPostChanges(g:ReturnTypeRepublic,post:PoliticalPost):RecordedPostChange[]{
 const grouped=new Map<string,RecordedPostChange>();
 const records=[...g.metricHistory].filter(h=>h.source_id===post.id&&Number(h.delta)!==0).sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at)||a.id-b.id);
 for(const h of records){
  const m=g.metrics.find(m=>m.metric_key===h.metric_key);if(!m||!g.teacher&&!m.is_public)continue;
  const old=grouped.get(m.metric_key),previous=old?.previous??Number(h.previous_value),current=Number(h.value);
  grouped.set(m.metric_key,{key:m.metric_key,label:m.label,previous,current,delta:current-previous,unit:m.unit||''});
 }
 for(const h of [...g.partySupportHistory].filter(h=>h.source_id===post.id&&Number(h.delta)!==0).sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at)||a.id-b.id)){
  const p=g.parties.find(p=>p.id===h.party_id);if(!p)continue;const key='party:'+p.id,old=grouped.get(key),previous=old?.previous??Number(h.previous_value),current=Number(h.value);
  grouped.set(key,{key,label:'Поддержка партии «'+p.name+'»',previous,current,delta:current-previous,unit:'%'});
 }
 if(!grouped.size&&Array.isArray(post.context?.rating_changes))for(const raw of post.context.rating_changes){
  if(!raw||typeof raw!=='object')continue;const c=raw as Record<string,unknown>;
  if(typeof c.key!=='string'||typeof c.label!=='string'||!Number.isFinite(Number(c.previous))||!Number.isFinite(Number(c.current)))continue;
  const previous=Number(c.previous),current=Number(c.current);
  grouped.set(c.key,{key:c.key,label:c.label,previous,current,delta:current-previous,unit:String(c.unit||'')});
 }
 return [...grouped.values()].filter(c=>Number.isFinite(c.delta)&&c.delta!==0);
}
export function changeNumber(n:number){return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n)}
export default function PostChanges({g,post}:{g:ReturnTypeRepublic;post:PoliticalPost}){
 const changes=recordedPostChanges(g,post);if(!changes.length)return null;
 return <section className="processRecordedChanges"><h3><TrendingUp size={17}/>Зафиксированные изменения</h3><div>{changes.map(c=><article key={c.key}><span>{c.label}</span><div><b>{changeNumber(c.previous)}</b><ArrowRight size={16}/><strong>{changeNumber(c.current)} {c.unit}</strong><em className={c.delta>0?'up':'down'}>{c.delta>0?'+':''}{changeNumber(c.delta)}{c.unit==='%'?' п.п.':' '+c.unit}</em></div></article>)}</div></section>;
}
