'use client';
import {useMemo,useState} from 'react';
import {Activity,ArrowDownWideNarrow,Download,Search,UsersRound} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';

const VIEW_NAMES:Record<string,string>={
 dashboard:'Обзор игры',stages:'Этапы',parties:'Партии',votes:'Голосования',
 documents:'НПА',actions:'Политические процессы',grades:'Оценки',
 profile:'Профиль',teacher:'Управление'
};
type Sort='recent'|'oldest'|'name'|'surname'|'online';
type Scope='all'|'mine';
export default function ClassroomJournal({g}:{g:ReturnTypeRepublic}){
 const {me,members,activities,presence,teacher}=g;
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
 const allowed=useMemo(()=>activities.filter(a=>teacher||a.actor_id===me?.user_id),[activities,teacher,me?.user_id]);
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
    <button type="button" onClick={exportCsv} title="Экспорт показанных строк в CSV"><Download size={16} aria-hidden="true"/> CSV</button>
   </div>
  </header>
  <div className="journalToolbar">
   <label className="journalSearch"><Search size={17} aria-hidden="true"/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по журналу" aria-label="Поиск по журналу"/></label>
   {teacher&&<label>Участник<select value={memberFilter} onChange={e=>setMemberFilter(e.target.value)}><option value="">Все участники</option>{studentMembers.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label>}
   <label>Раздел<select value={viewFilter} onChange={e=>setViewFilter(e.target.value)}><option value="">Все разделы</option>{uniqueViews.map(v=><option key={v} value={v}>{VIEW_NAMES[v]||v}</option>)}</select></label>
   <label><ArrowDownWideNarrow size={15} aria-hidden="true"/>Сортировка<select value={sort} onChange={e=>setSort(e.target.value as Sort)}>
    <option value="recent">Новые сначала</option><option value="oldest">Старые сначала</option>
    {teacher&&<><option value="surname">По фамилии</option><option value="name">По имени</option><option value="online">Онлайн сначала</option></>}
   </select></label>
   {teacher&&<label className="journalCheck"><input type="checkbox" checked={onlyOnline} onChange={e=>setOnlyOnline(e.target.checked)}/> Только онлайн</label>}
   {teacher&&<label className="journalCheck"><input type="checkbox" checked={scope==='mine'} onChange={e=>setScope(e.target.checked?'mine':'all')}/> Мои действия</label>}
  </div>
  {teacher&&<div className="journalPresence" aria-label="Присутствие студентов">
   {studentMembers.map(m=>{const p=lastMap.get(m.user_id);const online=isOnline(m.user_id);return <button type="button" key={m.user_id} className={memberFilter===m.user_id?'selected':''} onClick={()=>setMemberFilter(memberFilter===m.user_id?'':m.user_id)}>
    <span className={online?'journalOnline':'journalOffline'}/><strong>{m.full_name}</strong><small>{p?(VIEW_NAMES[p.current_view]||p.current_view):'Нет данных'}</small>
   </button>})}
  </div>}
  <div className="journalFeed" role="region" aria-label="Записи журнала" tabIndex={0}>
   {visible.length===0?<div className="journalEmpty">По выбранным фильтрам записей нет.</div>:visible.slice(0,showAll?250:50).map(a=>{
    const m=members.find(x=>x.user_id===a.actor_id);
    return <article key={a.id} className="journalEvent">
     <time dateTime={a.created_at}>{new Date(a.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</time>
     <span className="journalEventMarker" aria-hidden="true"/>
     <div><div className="journalEventTitle"><strong>{m?.full_name||'Участник'}</strong><span>{VIEW_NAMES[a.view_key||'']||a.view_key||'Игра'}</span></div>
      <p>{a.label}</p></div>
    </article>;
   })}
  </div>
  {visible.length>50&&<button type="button" className="journalMore" onClick={()=>setShowAll(!showAll)}>{showAll?'Показать первые 50':'Показать ещё ('+Math.min(visible.length,250)+' из '+visible.length+')'}</button>}
  <p className="journalNote">{teacher?'Отображаются последние 250 загруженных событий; для полной истории нужен отдельный экспорт сервера.':'Вам доступны только собственные события. Действия других студентов и преподавателя скрыты.'}</p>
 </section>;
}
