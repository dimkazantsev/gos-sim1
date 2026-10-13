'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';

export default function TeacherParticipantRoster({g}:{g:ReturnTypeRepublic}){
 const [search,setSearch]=useState('');
 const [filter,setFilter]=useState('all');
 const rows=useMemo(()=>g.members.filter(m=>{
  if(filter!=='all'&&m.kind!==filter)return false;
  return [m.full_name,m.role_title,m.user_id].some(v=>String(v||'').toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')));
 }).sort((a,b)=>a.full_name.localeCompare(b.full_name,'ru')),[g.members,search,filter]);
 if(!g.teacher||!g.game)return null;
 return <section className="surface" aria-label="Участники и доступ" style={{padding:20}}>
  <div className="surfaceHead"><div><small>ДОСТУП К ИГРЕ</small><h2>Участники и доступ</h2><p>Зарегистрированные пользователи текущей игры. Исключение и полное удаление недоступны до внедрения проверенных серверных операций.</p></div><strong>{g.members.length}</strong></div>
  <div style={{display:'flex',flexWrap:'wrap',gap:12,marginBottom:16}}>
   <input aria-label="Поиск участника" placeholder="ФИО, должность или ID" value={search} onChange={e=>setSearch(e.target.value)}/>
   <select aria-label="Фильтр роли" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Все роли</option><option value="student">Участники</option><option value="guest">Гости</option><option value="teacher">Преподаватели</option></select>
  </div>
  <div style={{display:'grid',gap:8}}>
   {rows.map(m=><article key={m.user_id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:12,border:'1px solid var(--border, #d7dce3)',borderRadius:12,flexWrap:'wrap'}}>
    <div><b>{m.full_name}</b><div><small>{m.kind==='teacher'?'Преподаватель':m.kind==='guest'?'Гость':'Участник'} · {m.role_title||'Без должности'}</small></div></div>
    <span style={{fontSize:12,opacity:.75}}>{g.presence.some(p=>p.user_id===m.user_id&&Date.now()-new Date(p.last_seen_at).getTime()<90000)?'В сети':'Не в сети'}</span>
   </article>)}
   {rows.length===0&&<p>Совпадений нет.</p>}
  </div>
 </section>;
}
