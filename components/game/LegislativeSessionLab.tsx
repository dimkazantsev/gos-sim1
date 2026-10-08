'use client';
import StageModuleHeader from '../ui/StageModuleHeader';
import StyledSelect from '../ui/StyledSelect';
import styles from './StageForms.module.css';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';

type Session={id:string;game_id:string;session_no:number;title:string;scheduled_start:string|null;scheduled_end:string|null;status:'draft'|'open'|'closed';chair_user_id:string|null;created_at:string;opened_at:string|null;closed_at:string|null};
type AgendaItem={id:string;session_id:string;formal_document_id:string;agenda_no:number;status:'pending'|'in_progress'|'completed'|'carried_over'|'withdrawn';result_note:string|null;started_at:string|null;completed_at:string|null};

const statusLabel:Record<AgendaItem['status'],string>={pending:'Ожидает',in_progress:'Рассматривается',completed:'Рассмотрено',carried_over:'Перенесено',withdrawn:'Снято'};

export default function LegislativeSessionLab({g,onOpenVotes,onOpenDocument}:{g:ReturnTypeRepublic;onOpenVotes:(id?:string)=>void;onOpenDocument?:(id:string)=>void}){
 const {game,me,teacher,formalDocuments,votes,setError}=g;
 const [sessions,setSessions]=useState<Session[]>([]);
 const [agenda,setAgenda]=useState<AgendaItem[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [title,setTitle]=useState('');
 const [start,setStart]=useState('');
 const [end,setEnd]=useState('');
 const [docId,setDocId]=useState('');
 const [note,setNote]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const role=stageRoleTitles(g);
 const canManage=teacher||role.includes('председател')&&role.includes('дум')||role.includes('совет')&&role.includes('дум');

 async function load(){
  if(!game)return;
  const [s,a]=await Promise.all([
   supabase.from('duma_sessions').select('*').eq('game_id',game.id).order('session_no',{ascending:false}),
   supabase.from('duma_agenda_items').select('*').eq('game_id',game.id).order('agenda_no')
  ]);
  const failure=[s,a].find(x=>x.error);if(failure?.error){setError(failure.error.message);return;}
  if(!s.error){
   const rows=(s.data||[]) as Session[];setSessions(rows);
   if(!selectedId&&rows[0])setSelectedId(rows[0].id);
  }
  if(!a.error)setAgenda((a.data||[]) as AgendaItem[]);
 }
 useGameTableSync(game?.id,['duma_sessions','duma_agenda_items','formal_documents','game_votes','game_ballots','bill_committee_conclusions'],load,me?.user_id||'');

 if(!game||!me)return null;
 const activeGame=game;
 const selected=sessions.find(x=>x.id===selectedId)||sessions[0];
 const items=selected?agenda.filter(x=>x.session_id===selected.id).sort((a,b)=>a.agenda_no-b.agenda_no):[];
 const docs=formalDocuments.filter(d=>['bill','budget','gd_resolution'].includes(d.workflow_key));
 const doc=(id:string)=>formalDocuments.find(d=>d.id===id);
 const voteFor=(id:string)=>votes.find(v=>v.formal_document_id===id&&v.status==='open');
 const unfinished=items.filter(x=>x.status==='pending'||x.status==='in_progress').length;
 const current=items.find(x=>x.status==='in_progress');

 async function create(){
  setBusy(true);
  const r=await supabase.rpc('create_duma_session',{p_game_id:activeGame.id,p_title:title.trim()||'Заседание Государственной Думы',p_scheduled_start:start?new Date(start).toISOString():null,p_scheduled_end:end?new Date(end).toISOString():null});
  if(r.error)setError(r.error.message);else{setTitle('');setStart('');setEnd('');if(r.data)setSelectedId(String(r.data));await load()}
  setBusy(false);
 }
 async function add(){
  if(!selected||!docId)return;setBusy(true);
  const r=await supabase.rpc('add_duma_agenda_item',{p_session_id:selected.id,p_document_id:docId});
  if(r.error)setError(r.error.message);else{setDocId('');await load()}setBusy(false);
 }
 async function open(){if(!selected)return;setBusy(true);const r=await supabase.rpc('open_duma_session',{p_session_id:selected.id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function setStatus(id:string,status:'in_progress'|'completed'|'withdrawn'){
  setBusy(true);const r=await supabase.rpc('set_duma_agenda_item_status',{p_item_id:id,p_status:status,p_note:(note[id]||'').trim()||null});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function close(){
  if(!selected)return;setBusy(true);const r=await supabase.rpc('close_duma_session',{p_session_id:selected.id,p_create_next:true});
  if(r.error)setError(r.error.message);else{if(r.data?.next_session_id)setSelectedId(String(r.data.next_session_id));await load()}setBusy(false);
 }

 return <section className="legislativeLab">
  <StageModuleHeader eyebrow="Этап 12 · Государственная Дума" title="Заседание Государственной Думы" description="Регистрация депутатов, повестка и рассмотрение законопроектов по чтениям. Откройте НПА из повестки, рассмотрите поправки ко второму чтению и проведите связанное голосование." stats={[{label:"Заседание",value:selected?"№ "+selected.session_no:"Не создано",detail:selected?.status==="open"?"Идёт":selected?.status==="closed"?"Закрыто":"Подготовка повестки"},{label:"Ожидают рассмотрения",value:unfinished}]}/>

  <div className="legislativeSessionTabs">
   <div>{sessions.map(s=><button key={s.id} className={s.id===selected?.id?'active':''} onClick={()=>setSelectedId(s.id)}><b>№ {s.session_no}</b><span>{s.title}</span><em>{s.status==='open'?'идёт':s.status==='closed'?'закрыто':'проект'}</em></button>)}</div>
   {canManage&&<details className="legislativeCreate"><summary>＋ Новое заседание</summary><div><input aria-label="Название заседания" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название"/><label>Начало<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Окончание<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label><button disabled={busy} onClick={()=>void create()}>Создать</button></div></details>}
  </div>

  {selected&&<>
   <div className="legislativeSessionBar">
    <div><small>СЕССИЯ</small><h3>{selected.title}</h3><p>{selected.scheduled_start?new Date(selected.scheduled_start).toLocaleString('ru-RU'):'Начало не задано'}{selected.scheduled_end?' → '+new Date(selected.scheduled_end).toLocaleString('ru-RU'):''}</p></div>
    {canManage&&selected.status==='draft'&&<button className="primary" disabled={busy||items.length===0} onClick={()=>void open()}>Открыть заседание</button>}
    {canManage&&selected.status==='open'&&<button className="primary" disabled={busy} onClick={()=>void close()}>Закрыть и перенести остаток</button>}
   </div>

   {canManage&&selected.status==='draft'&&<div className={styles.grid}><StyledSelect wrap label="Документ для повестки" value={docId} onChange={setDocId} options={[{value:'',label:'Выберите документ из реестра НПА…'},...docs.filter(d=>!items.some(i=>i.formal_document_id===d.id)).map(d=>({value:d.id,label:d.registry_no+' · '+d.title+' · '+d.status_label}))]}/><div className={styles.actions}><button disabled={busy||!docId} onClick={()=>void add()}>Добавить в повестку</button></div></div>}

   <div className="legislativeAgenda">
    {items.length===0?<div className="emptyState">Повестка пуста. По правилам игры без повестки заседание не проводится.</div>:items.map(i=>{
     const d=doc(i.formal_document_id),v=voteFor(i.formal_document_id);
     return <article className={'legislativeAgendaItem '+i.status} key={i.id}>
      <div className="agendaNo">{String(i.agenda_no).padStart(2,'0')}</div>
      <div className="agendaDoc"><small>{d?.registry_no||'НПА'} · {d?.status_label||'Статус документа'}</small><h3>{d?.title||'Документ'}</h3><div className="agendaMeta"><span>{statusLabel[i.status]}</span>{v&&<span className="live">● Голосование открыто</span>}</div>{d&&onOpenDocument&&<button type="button" className="secondary" onClick={()=>onOpenDocument(d.id)}>{d.workflow_key==='bill'&&['amendments','reading2'].includes(d.status_code)?'Открыть НПА и поправки':'Открыть НПА'}</button>}{i.result_note&&<p>{i.result_note}</p>}</div>
      {selected.status==='open'&&canManage&&<div className="agendaActions">
       {i.status==='pending'&&<button disabled={busy||!!current} onClick={()=>void setStatus(i.id,'in_progress')}>Начать вопрос</button>}
       {i.status==='in_progress'&&<><textarea rows={2} value={note[i.id]||''} onChange={e=>setNote(x=>({...x,[i.id]:e.target.value}))} placeholder="Итог рассмотрения / решение"/><button className="primary" disabled={busy} onClick={()=>void setStatus(i.id,'completed')}>Завершить вопрос</button><button disabled={busy} onClick={()=>void setStatus(i.id,'withdrawn')}>Снять</button></>}
       {v&&<button onClick={()=>onOpenVotes(v.id)}>К голосованию →</button>}
      </div>}
     </article>
    })}
   </div>

   <footer className="legislativeSessionRule"><b>Логика переноса</b><p>При закрытии заседания все пункты со статусом «ожидает» или «рассматривается» автоматически становятся перенесёнными и создаются в повестке следующего заседания. Сам документ при этом не меняет стадий движения без отдельного процедурного решения в реестре НПА.</p></footer>
  </>}
 </section>;
}
