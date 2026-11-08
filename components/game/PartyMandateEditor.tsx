'use client';
import {useEffect,useMemo,useState} from 'react';
import type {Party} from './types';
import type {ReturnTypeRepublic} from './viewTypes';

// Uses the existing teacher-only RPC. The party's elected total is never editable here.
export default function PartyMandateEditor({g,party}:{g:ReturnTypeRepublic;party:Party}){
 const staff=useMemo(()=>g.members.filter(m=>m.kind==='student'&&!m.roster_archived_at&&m.team===party.name),[g.members,party.name]);
 const allocations=useMemo(()=>new Map(g.partyMandates.filter(row=>row.party_id===party.id).map(row=>[row.user_id,row])),[g.partyMandates,party.id]);
 const [draft,setDraft]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  setDraft(Object.fromEntries(staff.map(m=>[m.user_id,String(allocations.get(m.user_id)?.base_mandates??0)])));
  setNotice('');
 },[staff,allocations,party.mandates]);
 const sum=staff.reduce((n,m)=>n+(Number(draft[m.user_id])||0),0);
 const valid=staff.length>0&&staff.every(m=>{
  const value=draft[m.user_id]??'';
  return /^\d+$/.test(value)&&Number(value)<=party.mandates;
 })&&sum===party.mandates;
 const frozen=g.votes.some(v=>v.status==='open'&&v.institution_key==='gd');
 async function save(reset=false){
  if(busy||frozen||!staff.length||(!reset&&!valid))return;
  setBusy(true);setNotice('');
  try{
   const values=reset?null:Object.fromEntries(staff.map(m=>[m.user_id,Number(draft[m.user_id])]));
   const ok=await g.setStudentMandates(party.id,values);
   setNotice(ok?(reset?'Мандаты распределены поровну.':'Распределение мандатов сохранено.'):'Не удалось сохранить распределение. Проверьте уведомление системы.');
  }finally{setBusy(false)}
 }
 if(!g.teacher)return null;
 return <details className="partyMandateEditor">
  <summary>Распределение мандатов</summary>
  <p>Преподаватель может изменить число мандатов каждого участника. Всего у партии <b>{party.mandates}</b> мандатов. При сохранении сумма должна составлять ровно {party.mandates}; увеличить число мандатов партии здесь нельзя.</p>
  <p role="status">Распределено: <b>{sum} / {party.mandates}</b>{sum!==party.mandates?' · '+(sum<party.mandates?'Осталось '+(party.mandates-sum):'Превышение на '+(sum-party.mandates))+' мандатов':''}.</p>
  <div className="partyMandateRows">{staff.map(m=>{
   const row=allocations.get(m.user_id);
   return <label key={m.user_id}><span><b>{m.full_name}</b><small>Доступно для голосования: {row?.effective_mandates??0}</small></span>
    <input type="number" inputMode="numeric" step={1} min={0} max={party.mandates}
     aria-label={'Число мандатов: '+m.full_name} value={draft[m.user_id]??''}
     disabled={busy||frozen} onChange={e=>{setDraft(previous=>({...previous,[m.user_id]:e.target.value}));setNotice('')}}/>
   </label>;
  })}</div>
  <div className="civicMandateActions">
   <button type="button" className="primary" disabled={busy||frozen||!valid} onClick={()=>void save()}>{busy?'Сохранение…':'Сохранить мандаты'}</button>
   <button type="button" className="secondary" disabled={busy||frozen||!staff.length} onClick={()=>void save(true)}>Распределить поровну</button>
  </div>
  {frozen&&<p role="status">До завершения открытого голосования Государственной Думы изменение мандатов заблокировано.</p>}
  {notice&&<p role="status">{notice}</p>}
 </details>;
}
