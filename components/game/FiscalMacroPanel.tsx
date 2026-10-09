'use client';
import {useEffect,useState} from 'react';
import {Gauge,Save} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {quantity,moneyMillions} from '@/lib/formatQuantity';
import {fiscalEnvironment,type FiscalContext} from './fiscalMath';
import type {ReturnTypeRepublic} from './viewTypes';
const fields=[['key_rate','Ключевая ставка','% годовых'],['fx_rate','Базовый курс рубля','₽ за 1 доллар'],['oil_price','Цена нефти','долларов за баррель'],['cutoff_price','Цена отсечения','долларов за баррель'],['inflation','Инфляция','% в год'],['federal_expenditure','Федеральные обязательства','млн ₽'],['municipal_expenditure','Местные обязательства','млн ₽']] as const;
export default function FiscalMacroPanel({g,context,readOnly,onSaved}:{g:ReturnTypeRepublic;context:FiscalContext|null;readOnly:boolean;onSaved:()=>Promise<void>}){
 const [draft,setDraft]=useState<Record<string,string>>({}),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(context)setDraft(Object.fromEntries(fields.map(([key])=>[key,String(context.policy[key])])));},[context?.policy.updated_at]);
 if(!context)return <p role="status">Загружаются общие параметры бюджетного сценария…</p>;
 const p=context.policy,environment=fiscalEnvironment(context),canEdit=!readOnly&&(g.teacher||context.can_change_rate);
 async function save(){
  if(!g.game||!context||busy)return;
  const changedFields=fields.filter(([key])=>(g.teacher||key==='key_rate')&&draft[key]!==String(context.policy[key]));
  if(!changedFields.length){setError('Измените хотя бы один параметр.');return}
  if(changedFields.some(([key])=>!draft[key]?.trim()||!Number.isFinite(Number(draft[key])))){setError('Заполните изменённые параметры числовыми значениями.');return}
  if(reason.trim().length<8){setError('Укажите основание решения: не менее 8 символов.');return}
  const changed=Object.fromEntries(changedFields.map(([key])=>[key,Number(draft[key])]));
  setBusy(true);
  try{const r=await supabase.rpc('set_fiscal_policy',{p_game_id:g.game.id,p_values:changed,p_reason:reason.trim()});if(r.error)setError(userError(r.error));else{setError('');setReason('');await onSaved()}}catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 return <section className="surface fiscalMacroPanel"><header><Gauge size={24}/><div><h2>Экономические условия</h2><p>Общий сценарий для всей группы. Решения органов власти и события изменяют макроэкономические показатели и пересчитывают доходы, расходы и долговые обязательства.</p></div></header>
 <div className="fiscalMacroStats">{[['Ключевая ставка',quantity(p.key_rate,'% годовых')],['Расчётный курс',quantity(environment.fx,'₽ за 1 доллар')],['Нефть',quantity(p.oil_price,'долларов за баррель')],['Цена отсечения',quantity(p.cutoff_price,'долларов за баррель')],['Инфляция',quantity(p.inflation,'% в год')],['Деловая активность',quantity(environment.activity*100,'% от исходного уровня')]].map(([label,value])=><article key={label}><span>{label}</span><b>{value}</b></article>)}</div>
 <details><summary>Как читать эти показатели</summary><p>Чем дороже кредит, тем слабее расчётная активность бизнеса и выше обслуживание долга. Доверие и экономический индекс влияют на активность и курс; инфляция — на стоимость обязательств. Для добывающих регионов учитываются нефть и курс.</p><p>При цене нефти выше отсечения разница показывает условие для бюджетного правила. Само изъятие нефтегазовых доходов оформляется в сценарии этапа 13; здесь оно не списывается автоматически.</p><p>Диапазон доходов и расходов — сценарий «хуже / лучше», а не статистический доверительный интервал. Все коэффициенты модели раскрыты в справке ниже.</p></details>
 {canEdit&&<details className="fiscalMacroEditor"><summary>{g.teacher?'Изменить макроэкономические показатели':'Решение Банка России о ключевой ставке'}</summary><div className="fiscalMacroFields">{fields.filter(([key])=>g.teacher||key==='key_rate').map(([key,label,unit])=><label key={key}>{label}, {unit}<input type="number" step="any" value={draft[key]??''} onChange={e=>setDraft(d=>({...d,[key]:e.target.value}))}/>{(key==='federal_expenditure'||key==='municipal_expenditure')&&<small>{moneyMillions(Number(draft[key]||0))}</small>}</label>)}<label className="fiscalMacroReason">Основание решения<textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Решение органа, опубликованный НПА или последствие события"/></label></div><button type="button" className="primary" disabled={busy||reason.trim().length<8} onClick={()=>void save()}><Save size={18}/>{busy?'Сохраняется…':'Применить решение и пересчитать'}</button></details>}
 {error&&<p className="error" role="alert">{error}</p>}</section>;
}
