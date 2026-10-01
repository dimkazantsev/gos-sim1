import {Newspaper} from 'lucide-react';
import {changeNumber,recordedPostChanges} from './PostChanges';
import type {ReturnTypeRepublic} from './viewTypes';
import type {PoliticalPost} from './types';
export default function RatingNewsVisual({g,post}:{g:ReturnTypeRepublic;post:PoliticalPost}){
 const changes=recordedPostChanges(g,post);if(!changes.length)return null;
 return <figure className="ratingNewsVisual"><figcaption><Newspaper size={20}/><span>СМИ Республики · Изменения показателей</span></figcaption>{changes.slice(0,3).map(c=>{
  const min=Math.min(0,c.previous,c.current),max=Math.max(1,c.previous,c.current),x=(n:number)=>24+(n-min)/(max-min)*352;
  return <div className="ratingVisualRow" key={c.key}><div><span>{c.label}</span><strong className={c.delta>0?'up':'down'}>{c.delta>0?'+':''}{changeNumber(c.delta)} {c.unit==='%'?'п.п.':c.unit}</strong></div><svg viewBox="0 0 400 48" role="img" aria-label={c.label+': '+changeNumber(c.previous)+' → '+changeNumber(c.current)+' '+c.unit}><title>Текущее и предыдущее значение на общей шкале</title><line x1="24" x2="376" y1="24" y2="24" stroke="#dbe4f0" strokeWidth="8" strokeLinecap="round"/><line x1={x(c.previous)} x2={x(c.current)} y1="24" y2="24" stroke="#2453e6" strokeWidth="8"/><circle cx={x(c.previous)} cy="24" r="8" fill="#8196b2" stroke="white" strokeWidth="3"/><circle cx={x(c.current)} cy="24" r="10" fill="#2453e6" stroke="white" strokeWidth="3"/></svg><div className="ratingVisualValues"><span>Было <b>{changeNumber(c.previous)} {c.unit}</b></span><span>Стало <b>{changeNumber(c.current)} {c.unit}</b></span></div></div>;
 })}{changes.length>3&&<small>Ещё изменений: {changes.length-3}</small>}</figure>;
}
