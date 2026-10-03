import type {Metric,MetricHistory} from './types';

/** Dates on this chart are real timestamps from the metric event journal. */
export type MetricBucket='changes'|'day'|'week';
export type MetricPoint={
 at:number;
 value:number;
 kind:'baseline'|'change'|'snapshot';
 note:string;
};
export type MetricSeries={metric:Metric;color:string;points:MetricPoint[]};
export type ChartPoint=MetricPoint&{x:number;y:number};
export type DrawnMetricSeries=MetricSeries&{pointsOnChart:ChartPoint[];path:string;domain:[number,number]};
export type MetricChartGeometry={
 width:number;height:number;left:number;right:number;top:number;bottom:number;
 lines:DrawnMetricSeries[];
 xTicks:{at:number;x:number}[];
 yTicks:{value:number;y:number}[];
 comparing:boolean;
};

export const METRIC_COLORS=['#4169C9','#C26496','#318475','#956DCC','#BA8743','#4C91AB','#BF6471','#798EBC','#976BA3','#4E9369','#B07D56'];
const parseTime=(s:string|null|undefined)=>s?Date.parse(s):NaN;
const between=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const weekStartUTC=(t:number)=>{
 const d=new Date(t);
 const day=(d.getUTCDay()+6)%7;
 d.setUTCDate(d.getUTCDate()-day);
 return d.toISOString().slice(0,10);
};
const bucketKey=(t:number,bucket:MetricBucket)=>bucket==='day'
 ?new Date(t).toISOString().slice(0,10)
 :weekStartUTC(t);

/** Never invent a historical event: a baseline from before the first known
    change is explicitly marked as reconstructed, and an unlogged value as a
    current snapshot. */
export function pointsForMetric(
 metric:Metric,
 history:MetricHistory[],
 bucket:MetricBucket='changes',
 gameCreatedAt?:string|null,
 snapshotAt=Date.now()
):MetricPoint[]{
 const rows=history
  .filter(h=>h.metric_key===metric.metric_key&&Number.isFinite(parseTime(h.recorded_at))&&Number.isFinite(Number(h.value)))
  .sort((a,b)=>parseTime(a.recorded_at)-parseTime(b.recorded_at)||a.id-b.id);
 if(!rows.length){
  return [{at:snapshotAt,value:Number(metric.value),kind:'snapshot',note:'Текущее значение; история изменений ещё не записана'}];
 }
 const first=rows[0];
 const firstAt=parseTime(first.recorded_at);
 const firstIsBaseline=first.source_type==='baseline';
 const gameStart=parseTime(gameCreatedAt);
 const initialAt=firstIsBaseline?firstAt:
  Number.isFinite(gameStart)&&gameStart<=firstAt?gameStart:firstAt;
 const initialValue=firstIsBaseline?Number(first.value):
  first.previous_value!=null?Number(first.previous_value):Number(first.value);
 const points:MetricPoint[]=[{
  at:initialAt,value:initialValue,kind:'baseline',
  note:firstIsBaseline?(first.note||'Начальное значение показателя'):
   first.previous_value!=null?'Значение до первого зафиксированного изменения (восстановлено)':
   'Первая доступная запись; более ранних данных нет'
 }];
 let previous=initialValue;
 for(let i=firstIsBaseline?1:0;i<rows.length;i++){
  const h=rows[i];
  const value=Number(h.value);
  if(value!==previous){
   points.push({at:parseTime(h.recorded_at),value,kind:'change',note:h.note||'Изменение показателя'});
   previous=value;
  }
 }
 // A snapshot is useful if an old game has a metric that changed without an
 // associated history record. It must never be presented as an event.
 if(Number(metric.value)!==previous && Number.isFinite(Number(metric.value))){
  points.push({
   at:Math.max(snapshotAt,points.at(-1)!.at),value:Number(metric.value),
   kind:'snapshot',note:'Текущее значение; событие не найдено в журнале'
  });
 }
 if(bucket==='changes')return points;
 const grouped=new Map<string,MetricPoint>();
 for(const p of points.slice(1))grouped.set(bucketKey(p.at,bucket),p);
 return [points[0],...grouped.values()].sort((a,b)=>a.at-b.at);
}

/** When comparing unlike units, percentages use their declared limits,
    while unbounded metrics (e.g. budget) use their observed range. */
export function metricDomain(metric:Metric,points:MetricPoint[],comparing:boolean):[number,number]{
 const min=Number(metric.min_value),max=Number(metric.max_value);
 if(metric.min_value!=null&&metric.max_value!=null&&Number.isFinite(min)&&Number.isFinite(max)&&max>min){
  return [min,max];
 }
 const values=points.map(p=>p.value).filter(Number.isFinite);
 const low=Math.min(...values),high=Math.max(...values);
 if(!Number.isFinite(low)||!Number.isFinite(high))return [0,1];
 const padding=Math.max((high-low)*.12,Math.abs(high)*.05,.5);
 return [low-padding,high+padding];
}

export function drawMetricChart(
 series:MetricSeries[],
 comparing=series.length>1,
 width=700,height=230,leftInset=52
):MetricChartGeometry{
 const left=leftInset,right=18,top=18,bottom=40;
 const dates=series.flatMap(s=>s.points.map(p=>p.at));
 const minTime=dates.length?Math.min(...dates):0;
 const maxTime=dates.length?Math.max(...dates):0;
 const span=maxTime-minTime;
 const plotWidth=width-left-right;
 const plotHeight=height-top-bottom;
 const x=(at:number)=>span===0?left+plotWidth/2:left+(at-minTime)/span*plotWidth;
 const scale=(v:number,domain:[number,number])=>{
  const proportion=between((v-domain[0])/(domain[1]-domain[0]),0,1);
  return comparing?proportion:proportion;
 };
 const drawn=series.map(s=>{
  const domain=metricDomain(s.metric,s.points,comparing);
  const pointsOnChart=s.points.map(p=>({...p,x:x(p.at),y:top+(1-scale(p.value,domain))*plotHeight}));
  const path=pointsOnChart.map((p,i)=>i===0
   ?`M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
   :`H ${p.x.toFixed(2)} V ${p.y.toFixed(2)}`).join(' ');
  return {...s,domain,pointsOnChart,path};
 });
 const ticks=[...new Set(dates)].sort((a,b)=>a-b);
 const indices=ticks.length<=4?ticks.map((_,i)=>i):
  [0,Math.round((ticks.length-1)/3),Math.round((ticks.length-1)*2/3),ticks.length-1];
 const xTicks=indices.map(i=>({at:ticks[i],x:x(ticks[i])})).filter(t=>t.at!==undefined);
 const mainDomain=drawn[0]?.domain||[0,100];
 const yTicks=Array.from({length:5},(_,i)=>{
  const ratio=i/4;
  return {value:comparing?Math.round((1-ratio)*100):mainDomain[0]+(1-ratio)*(mainDomain[1]-mainDomain[0]),y:top+ratio*plotHeight};
 });
 return {width,height,left,right,top,bottom,lines:drawn,xTicks,yTicks,comparing};
}
