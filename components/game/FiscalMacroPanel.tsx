'use client';
import {useEffect,useRef,useState} from 'react';
import {Gauge,Save,ChevronDown,BookOpenText,SlidersHorizontal} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {quantity,moneyMillions} from '@/lib/formatQuantity';
import {fiscalEnvironment,type FiscalContext,type FiscalPolicy} from './fiscalMath';
import type {ReturnTypeRepublic} from './viewTypes';
const fields=[['key_rate','Ключевая ставка','% годовых'],['fx_rate','Базовый курс рубля','₽ за 1 доллар'],['oil_price','Цена нефти','долларов за баррель'],['cutoff_price','Цена отсечения','долларов за баррель'],['inflation','Инфляция','% в год'],['federal_expenditure','Федеральные обязательства','млн ₽'],['municipal_expenditure','Местные обязательства','млн ₽'],['activity_override','Деловая активность','% от исходного уровня'],['fnb_total','ФНБ — общий объём','млн ₽'],['fnb_liquid','ФНБ — доступные средства','млн ₽'],['fnb_fx_share','Валютная доля ликвидного ФНБ','%']] as const;
const fnbDefaults={fnb_total:10000000,fnb_liquid:4490900,fnb_fx_share:25};
const shownFnb=(v:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(v/1000000)+' трлн ₽';
export default function FiscalMacroPanel({g,context,readOnly,onSaved}:{g:ReturnTypeRepublic;context:FiscalContext|null;readOnly:boolean;onSaved:(values:Partial<FiscalPolicy>)=>void}){
 const [draft,setDraft]=useState<Record<string,string>>({}),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const saving=useRef(false);
 useEffect(()=>{if(context)setDraft(Object.fromEntries(fields.map(([key])=>[key,key==='activity_override'?(context.policy.activity_override==null?'':String(context.policy.activity_override)):String(context.policy[key]??fnbDefaults[key as keyof typeof fnbDefaults]??'')])));},[context?.policy.updated_at]);
 if(!context)return <p role="status">Загружаются общие параметры бюджетного сценария…</p>;
 const p=context.policy,environment=fiscalEnvironment(context),canEdit=!readOnly&&(g.teacher||context.can_change_rate);
 async function save(){
  if(!g.game||!context||saving.current)return;
  const changedFields=fields.filter(([key])=>
   (g.teacher||key==='key_rate')&&draft[key]!==undefined&&(
    key==='activity_override'
     ? (draft[key].trim()==='' ? context.policy.activity_override!=null : Number(draft[key])!==context.policy.activity_override)
     : (!draft[key]?.trim()||Number(draft[key])!==Number(context.policy[key]??fnbDefaults[key as keyof typeof fnbDefaults]))
   ));
  if(!changedFields.length){setNotice('');setError('Измените хотя бы один параметр.');return}
  if(changedFields.some(([key])=>key==='activity_override'
   ? !!draft[key]?.trim()&&(!Number.isFinite(Number(draft[key]))||Number(draft[key])<0||Number(draft[key])>1000)
   : !draft[key]?.trim()||!Number.isFinite(Number(draft[key])))){
   setNotice('');setError('Заполните параметры числами. Деловая активность — от 0 до 1000 %; пустое поле означает автоматический расчёт.');return;
  }
  const proposedTotal=Number(draft.fnb_total??context.policy.fnb_total??10000000);
  const proposedLiquid=Number(draft.fnb_liquid??context.policy.fnb_liquid??4490900);
  const proposedShare=Number(draft.fnb_fx_share??context.policy.fnb_fx_share??25);
  if(changedFields.some(([key])=>key.startsWith('fnb_'))&&
    (proposedTotal<0||proposedTotal>50000000||proposedLiquid<0||proposedLiquid>proposedTotal||proposedShare<0||proposedShare>100)){
    setError('ФНБ: общий объём до 50 трлн ₽, доступная сумма не выше общей, валютная доля от 0 до 100%.');return;
  }
  if(reason.trim().length<8){setNotice('');setError('Укажите основание решения: не менее 8 символов.');return}
  const changed=Object.fromEntries(changedFields.map(([key])=>[key,key==='activity_override'&&draft[key].trim()===''?null:Number(draft[key])])) as Partial<FiscalPolicy>;
  const requestValues={...changed}; // Server decides the reference factor; clients cannot send it.
  const abort=new AbortController();
  const timer=window.setTimeout(()=>abort.abort(),18000);
  saving.current=true;setBusy(true);setNotice('');setError('');
  try{
   const r=await supabase.rpc('set_fiscal_policy',{
    p_game_id:g.game.id,p_values:requestValues,p_reason:reason.trim()
   }).abortSignal(abort.signal);
   if(abort.signal.aborted){
    setError('Сервер долго не отвечает. Сохранение не подтверждено — проверьте текущие значения перед повторной отправкой.');
   }else if(r.error){
    setError(userError(r.error));
   }else{
    // The write is confirmed. Rendering updated policy must not depend on three
    // further budget reads or a slow forecast recalculation.
    // Optimistic UI uses the same formula as the server snapshot. The
    // authoritative reference is reconciled by the normal budget sync.
    if(Object.prototype.hasOwnProperty.call(changed,'activity_override')){
      changed.activity_reference=changed.activity_override==null?null:
        fiscalEnvironment({...context,policy:{...context.policy,...changed,activity_override:null}}).activity;
    }
    if(changed.fnb_total!==undefined&&changed.fnb_liquid===undefined){
      changed.fnb_liquid=Number(((context.policy.fnb_liquid??4490900)*changed.fnb_total/
        Math.max(.01,context.policy.fnb_total??10000000)).toFixed(8));
    }
    onSaved(changed);
    setReason('');
    setNotice('Решение сохранено. Показатели обновлены; связанные расчёты синхронизируются отдельно.');
   }
  }catch(e){
   setError(abort.signal.aborted
    ?'Сервер долго не отвечает. Результат сохранения неизвестен — обновите данные перед повторной отправкой.'
    :userError(e));
  }finally{
   window.clearTimeout(timer);
   saving.current=false;
   setBusy(false);
  }
 }
 return <section className="surface fiscalMacroPanel" aria-label="Экономические условия"><header className="fiscalMacroHeading"><span className="fiscalMacroHeadingIcon" aria-hidden="true"><Gauge size={23}/></span><div className="fiscalMacroHeadingText"><h2>Экономические условия</h2><p>Ключевые показатели игрового бюджета: ставки, цены и деловая активность. Изменения учитываются при расчёте доходов, расходов и долговой нагрузки.</p></div></header>
 <div className="fiscalMacroStats">{[['Ключевая ставка',quantity(p.key_rate,'% годовых')],['Расчётный курс',quantity(environment.fx,'₽ за 1 доллар')],['Нефть',quantity(p.oil_price,'долларов за баррель')],['Цена отсечения',quantity(p.cutoff_price,'долларов за баррель')],['Инфляция',new Intl.NumberFormat('ru-RU',{maximumFractionDigits:6}).format(p.inflation)+' % в год'],['Деловая активность',quantity(environment.activity*100,'% от исходного уровня')],
['ФНБ',shownFnb(p.fnb_total??10000000)],['Доступно из ФНБ',shownFnb(p.fnb_liquid??4490900)]].map(([label,value])=><article key={label}><span>{label}</span><b>{value}</b></article>)}</div>
 <details className="fiscalMacroDetails"><summary><span className="fiscalMacroSummaryTitle"><BookOpenText size={19} aria-hidden="true"/> Пояснения к показателям</span><ChevronDown className="fiscalMacroChevron" size={19} aria-hidden="true"/></summary><p>Ручное значение деловой активности становится новой исходной точкой: в момент сохранения отображается заданный процент, а дальнейшие изменения ставки, курса, экономического индекса и доверия продолжают изменять его относительно этой точки. При автоматическом расчёте чем дороже кредит, тем слабее активность бизнеса и выше обслуживание долга. Доверие и экономический индекс влияют на активность и курс; инфляция — на стоимость обязательств. Для добывающих регионов учитываются нефть и курс.</p><p data-inflation-explanation><strong>Инфляция и расходы.</strong> Когда подтверждённое решение увеличивает фактические государственные расходы, расчётная инфляция растёт; сокращение расходов снижает её. На каждые дополнительные 1% расходов относительно базового федерального бюджета 2026 года приходится 0,2 процентного пункта инфляции, но не более ±0,5 пункта за решение. Учитываются исполненные финансовые последствия событий, расходные решения и опубликованные бюджетные обязательства, включая государственные программы. Простая регистрация проекта, отказ без изменения утверждённых расходов или изменение налоговой ставки сами по себе инфляцию не меняют. Преподаватель может вручную установить любое значение инфляции, после чего дальнейшие последствия рассчитываются от него.</p><p data-fnb-explanation><strong>ФНБ и нефтегазовые доходы.</strong> Общий объём фонда и доступная для финансирования часть учитываются раздельно. При принятии федерального бюджета нефтегазовые средства сверх цены отсечения направляются в ФНБ и одновременно включаются в потребность финансирования — повторное использование этих денег исключено. Если нефть дешевле цены отсечения, нефтегазовые поступления сокращаются, а доступные средства ФНБ можно направить на покрытие дефицита или погашение долгов по установленным процедурам. Ослабление рубля повышает рублёвую стоимость валютной части ФНБ, укрепление снижает её; это переоценка активов, а не дополнительный доход.</p>
 <p>Инфляция и ключевая ставка ограничивают новые внутренние заимствования и повышают их стоимость. Действующие ОФЗ с постоянным купоном сохраняют условия выпуска. Председатель Банка России изменяет ключевую ставку с указанием основания решения; управление средствами ФНБ и бюджетными расходами осуществляется соответствующими уполномоченными органами.</p><p>Диапазон доходов и расходов — сценарий «хуже / лучше», а не статистический доверительный интервал. Все коэффициенты модели раскрыты в справке ниже.</p></details>
 {canEdit&&<details className="fiscalMacroEditor"><summary><span className="fiscalMacroSummaryTitle"><SlidersHorizontal size={19} aria-hidden="true"/>{g.teacher?'Редактировать параметры экономики':'Решение Банка России о ключевой ставке'}</span><ChevronDown className="fiscalMacroChevron" size={19} aria-hidden="true"/></summary><div className="fiscalMacroFields">{fields.filter(([key])=>g.teacher||key==='key_rate').map(([key,label,unit])=><label key={key}>{label}, {unit}<input type="number" step="any" min={key==='activity_override'?0:undefined} max={key==='activity_override'?1000:undefined} placeholder={key==='activity_override'?'Автоматически':undefined} value={draft[key]??''} onChange={e=>{setNotice('');setDraft(d=>({...d,[key]:e.target.value}))}}/>{key==='activity_override'&&<small>Заданное значение — новая база для дальнейшего автоматического расчёта. Пустое поле — исходный автоматический режим.</small>}{key==='inflation'&&<small>Преподаватель задаёт значение вручную. Следующие подтверждённые расходные решения изменяют его относительно установленного уровня.</small>}{(key==='federal_expenditure'||key==='municipal_expenditure'||key==='fnb_total'||key==='fnb_liquid')&&<small>{moneyMillions(Number(draft[key]||0))}</small>}{key==='fnb_fx_share'&&<small>Доля валютных активов только в доступной части ФНБ. Изменение доли само по себе не создаёт доходов.</small>}</label>)}<label className="fiscalMacroReason">Основание решения<textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Решение органа, опубликованный НПА или последствие события"/><small>Для сохранения необходимо указать основание решения — не менее 8 символов.</small></label></div><button type="button" className="primary" disabled={busy} onClick={()=>void save()}><Save size={18}/>{busy?'Сохраняется…':'Применить решение и пересчитать'}</button></details>}
 {notice&&<p className="budgetNotice" role="status">{notice}</p>}
 {error&&<p className="error" role="alert">{error}</p>}</section>;
}
