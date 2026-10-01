'use client';
import {userError} from '@/lib/userError';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {Activity,ArrowDownWideNarrow,Download,Search,Trash2,UsersRound} from 'lucide-react';
import StyledSelect from '../ui/StyledSelect';
import type {ReturnTypeRepublic} from './viewTypes';

const VIEW_NAMES:Record<string,string>={
 dashboard:'Обзор игры',stages:'Этапы',parties:'Партии',votes:'Голосования',
 budget:'Бюджет',documents:'НПА',actions:'Политический процесс',grades:'Оценки',
 profile:'Профиль',teacher:'Управление',events:'События и решения',chat:'Командный чат'
};
type Sort='recent'|'oldest'|'name'|'surname'|'online';
type Scope='all'|'mine';
export default function ClassroomJournal({g}:{g:ReturnTypeRepublic}){
 const {me,game,members,activities,presence,teacher}=g;
 const cutoff=typeof game?.settings?.classroom_journal_cleared_at==='string'?game.settings.classroom_journal_cleared_at:'';
 const [clearing,setClearing]=useState(false);
 async function clearHistory(){if(!game||!teacher||clearing||!confirm('Очистить видимую историю журнала? Оценки и подтверждённые действия сохранятся.'))return;setClearing(true);setOlderError('');try{const r=await supabase.rpc('clear_classroom_journal',{p_game_id:game.id});if(r.error)setOlderError(userError(r.error));else{setOlder([]);await g.refresh()}}catch(e){setOlderError(userError(e))}finally{setClearing(false)}}
 const [older,setOlder]=useState<typeof activities>([]);
 const [olderBusy,setOlderBusy]=useState(false);
 const [olderExhausted,setOlderExhausted]=useState(false);
 const [olderError,setOlderError]=useState('');
 useEffect(()=>{setOlder([]);setOlderExhausted(false);setOlderError('')},[game?.id,me?.user_id,cutoff]);
 const loaded=useMemo(()=>[...new Map<number,(typeof activities)[number]>([...activities,...older].map(a=>[a.id,a] as const)).values()],[activities,older]);
 async function loadOlder(){
  if(!game||olderBusy||olderExhausted)return;
  const earliest=loaded.reduce<string|null>((min,a)=>!min||a.created_at<min?a.created_at:min,null);
  if(!earliest){setOlderExhausted(true);return}
  setOlderBusy(true);setOlderError('');
  const r=await supabase.from('game_activity').select('*').eq('game_id',game.id)
   .lt('created_at',earliest).gte('created_at',cutoff||'1970-01-01').order('created_at',{ascending:false}).limit(250);
  if(r.error)setOlderError(userError(r.error));
  else{
   const page=(r.data||[]) as typeof activities;
   setOlder(previous=>[...new Map<number,(typeof activities)[number]>([...previous,...page].map(a=>[a.id,a] as const)).values()]);
   if(page.length<250)setOlderExhausted(true);
  }
  setOlderBusy(false);
 }

 const [search,setSearch]=useState('');
 const [memberFilter,setMemberFilter]=useState('');
 const [viewFilter,setViewFilter]=useState('');
 const [sort,setSort]=useState<Sort>('recent');
 const [scope,setScope]=useState<Scope>(teacher?'all':'mine');
 const [onlyOnline,setOnlyOnline]=useState(false);
 const [showAll,setShowAll]=useState(false);
 const studentMembers=members.filter(m=>m.kind==='student');
 const lastMap=new Map(studentMembers.map(m=>[m.user_id,presence.find(p=>p.user_id===m.user_id)]));
 const isOnline=(id:string)=>{const p=lastMap.get(id);return !!p&&Date.now()-new Date(p.last_seen_at).getTime()<90000};
 const allowed=useMemo(()=>loaded.filter(a=>(!cutoff||a.created_at>cutoff)&&(teacher||a.actor_id===me?.user_id)),[loaded,teacher,me?.user_id,cutoff]);
 const visible=useMemo(()=>{
  const q=search.trim().toLocaleLowerCase('ru');
  const xs=allowed.filter(a=>{
   const member=studentMembers.find(m=>m.user_id===a.actor_id);
   if(teacher&&scope==='mine'&&a.actor_id!==me?.user_id)return false;
   if(teacher&&memberFilter&&a.actor_id!==memberFilter)return false;
   if(teacher&&onlyOnline&&!isOnline(a.actor_id))return false;
   if(viewFilter&&a.view_key!==viewFilter)return false;
   return !q||[member?.full_name||'',a.label,a.event_type,a.view_key||''].some(s=>s.toLocaleLowerCase('ru').includes(q));
  });
  return xs.sort((a,b)=>{
   if(sort==='recent')return new Date(b.created_at).getTime()-new Date(a.created_at).getTime();
   if(sort==='oldest')return new Date(a.created_at).getTime()-new Date(b.created_at).getTime();
   const am=studentMembers.find(m=>m.user_id===a.actor_id);
   const bm=studentMembers.find(m=>m.user_id===b.actor_id);
   if(sort==='online')return Number(isOnline(b.actor_id))-Number(isOnline(a.actor_id))||new Date(b.created_at).getTime()-new Date(a.created_at).getTime();
   const part=(m:typeof am)=>sort==='surname'?(m?.full_name.split(' ')[0]||''):(m?.full_name.split(' ')[1]||m?.full_name||'');
   return part(am).localeCompare(part(bm),'ru')||new Date(b.created_at).getTime()-new Date(a.created_at).getTime();
  });
 },[allowed,search,memberFilter,viewFilter,sort,scope,onlyOnline,members,presence]);
 const onlineCount=studentMembers.filter(m=>isOnline(m.user_id)).length;
 const uniqueViews=[...new Set(allowed.map(a=>a.view_key).filter((s):s is string=>!!s))].sort();
 function exportCsv(){
  const header=['Время','Участник','Раздел','Тип','Событие'];
  const rows=visible.map(a=>[new Date(a.created_at).toLocaleString('ru-RU'),members.find(m=>m.user_id===a.actor_id)?.full_name||'Участник',VIEW_NAMES[a.view_key||'']||a.view_key||'',a.event_type,a.label]);
  const contents=[header,...rows].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
  const blob=new Blob(['\ufeff'+contents],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=url;anchor.download='gos-sims-journal.csv';anchor.click();
  URL.revokeObjectURL(url);
 }
 if(!me)return null;
 return <section className="classroomJournal" aria-label="Журнал активности">
  <header className="journalHeader">
   <div><small>АКТИВНОСТЬ И ПРИСУТСТВИЕ</small><h2>{teacher?'Журнал аудитории':'Мой журнал действий'}</h2>
    <p>{teacher?'Участники, текущий раздел и история действий в одном месте.':'Ваши действия и переходы по разделам игры.'}</p></div>
   <div className="journalCounters"><span><UsersRound size={16} aria-hidden="true"/>{teacher?onlineCount+' онлайн':'Личный журнал'}</span>
    <span><Activity size={16} aria-hidden="true"/>{visible.length} записей</span>
    {teacher&&<button type="button" disabled={clearing} onClick={()=>void clearHistory()} title="Сбросить видимую историю, сохранив данные оценивания"><Trash2 size={16} aria-hidden="true"/>{clearing?'Очистка…':'Очистить историю'}</button>}
    <button type="button" onClick={exportCsv} title="Экспорт показанных строк в CSV"><Download size={16} aria-hidden="true"/> CSV</button>
   </div>
  </header>
  <div className="journalToolbar">
   <label className="journalSearch"><Search size={17} aria-hidden="true"/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по журналу" aria-label="Поиск по журналу"/></label>
   {teacher&&<StyledSelect label="Участник" value={memberFilter} onChange={setMemberFilter}
    options={[{value:'',label:'Все участники'},...studentMembers.map(m=>({value:m.user_id,label:m.full_name}))]}/>}
   <StyledSelect label="Раздел" value={viewFilter} onChange={setViewFilter}
    options={[{value:'',label:'Все разделы'},...uniqueViews.map(v=>({value:v,label:VIEW_NAMES[v]||v}))]}/>
   <StyledSelect label="Сортировка" value={sort} onChange={v=>setSort(v as Sort)}
    options={[{value:'recent',label:'Новые сначала'},{value:'oldest',label:'Старые сначала'},...(teacher?[
     {value:'surname',label:'По фамилии'},{value:'name',label:'По имени'},{value:'online',label:'Онлайн сначала'}]:[])]}/>
   {teacher&&<label className="journalCheck"><input type="checkbox" checked={onlyOnline} onChange={e=>setOnlyOnline(e.target.checked)}/> Только онлайн</label>}
   {teacher&&<label className="journalCheck"><input type="checkbox" checked={scope==='mine'} onChange={e=>setScope(e.target.checked?'mine':'all')}/> Мои действия</label>}
  </div>
  {teacher&&<div className="journalPresence" aria-label="Присутствие студентов">
   {studentMembers.map(m=>{const p=lastMap.get(m.user_id);const online=isOnline(m.user_id);return <button type="button" key={m.user_id} className={memberFilter===m.user_id?'selected':''} onClick={()=>setMemberFilter(memberFilter===m.user_id?'':m.user_id)}>
    <span className={online?'journalOnline':'journalOffline'}/><strong>{m.full_name}</strong><small>{p?(VIEW_NAMES[p.current_view]||p.current_view):'Нет данных'}</small>
   </button>})}
  </div>}
  <div className="journalFeed" role="region" aria-label="Записи журнала" tabIndex={0}>
   {visible.length===0?<div className="journalEmpty">По выбранным фильтрам записей нет.</div>:visible.slice(0,showAll?visible.length:50).map(a=>{
    const m=members.find(x=>x.user_id===a.actor_id);
    return <article key={a.id} className="journalEvent">
     <time dateTime={a.created_at}>{new Date(a.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</time>
     <span className="journalEventMarker" aria-hidden="true"/>
     <div><div className="journalEventTitle"><strong>{m?.full_name||'Участник'}</strong><span>{VIEW_NAMES[a.view_key||'']||a.view_key||'Игра'}</span></div>
      <p>{a.label}</p></div>
    </article>;
   })}
  </div>
  {visible.length>50&&<button type="button" className="journalMore" onClick={()=>setShowAll(!showAll)}>{showAll?'Показать первые 50':'Показать ещё ('+visible.length+' из '+visible.length+')'}</button>}
  {loaded.length>=250&&!olderExhausted&&<button type="button" className="journalMore" onClick={()=>void loadOlder()} disabled={olderBusy}>{olderBusy?'Загрузка…':'Загрузить предыдущие 250 событий'}</button>}
  {olderError&&<p className="journalError" role="alert">{olderError}</p>}
  <p className="journalNote">{teacher?'Загружено '+loaded.length+' событий. Фильтры и экспорт действуют на загруженную историю.':'Вам доступны только собственные события. Действия других студентов и преподавателя скрыты.'}</p>
 </section>;
}
