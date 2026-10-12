'use client';
import {useEffect,useRef,useState} from 'react';
import {Copy,ExternalLink,RefreshCw,Search,Trash2} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';

type Entry={entry_key:string;category:string;title:string;status:string;changed_at:string;actor_id:string|null;document_id:string|null;details:string;amount:number|null};
const PAGE_SIZE=10;
export default function BudgetChangeRegistry({g,readOnly=false,onOpenDocument}:{g:ReturnTypeRepublic;readOnly?:boolean;onOpenDocument:(id:string)=>void}){
 const [entries,setEntries]=useState<Entry[]>([]),[total,setTotal]=useState(0),[expanded,setExpanded]=useState(false);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [search,setSearch]=useState(''),[category,setCategory]=useState('Все');
 const [focus,setFocus]=useState('');
 const current=useRef(0);
 const gameId=g.game?.id;
 async function load(offset=0,searchValue=search,categoryValue=category){
  if(!gameId)return;
  const token=++current.current;setLoading(true);
  try{
   const r=await supabase.rpc('get_budget_change_registry_page',{p_game_id:gameId,p_offset:offset,p_limit:PAGE_SIZE,p_search:searchValue,p_category:categoryValue});
   if(token!==current.current)return;
   if(r.error)throw r.error;
   const data=r.data as {entries:Entry[];total:number}|null;
   if(!data||!Array.isArray(data.entries)||!Number.isInteger(data.total))throw Error('Сервер не вернул страницу реестра.');
   setEntries(prev=>offset===0?data.entries:[...prev,...data.entries.filter(e=>!prev.some(p=>p.entry_key===e.entry_key))]);
   setTotal(data.total);setError('');
  }catch(e){if(token===current.current)setError(userError(e))}
  finally{if(token===current.current)setLoading(false)}
 }
 useEffect(()=>{setEntries([]);setTotal(0);setExpanded(false);setSearch('');setCategory('Все');return()=>{current.current++}},[gameId]);
 useEffect(()=>{
  const query=new URLSearchParams(window.location.search),value=query.get('entry')||'';
  setFocus(value.slice(0,160));
  if(value)setExpanded(true);
 },[gameId]);
 useEffect(()=>{if(expanded&&gameId)void load(0);else current.current++},[expanded,gameId,search,category]);
 useEffect(()=>{
  if(!focus||loading||!expanded)return;
  const found=entries.find(e=>e.entry_key===focus);
  if(found){document.getElementById('budget-entry-'+focus)?.scrollIntoView({block:'center',behavior:'smooth'});return}
  if(entries.length<total)void load(entries.length);
 },[focus,expanded,loading,entries,total]);
 function linkFor(entry:Entry){
  const u=new URL(window.location.href);
  u.search='';u.hash='';
  u.searchParams.set('section','budget');
  u.searchParams.set('entry',entry.entry_key);
  return u.toString();
 }
 async function share(entry:Entry){
  const url=linkFor(entry);
  try{
   if(navigator.share){await navigator.share({title:entry.title,url});return}
   await navigator.clipboard.writeText(url);setNotice('Ссылка скопирована.');
  }catch(e){if((e as Error)?.name!=='AbortError')setNotice('Не удалось отправить ссылку. Проверьте разрешения браузера.')}
 }
 async function hide(entry:Entry){
  if(!gameId||!g.teacher||readOnly||busy)return;
  if(!window.confirm('Скрыть запись «'+entry.title+'» из реестра? Расчёты и связанные документы не будут изменены.'))return;
  setBusy(true);setError('');
  try{
   const r=await supabase.rpc('hide_budget_change_registry_entry',{p_game_id:gameId,p_entry_key:entry.entry_key});
   if(r.error)throw r.error;
   setNotice('Запись скрыта из реестра. Финансовые данные сохранены.');await load(0);
  }catch(e){setError(userError(e))}
  finally{setBusy(false)}
 }
 return <section className="surface budgetChangeRegistry" id="budget-change-registry" aria-labelledby="budget-change-registry-title">
  <header className="budgetChangeRegistryHead">
   <button type="button" className="budgetChangeRegistryToggle" aria-expanded={expanded} aria-controls="budget-change-registry-content" onClick={()=>setExpanded(open=>!open)}>
    <span><small>БЮДЖЕТ · ИСТОРИЯ РЕШЕНИЙ</small><strong id="budget-change-registry-title">Реестр изменений бюджета</strong><span className="budgetChangeRegistrySubtitle">Доходы, расходы, трансферты, поправки и финансовые решения</span></span><span aria-hidden="true">{expanded?'⌃':'⌄'}</span>
   </button>
  </header>
  {expanded&&<div id="budget-change-registry-content" className="budgetChangeRegistryContent">
  <div className="budgetChangeRegistryTools"><label><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Найти изменение" aria-label="Поиск изменений бюджета"/></label><label>Категория<select value={category} onChange={e=>setCategory(e.target.value)}>{['Все','Доходы','Расходы','Исполнение','Регионы','Дефицит и долг','НПА и поправки','Бюджетные версии','Госпрограммы','События','Параметры'].map(c=><option key={c}>{c}</option>)}</select></label><span>{total} записей</span><button type="button" className="secondary" onClick={()=>void load(0)} disabled={loading||busy}><RefreshCw size={17}/> Обновить</button></div>
  {error&&<p role="alert" className="budgetNotice">{error}</p>}
  {notice&&<p role="status" className="budgetNotice">{notice}</p>}
  {!loading&&!entries.length?<p className="budgetChangeRegistryEmpty">Изменения по выбранным условиям не найдены.</p>:<div className="budgetChangeRegistryList">
   {entries.map(e=><article key={e.entry_key} id={'budget-entry-'+e.entry_key} className={'budgetChangeRegistryEntry'+(focus===e.entry_key?' isFocused':'')}>
    <div className="budgetChangeRegistryEntryCopy"><div className="budgetChangeRegistryEntryMeta"><span>{e.category}</span><time>{new Date(e.changed_at).toLocaleString('ru-RU')}</time><span>{e.status}</span></div><h3>{e.title}</h3><p>{e.details}</p>{e.amount!==null&&<strong>Изменение / сумма: {Number(e.amount).toLocaleString('ru-RU',{maximumFractionDigits:2})}</strong>}</div>
    <div className="budgetChangeRegistryActions">{e.document_id&&<button type="button" className="secondary" onClick={()=>onOpenDocument(e.document_id!)} title="Открыть документ"><ExternalLink size={16}/><span>Документ</span></button>}<button type="button" className="secondary" onClick={()=>void share(e)} title="Поделиться ссылкой на запись"><Copy size={16}/><span>Поделиться</span></button>{g.teacher&&!readOnly&&<button type="button" className="secondary budgetChangeRegistryDelete" onClick={()=>void hide(e)} disabled={busy} title="Скрыть запись без изменения бюджета"><Trash2 size={16}/><span>Удалить</span></button>}</div>
   </article>)}</div>}
  {entries.length<total&&<button type="button" className="secondary budgetChangeRegistryMore" disabled={loading} onClick={()=>void load(entries.length)}>Показать ещё {Math.min(PAGE_SIZE,total-entries.length)}</button>}
  <p className="budgetChangeRegistryFootnote">Удаление из реестра не отменяет финансовую операцию или принятый нормативный акт. Ссылки доступны только участникам этой игры.</p>
 </div>}
 </section>;
}
