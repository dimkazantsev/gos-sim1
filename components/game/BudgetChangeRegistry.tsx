'use client';
import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Copy,ExternalLink,RefreshCw,Search,Trash2} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';

type Entry={entry_key:string;category:string;title:string;status:string;changed_at:string;actor_id:string|null;document_id:string|null;details:string;amount:number|null};
type Page={entries:Entry[];total:number;categories:string[]};
const PAGE_SIZE=10;

export default function BudgetChangeRegistry({g,readOnly=false,onOpenDocument}:{g:ReturnTypeRepublic;readOnly?:boolean;onOpenDocument:(id:string)=>void}){
 const [expanded,setExpanded]=useState(false),[entries,setEntries]=useState<Entry[]>([]);
 const [total,setTotal]=useState(0),[categories,setCategories]=useState<string[]>([]);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [search,setSearch]=useState(''),[category,setCategory]=useState('Все'),[focus,setFocus]=useState('');
 const request=useRef(0),gameId=g.game?.id;

 // Start closed and issue no registry request until opened.
 // A deep link is the sole exception: open to the targeted entry automatically.
 useEffect(()=>{
  request.current++;setExpanded(false);setEntries([]);setTotal(0);setCategories([]);
  setSearch('');setCategory('Все');setFocus('');setError('');setNotice('');setLoading(false);
  const q=typeof URLSearchParams!=='undefined'?new URLSearchParams(window.location.search):null;
  const key=q?.get('entry')||'';
  if(/^(tax|fiscal|execution|income|plan|transfer|party|law|financing|program):[0-9a-f-]+$/i.test(key)){
   setFocus(key);setExpanded(true);
  }
 },[gameId]);

 async function loadPage(reset:boolean){
  if(!gameId||!expanded)return;
  const token=++request.current,offset=reset?0:entries.length;
  setLoading(true);
  try{
   const r=await supabase.rpc('get_budget_change_registry_page',{
    p_game_id:gameId,p_offset:offset,p_limit:PAGE_SIZE,
    p_query:search.trim(),p_category:category==='Все'?'':category,p_focus:focus||null
   });
   if(token!==request.current)return;
   if(r.error)throw r.error;
   const page=r.data as Page|null;
   if(!page||!Array.isArray(page.entries)||!Number.isInteger(page.total)||!Array.isArray(page.categories))throw Error('Сервер не вернул страницу реестра изменений.');
   setEntries(prev=>{
    if(reset)return page.entries;
    const known=new Set(prev.map(row=>row.entry_key));
    return [...prev,...page.entries.filter(row=>!known.has(row.entry_key))];
   });
   setTotal(page.total);setCategories(page.categories);setError('');
  }catch(e){if(token===request.current)setError(userError(e))}
  finally{if(token===request.current)setLoading(false)}
 }
 // The backend returns at most 10 matching rows. No background polling while
 // the registry is collapsed; filters restart pagination from the first page.
 useEffect(()=>{
  if(!gameId||!expanded)return;
  setEntries([]);setTotal(0);
  const timer=setTimeout(()=>{void loadPage(true)},search.trim()?250:0);
  return()=>{clearTimeout(timer);request.current++};
 },[gameId,expanded,search,category,focus]);

 useEffect(()=>{
  if(!focus||!expanded||loading||!entries.some(e=>e.entry_key===focus))return;
  document.getElementById('budget-entry-'+focus)?.scrollIntoView({block:'center',behavior:'smooth'});
 },[focus,expanded,loading,entries]);

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
   setNotice('Запись скрыта из реестра. Финансовые данные сохранены.');
   await loadPage(true);
  }catch(e){setError(userError(e))}
  finally{setBusy(false)}
 }
 return <section className="surface budgetChangeRegistry" id="budget-change-registry" aria-labelledby="budget-change-registry-title">
  <header className="budgetChangeRegistryHead">
   <button type="button" className="budgetChangeRegistryDisclosure" onClick={()=>setExpanded(value=>!value)}
    aria-expanded={expanded} aria-controls="budget-change-registry-body">
    <span><small>БЮДЖЕТ · ИСТОРИЯ РЕШЕНИЙ</small><h2 id="budget-change-registry-title">Реестр изменений бюджета</h2></span>
    <span className="budgetChangeRegistryToggle"><span>{expanded?'Свернуть':'Развернуть'}</span><ChevronDown size={20} aria-hidden="true"/></span>
   </button>
  </header>
  {expanded&&<div className="budgetChangeRegistryBody" id="budget-change-registry-body">
   <div className="budgetChangeRegistryIntro"><p>Доходы, расходы, трансферты, поправки, финансирование, события и параметры модели.</p>
    <button type="button" className="secondary" onClick={()=>void loadPage(true)} disabled={loading||busy}><RefreshCw size={17}/>{loading?'Загрузка…':'Обновить реестр'}</button>
   </div>
   <div className="budgetChangeRegistryTools"><label><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Найти изменение" aria-label="Поиск изменений бюджета"/></label><label>Категория<select value={category} onChange={e=>setCategory(e.target.value)}>{['Все',...categories.filter(c=>c!=='Все')].map(c=><option key={c}>{c}</option>)}</select></label><span>{total} записей</span></div>
   {error&&<p role="alert" className="budgetNotice">{error}</p>}
   {notice&&<p role="status" className="budgetNotice">{notice}</p>}
   {!loading&&!entries.length&&!error?<p className="budgetChangeRegistryEmpty">Изменения по выбранным условиям не найдены.</p>:<div className="budgetChangeRegistryList">
    {entries.map(e=><article key={e.entry_key} id={'budget-entry-'+e.entry_key} className={'budgetChangeRegistryEntry'+(focus===e.entry_key?' isFocused':'')}>
     <div className="budgetChangeRegistryEntryCopy"><div className="budgetChangeRegistryEntryMeta"><span>{e.category}</span><time>{new Date(e.changed_at).toLocaleString('ru-RU')}</time><span>{e.status}</span></div><h3>{e.title}</h3><p>{e.details}</p>{e.amount!==null&&<strong>Изменение / сумма: {Number(e.amount).toLocaleString('ru-RU',{maximumFractionDigits:2})}</strong>}</div>
     <div className="budgetChangeRegistryActions">{e.document_id&&<button type="button" className="secondary" onClick={()=>onOpenDocument(e.document_id!)} title="Открыть документ"><ExternalLink size={16}/><span>Документ</span></button>}<button type="button" className="secondary" onClick={()=>void share(e)} title="Поделиться ссылкой на запись"><Copy size={16}/><span>Поделиться</span></button>{g.teacher&&!readOnly&&<button type="button" className="secondary budgetChangeRegistryDelete" onClick={()=>void hide(e)} disabled={busy} title="Скрыть запись без изменения бюджета"><Trash2 size={16}/><span>Удалить</span></button>}</div>
    </article>)}
   </div>}
   {loading&&<p role="status" className="budgetChangeRegistryEmpty">Загрузка записей…</p>}
   {entries.length<total&&<button type="button" className="secondary budgetChangeRegistryMore" disabled={loading||busy} onClick={()=>void loadPage(false)}>Показать ещё {Math.min(PAGE_SIZE,total-entries.length)}</button>}
   <p className="budgetChangeRegistryFootnote">Удаление из реестра не отменяет финансовую операцию или принятый нормативный акт. Ссылки доступны только участникам этой игры.</p>
  </div>}
 </section>;
}
