'use client';
import {useState} from 'react';
import {Activity,CheckCircle2,Newspaper,SlidersHorizontal} from 'lucide-react';
import StyledSelect from '../ui/StyledSelect';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
export default function TeacherMetricStudio({g}:{g:ReturnTypeRepublic}){
 const {game,metrics,teacher}=g;
 const [selected,setSelected]=useState('');
 const metric=metrics.find(m=>m.id===selected)||metrics[0];
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
   const r=await supabase.rpc('set_state_metric_and_post',{p_metric_id:metric.id,p_value:parsed,p_note:reason.trim(),
    p_publish:broadcast,p_title:title.trim()||null});
   if(r.error)throw r.error;
   await g.refresh();setNotice('Значение обновлено в базе и журнале.'+(broadcast?' Публикация появилась в Политических процессах.':''));setValue('');setReason('');setTitle('');
  }catch(e){setNotice(e instanceof Error?e.message:'Не удалось изменить показатель.')}
  finally{setBusy(false)}
 }
 if(!teacher||!game)return null;
 return <section className="metricDirectorStudio">
  <header><div><small>РЕЖИССЁР · РЕЙТИНГИ РЕСПУБЛИКИ</small><h3>Ручная корректировка показателей</h3><p>Выберите показатель, установите значение и укажите основание. При необходимости опубликуйте связанное политическое событие.</p></div><SlidersHorizontal size={22}/></header>
  <div className="metricDirectorCards" aria-label="Выбрать показатель для корректировки">{metrics.map(m=><button type="button" key={m.id} className={metric?.id===m.id?'selected':''} aria-pressed={metric?.id===m.id} onClick={()=>{setSelected(m.id);setValue(String(m.value));setNotice('')}}><span>{m.label}</span><strong>{m.value} {m.unit}</strong></button>)}</div>
  <div className="metricDirectorGrid">
   <StyledSelect label="Показатель" value={metric?.id||''} onChange={id=>{setSelected(id);setValue('');setReason('')}} options={metrics.map(m=>({value:m.id,label:m.label}))}/>
   <div className="metricDirectorValue"><small>Текущее значение</small><strong>{metric?metric.value+' '+(metric.unit||''):'—'}</strong></div>
   <label>Новое значение<input type="number" value={value} onChange={e=>setValue(e.target.value)} min={metric?.min_value??undefined} max={metric?.max_value??undefined} placeholder="Введите число"/></label>
  </div>
  <label className="metricDirectorReason">Обоснование<textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Что произошло и почему изменился показатель?"/></label>
  <label className="metricDirectorCheck"><input type="checkbox" checked={broadcast} onChange={e=>setBroadcast(e.target.checked)}/><Newspaper size={17}/> Опубликовать политическое событие одновременно с корректировкой</label>
  {broadcast&&<label className="metricDirectorReason">Заголовок публикации<input value={title} onChange={e=>setTitle(e.target.value)} placeholder={'Изменение показателя: '+(metric?.label||'')}/></label>}
  <button type="button" className="primary" disabled={busy||!metric||!reason.trim()||!value.trim()} onClick={()=>void apply()}><Activity size={17}/>{busy?'Сохраняется…':'Применить изменение'}</button>
  {notice&&<p role="status" className="metricDirectorNotice"><CheckCircle2 size={16}/>{notice}</p>}
 </section>;
}
