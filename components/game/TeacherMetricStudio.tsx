'use client';
import {useState} from 'react';
import {metricQuantity} from '@/lib/formatQuantity';
import {Activity,CheckCircle2,Newspaper,SlidersHorizontal} from 'lucide-react';
import StyledSelect from '../ui/StyledSelect';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
export default function TeacherMetricStudio({g,postId}:{g:ReturnTypeRepublic;postId?:string}){
 const {game,metrics,teacher}=g;
 const [selected,setSelected]=useState('');
 const metric=metrics.find(m=>m.id===selected)||metrics[0];
 const pendingBudget=metric?.metric_key==='budget'&&!g.budgetPulse;
 const [value,setValue]=useState('');
 const [reason,setReason]=useState('');
 const [broadcast,setBroadcast]=useState(false);
 const [title,setTitle]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 async function apply(){
  if(!metric||!game||!teacher||busy)return;
  const parsed=Number(value.replace(',','.'));
  if(!Number.isFinite(parsed)||value.trim()===''){setNotice('Укажите числовое значение показателя.');return}
  if((metric.min_value!==null&&parsed<metric.min_value)||(metric.max_value!==null&&parsed>metric.max_value)){setNotice('Значение вне разрешённого диапазона показателя.');return}
  if(!reason.trim()){setNotice('Добавьте короткое обоснование, чтобы изменение сохранилось в журнале.');return}
  setBusy(true);setNotice('');
  try{
   const r=postId?await supabase.rpc('set_post_state_metric',{p_post_id:postId,p_metric_id:metric.id,p_value:parsed,p_note:reason.trim()}):await supabase.rpc('set_state_metric_and_post',{p_metric_id:metric.id,p_value:parsed,p_note:reason.trim(),
    p_publish:broadcast,p_title:title.trim()||null});
   if(r.error)throw r.error;
   await g.refresh();setNotice(postId?'Изменение сохранено и связано с этой публикацией.':'Значение обновлено в базе и журнале.'+(broadcast?' Публикация появилась в Политическом процессе.':''));setValue('');setReason('');setTitle('');
  }catch(e){setNotice(e instanceof Error?e.message:'Не удалось изменить показатель.')}
  finally{setBusy(false)}
 }
 if(!teacher||!game)return null;
 return <section className="metricDirectorStudio">
  <header><div><small>Преподаватель · Показатели республики</small><h3>Корректировка показателей</h3><p>{postId?'Изменение сохранится в журнале и появится в этой публикации.':'Выберите показатель, установите значение и укажите основание. При необходимости опубликуйте связанное политическое событие.'}</p></div><SlidersHorizontal size={22}/></header>
  {!postId&&<div className="metricDirectorCards" aria-label="Выбрать показатель для корректировки">{metrics.map(m=><button type="button" key={m.id} className={metric?.id===m.id?'selected':''} disabled={m.metric_key==='budget'&&!g.budgetPulse} aria-pressed={metric?.id===m.id} onClick={()=>{setSelected(m.id);setValue(String(m.value));setNotice('')}}><span>{m.label}</span><strong>{m.metric_key==='budget'&&!g.budgetPulse?'…':metricQuantity(m.value,m.unit,m.metric_key)}</strong></button>)}</div>}
  <div className="metricDirectorGrid">
   <StyledSelect label="Показатель" value={metric?.id||''} onChange={id=>{setSelected(id);setValue('');setReason('')}} options={metrics.map(m=>({value:m.id,label:m.label}))}/>
   <label className="metricValueField">Текущее значение<span className="metricValueControl isCurrent"><input aria-label="Текущее значение" readOnly value={pendingBudget?'…':metric?.value??'—'}/><span>{metric?.unit}</span></span></label>
   <label className="metricValueField">Новое значение<span className="metricValueControl"><input aria-label="Новое значение" type="number" step="any" value={value} onChange={e=>setValue(e.target.value)} min={metric?.min_value??undefined} max={metric?.max_value??undefined} placeholder="Введите число"/><span>{metric?.unit}</span></span></label>
  </div>
  {metric?.metric_key==='budget'&&<p className="metricDirectorNotice">Доходы федерального бюджета — общий прогноз во вкладке «Бюджет». Введите сумму в миллионах рублей. Корректировка меняет доходы на ту же величину и записывается в финансовый журнал.</p>}
  <label className="metricDirectorReason">Обоснование<textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Что произошло и почему изменился показатель?"/></label>
  {!postId&&<label className="metricDirectorCheck"><input type="checkbox" checked={broadcast} onChange={e=>setBroadcast(e.target.checked)}/><Newspaper size={17}/> Опубликовать политическое событие одновременно с корректировкой</label>}
  {!postId&&broadcast&&<label className="metricDirectorReason">Заголовок публикации<input value={title} onChange={e=>setTitle(e.target.value)} placeholder={'Изменение показателя: '+(metric?.label||'')}/></label>}
  <button type="button" className="primary" disabled={busy||pendingBudget||!metric||!reason.trim()||!value.trim()} onClick={()=>void apply()}><Activity size={17}/>{busy?'Сохраняется…':'Применить изменение'}</button>
  {notice&&<p role="status" className="metricDirectorNotice"><CheckCircle2 size={16}/>{notice}</p>}
 </section>;
}
