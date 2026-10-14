'use client';
import {useState} from 'react';
import StyledSelect from '../ui/StyledSelect';
import type {Party} from './types';
import type {ReturnTypeRepublic} from './viewTypes';

/** Emergency teacher intervention only; the normal chair election is run by party members. */
export default function PartyChairFallback({g,party}:{g:ReturnTypeRepublic;party:Party}){
 const [candidate,setCandidate]=useState('');
 const [open,setOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const members=g.members.filter(m=>m.kind==='student'&&!m.roster_archived_at&&m.team===party.name);
 const current=members.find(m=>m.user_id===party.leader_user_id);
 const eligible=members.some(m=>m.user_id===candidate&&m.user_id!==party.leader_user_id);
 async function appoint(){
  if(!g.teacher||!eligible||busy)return;
  const next=members.find(m=>m.user_id===candidate);
  if(!next)return;
  if(!window.confirm('Резервное назначение председателя партии «'+party.name+'»:\n'+next.full_name+'\n\nЭто ручное решение преподавателя заменит действующего председателя, в том числе избранного голосованием. Продолжить?'))return;
  setBusy(true);setNotice('');
  try{
   const ok=await g.setPartyLeader(party.id,candidate);
   setNotice(ok?'Председатель партии переназначен преподавателем.':'Не удалось переназначить председателя. Проверьте сообщение системы.');
   if(ok){setCandidate('');setOpen(false)}
  }finally{setBusy(false)}
 }
 if(!g.teacher)return null;
 return <section className="partyChairFallback" aria-label={'Резервное назначение председателя партии '+party.name}>
  <button type="button" className="secondary partyChairFallbackToggle" aria-expanded={open} onClick={()=>{setOpen(value=>!value);setNotice('')}}>
   Переназначить председателя партии
  </button>
  {open&&<div className="partyChairFallbackBody">
   <p>Председатель определяется голосованием членов партии. Ручное назначение предусмотрено только на случай, если выборы не удалось завершить.</p>
   <p><b>Сейчас:</b> {current?.full_name||'Председатель ещё не избран'}</p>
   <StyledSelect label="Новый председатель" value={candidate} onChange={setCandidate}
    options={[{value:'',label:'Выберите участника партии'},...members.filter(m=>m.user_id!==party.leader_user_id).map(m=>({value:m.user_id,label:m.full_name}))]}/>
   <button type="button" className="secondary" disabled={!eligible||busy} onClick={()=>void appoint()}>{busy?'Переназначение…':'Подтвердить ручное переназначение'}</button>
   {members.length===0&&<p role="status">В партии пока нет вступивших участников.</p>}
  </div>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
