'use client';
import {userError} from '@/lib/userError';
import StyledSelect from '../ui/StyledSelect';
import styles from './StageForms.module.css';
import layout from './LegislativeSessionLab.module.css';
import {isStageWorkOpen} from './stageWorkStatus';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';
import InstitutionRegistrationPanel from './InstitutionRegistrationPanel';
import DumaReadingDiscussion,{type Discussion} from './DumaReadingDiscussion';
import Stage12SpeakerOrder from './Stage12SpeakerOrder';
import Stage12AgendaText from './Stage12AgendaText';
import type {Reading} from './Stage12ReadingWorkspace';

type Session={id:string;game_id:string;stage_no:number;reading_no?:number;reading_protocol?:boolean;session_no:number;title:string;scheduled_start:string|null;scheduled_end:string|null;agenda_document_id:string|null;status:'draft'|'open'|'closed';chair_user_id:string|null;created_at:string;opened_at:string|null;closed_at:string|null};
type AgendaItem=Discussion&{speaker_order?:string[];session_id:string;formal_document_id:string;agenda_no:number;status:'pending'|'in_progress'|'completed'|'carried_over'|'withdrawn';result_note:string|null;started_at:string|null;completed_at:string|null};

const statusLabel:Record<AgendaItem['status'],string>={pending:'Ожидает',in_progress:'Рассматривается',completed:'Рассмотрено',carried_over:'Перенесено',withdrawn:'Снято'};

export default function LegislativeSessionLab({g,onOpenVotes,onOpenDocument,readOnly=false,reading=1}:{g:ReturnTypeRepublic;onOpenVotes:(id?:string)=>void;onOpenDocument?:(id:string)=>void;readOnly?:boolean;reading?:Reading}){
 const {game,me,teacher,formalDocuments,votes,setError}=g;
 const [sessions,setSessions]=useState<Session[]>([]);
 const [agenda,setAgenda]=useState<AgendaItem[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [title,setTitle]=useState('');
 const [start,setStart]=useState('');
 const [end,setEnd]=useState('');
 const [docId,setDocId]=useState('');
 const [meeting,setMeeting]=useState<{agenda_document_id:string|null;agenda_approved_at:string|null}|null>(null);
 const [note,setNote]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [feedback,setFeedback]=useState('');
 const [registrationVisible,setRegistrationVisible]=useState(false);
 const [agendaVisible,setAgendaVisible]=useState(false);
 const activeReading=useRef(reading);activeReading.current=reading;
 useEffect(()=>{setAgendaVisible(false);setRegistrationVisible(false)},[reading]);
 const role=stageRoleTitles(g);
 const stageOpen=isStageWorkOpen(game,g.stages.find(s=>s.stage_no===12));
 const canManage=!readOnly&&(teacher||(stageOpen&&
  ((role.includes('председател')&&role.includes('дум'))||
   (role.includes('совет')&&role.includes('дум')))));
 const canChair=!readOnly&&(teacher||(stageOpen&&(
  (role.includes('председател')&&role.includes('дум'))||
  g.officeAssignments.some(a=>a.user_id===me?.user_id&&a.status==='active'&&
   a.role_title.toLowerCase().includes('председател')&&a.role_title.toLowerCase().includes('дум'))
 )));

 async function load(){
  if(!game)return;
  const requestReading=reading;
  // Keep historical sessions (for example, Stage 6) in the archive.
  // The Stage 12 workspace only presents Stage 12 sessions.
  const sessionsResponse=await supabase.from('duma_sessions').select('*')
    .eq('game_id',game.id).eq('stage_no',12).order('session_no',{ascending:false});
  if(sessionsResponse.error){setError(userError(sessionsResponse.error));return;}
  const rows=((sessionsResponse.data||[]) as Session[]).filter(s=>(s.reading_no||1)===reading);
  const sessionIds=rows.map(row=>row.id);
  const [agendaResponse,meetingResponse]=await Promise.all([
   sessionIds.length
    ?supabase.from('duma_agenda_items').select('*').eq('game_id',game.id).in('session_id',sessionIds).order('agenda_no')
    :Promise.resolve(null),
   supabase.from('institution_meeting_records').select('agenda_document_id,agenda_approved_at')
    .eq('game_id',game.id).eq('stage_no',12).eq('institution_key','gd').maybeSingle()
  ]);
  if(activeReading.current!==requestReading)return;
  if(agendaResponse?.error){setError(userError(agendaResponse.error));return;}
  if(meetingResponse.error){setError(userError(meetingResponse.error));return;}
  setMeeting(meetingResponse.data);
  setSessions(rows);
  setSelectedId(previous=>rows.some(row=>row.id===previous)?previous:rows[0]?.id||'');
  setAgenda((agendaResponse?.data||[]) as AgendaItem[]);
 }
 useGameTableSync(game?.id,['duma_sessions','duma_agenda_items','institution_meeting_records','formal_documents','game_votes','game_ballots','bill_committee_conclusions'],load,(me?.user_id||'')+':'+reading);

 if(!game||!me)return null;
 const activeGame=game;
 const selected=sessions.find(x=>x.id===selectedId&&(x.reading_no||1)===reading)||sessions.find(x=>(x.reading_no||1)===reading);
 const items=selected?agenda.filter(x=>x.session_id===selected.id).sort((a,b)=>a.agenda_no-b.agenda_no):[];
 const docs=formalDocuments.filter(d=>['bill','budget','gd_resolution'].includes(d.workflow_key)&&d.doc_type!=='meeting_agenda'&&d.status_code!=='rejected'&&d.status_code!=='published'&&d.current_owner_key!=='system');
 const doc=(id:string)=>formalDocuments.find(d=>d.id===id);
 const voteFor=(id:string)=>votes.find(v=>v.formal_document_id===id&&v.status==='open'&&v.stage_no===12);
 const current=items.find(x=>x.status==='in_progress');
 const unready=items.filter(i=>['pending','in_progress'].includes(i.status)&&doc(i.formal_document_id)?.workflow_key==='bill'&&doc(i.formal_document_id)?.status_code!=='reading'+reading);
 const routed=items.filter(x=>{const d=formalDocuments.find(doc=>doc.id===x.formal_document_id);return d&&['bill','budget'].includes(d.workflow_key)});
 const isCurrentAgenda=!!selected?.agenda_document_id&&meeting?.agenda_document_id===selected.agenda_document_id;
 const agendaApproved=isCurrentAgenda&&!!meeting?.agenda_approved_at;
 const readings=['reading1','amendments','reading2','reading3','sf','president','published'];
 const readingText:Record<string,string>={draft:'Подготовка законопроекта',registered:'Регистрация в Государственной Думе',committee:'Профильный комитет',council:'Совет Государственной Думы',reading1:'I чтение',amendments:'Поправки ко II чтению',reading2:'II чтение',reading3:'III чтение',sf:'Совет Федерации',president:'Президент Российской Федерации',published:'Опубликован',rejected:'Отклонён'};

 async function create(){
  setBusy(true);setFeedback('');
  const r=await supabase.rpc('create_duma_reading_session',{p_game_id:activeGame.id,p_reading:reading,p_title:title.trim()||'Государственная Дума · '+reading+' чтение',p_scheduled_start:start?new Date(start).toISOString():null,p_scheduled_end:end?new Date(end).toISOString():null});
  if(r.error)setError(userError(r.error));else{setTitle('');setStart('');setEnd('');if(r.data)setSelectedId(String(r.data));await load();setFeedback('Заседание создано. Повестка зарегистрирована в реестре НПА.')}
  setBusy(false);
 }
 async function add(){
  if(!selected||!docId)return;setBusy(true);
  const r=await supabase.rpc('add_duma_agenda_item',{p_session_id:selected.id,p_document_id:docId});
  if(r.error)setError(userError(r.error));else{setDocId('');await load()}setBusy(false);
 }
 async function open(){if(!selected)return;setBusy(true);const r=await supabase.rpc('open_duma_session',{p_session_id:selected.id});if(r.error)setError(userError(r.error));else await load();setBusy(false)}
 async function setStatus(id:string,status:'in_progress'|'completed'|'withdrawn'){
  setBusy(true);const r=await supabase.rpc('set_duma_agenda_item_status',{p_item_id:id,p_status:status,p_note:(note[id]||'').trim()||null});
  if(r.error)setError(userError(r.error));else await load();setBusy(false);
 }
 async function close(){
  if(!selected)return;setBusy(true);const r=await supabase.rpc('close_duma_session',{p_session_id:selected.id,p_create_next:true});
  if(r.error)setError(userError(r.error));else{if(r.data?.next_session_id)setSelectedId(String(r.data.next_session_id));await load()}setBusy(false);
 }

 return <section className="legislativeLab" aria-label={'Управление заседанием Государственной Думы · '+reading+' чтение'}>
  {canManage&&(!selected||selected.status==='closed')&&<details className="legislativeCreate legislativeCreateWide">
   <summary>＋ Подготовить заседание Государственной Думы</summary>
   <div className="legislativeCreateGrid">
    <label>Название заседания<input aria-label="Название заседания" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Очередное заседание Государственной Думы"/></label>
    <label>Начало заседания<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label>Окончание заседания<input type="datetime-local" min={start||undefined} value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <p>Создаётся отдельное заседание для {reading}-го чтения. Если время не задано, действует регламент 20:00–00:00 по часовому поясу игры. Повестка автоматически собирается из пакетов соответствующего чтения.</p>
    <button type="button" className="primary" disabled={busy||!!(start&&end&&new Date(end)<=new Date(start))} onClick={()=>void create()}>{busy?'Создание…':'Создать заседание и документ повестки'}</button>
   </div>
  </details>}
  {feedback&&<p role="status" className="legislativeFeedback">{feedback}</p>}
  {!selected&&<div className={layout.empty}><b>Заседание Этапа 12 ещё не создано</b><p>Повестка Этапа 12 пока пуста. Завершённые заседания предыдущих этапов сохраняются в реестре НПА и не переносятся сюда автоматически.</p></div>}
  {selected&&<>
   <div className={layout.meetingToolbar} aria-label="Управление выбранным заседанием">
    <div className={layout.toolbarIdentity}>
     <strong>Заседание № {selected.session_no}</strong>
     <span data-status={selected.status}>{selected.status==='draft'?'Подготовка':selected.status==='open'?'Идёт':'Завершено'}</span>
    </div>
    {sessions.length>1&&<label className={layout.meetingPicker}><span className={layout.visuallyHidden}>Выбрать заседание чтения</span>
     <select aria-label="Выбрать заседание чтения" value={selected.id}
      onChange={event=>setSelectedId(event.target.value)}>
      {sessions.map(session=><option key={session.id} value={session.id}>Заседание № {session.session_no}</option>)}
     </select>
    </label>}
   </div>
   <div className={layout.preparationSequence}>
    <section className={layout.preparationStep} aria-label="Повестка заседания">
     <h3>1. Повестка заседания</h3>
     <Stage12AgendaText key={selected.id} g={g} sessionId={selected.id} documentId={selected.agenda_document_id}
      status={selected.status} canEdit={canManage} questions={items.length} onOpenDocument={onOpenDocument}/>
     <ol className={layout.agendaSummary}>{items.map(item=>{
      const bill=doc(item.formal_document_id);
      return <li key={item.id}><span>{String(item.agenda_no).padStart(2,'0')}</span>
       <div><strong>{bill?.title||'Документ из реестра НПА'}</strong>
        <small>{bill?.registry_no||'НПА'} · {statusLabel[item.status]}</small></div>
      </li>
     })}</ol>
     {items.length===0&&<p>Повестка пополнится автоматически после подготовки законопроектов к выбранному чтению.</p>}
    </section>
    <section className={layout.preparationStep} aria-label="Очерёдность выступающих">
     <h3>2. Очерёдность выступающих</h3>
     <p>Стадии выступлений определяются регламентом чтения; председатель или его заместитель назначает участников и меняет их очерёдность.</p>
     {items.length===0?<p>Очерёдность появится после добавления первого вопроса в повестку.</p>:
      items.filter(item=>item.status!=='withdrawn'&&item.status!=='completed').map(item=>
       <Stage12SpeakerOrder key={item.id} g={g} item={item} documentAuthor={doc(item.formal_document_id)?.author_id}
        reading={reading} canChair={canChair} locked={selected.status==='closed'||!selected.reading_protocol&&selected.status==='open'}
        onSaved={load}/>)}
    </section>
    <section className={layout.preparationStep} aria-label="Регистрация на заседание">
     <h3>3. Регистрация и утверждение повестки</h3>
     {selected.status==='closed'?<p>Заседание завершено. Регистрация закрыта; исторические результаты сохранены.</p>:
      isCurrentAgenda?<InstitutionRegistrationPanel key={selected.id} sessionId={selected.id} g={g}
       stageNo={12} initialBody="gd" allowedBodies={['gd']} freshAttendance={!!selected.reading_protocol}
       readOnly={readOnly} defaultOpen onOpenDocument={onOpenDocument}/>:
       <p>Повестка текущего заседания не совпадает с документом регистрации. Исправьте привязку, не затрагивая другие чтения.</p>}
    </section>
    <section className={layout.preparationStep} aria-label="Открытие заседания">
     <h3>4. Открытие и проведение заседания</h3>
     {selected.status==='draft'&&selected.reading_protocol&&<p role="status">
      {unready.length?'Не готовы к данному чтению: '+unready.length+' вопрос(ов).':
       'После утверждения повестки, наступления назначенного времени и регистрации 226 мандатов заседание откроется автоматически.'}
     </p>}
     {selected.status==='draft'&&!selected.reading_protocol&&canManage&&
      <button type="button" className="primary" disabled={busy||!items.length} onClick={()=>void open()}>Открыть заседание</button>}
     {selected.status==='open'&&<><p>Заседание идёт. Голосование доступно после выступлений и обсуждения вопросов.</p>
      {canManage&&<button type="button" className="secondary" disabled={busy} onClick={()=>void close()}>Завершить заседание</button>}</>}
     {selected.status==='closed'&&<p>Заседание завершено. Протокол и результаты сохранены.</p>}
    </section>
    {selected.status==='open'&&<section className={layout.preparationStep} aria-label="Ход заседания">
     <h3>Ход заседания: выступления и голосование</h3>
   <div className={'legislativeAgenda '+layout.agenda}>
    {items.length===0?<div className="emptyState">Повестка пуста. По правилам игры без повестки заседание не проводится.</div>:items.map(i=>{
     const d=doc(i.formal_document_id),v=voteFor(i.formal_document_id);
     return <article className={'legislativeAgendaItem '+layout.card+
      (i.status==='in_progress'?' '+layout.currentCard:'')+
      (d?.status_code==='rejected'?' '+layout.rejectedCard:'')} data-agenda-status={i.status} key={i.id}>
      <div className={'agendaNo '+layout.number}>{String(i.agenda_no).padStart(2,'0')}</div>
      <div className={'agendaDoc '+layout.document}>
       <small className={layout.registry}>{d?.registry_no||'НПА'} · {d?.status_label||'Статус документа'}</small>
       <h3 className={layout.headline}>{d?.title||'Документ'}</h3>
       <div className={'agendaMeta '+layout.meta}>
        <span className={layout.agendaStatus}>{statusLabel[i.status]}</span>
        <span className={d?.status_code==='rejected'?layout.rejectedBadge:layout.documentStatus}>{readingText[d?.status_code||'']||d?.status_label||'Без стадии'}</span>
        {v&&<span className={layout.openVote}>Голосование открыто</span>}
       </div>
       {d&&['bill','budget'].includes(d.workflow_key)&&d.status_code!=='rejected'&&
        <div className={layout.progress} role="list" aria-label="Стадии рассмотрения законопроекта">
         {readings.map(code=><span key={code} role="listitem" className={code===d.status_code?layout.progressCurrent:readings.indexOf(code)<readings.indexOf(d.status_code)?layout.progressDone:layout.progressPending}>{readingText[code]}</span>)}
        </div>}
       {d?.status_code==='rejected'&&<p className={layout.rejectedExplanation}>Законопроект отклонён. Дальнейшее прохождение чтений прекращено.</p>}
       <div className={layout.documentActions}>
        {d&&onOpenDocument&&<button type="button" className="secondary" onClick={()=>onOpenDocument(d.id)}>{d.workflow_key==='bill'&&['amendments','reading2'].includes(d.status_code)?'Открыть НПА и поправки':'Открыть НПА'}</button>}
       </div>
       {i.result_note&&<p className={layout.resultNote}>{i.result_note}</p>}
       {selected.reading_protocol&&selected.status==='open'&&i.status==='in_progress'&&d?.workflow_key==='bill'&&<DumaReadingDiscussion g={g} item={i} canManage={canManage} onRefresh={load}/>}
      </div>
      {selected.status==='open'&&canManage&&<div className="agendaActions">
       {i.status==='pending'&&<button disabled={busy||!!current||selected.reading_protocol&&d?.workflow_key==='bill'&&d.status_code!=='reading'+reading} onClick={()=>void setStatus(i.id,'in_progress')}>Начать вопрос</button>}
       {i.status==='in_progress'&&<><textarea rows={2} value={note[i.id]||''} onChange={e=>setNote(x=>({...x,[i.id]:e.target.value}))} placeholder="Итог рассмотрения / решение"/><button className="primary" disabled={busy||!!v||d?.status_code===i.opened_document_step} title={v?'Сначала закройте голосование':'НПА должен пройти предусмотренный маршрут в реестре'} onClick={()=>void setStatus(i.id,'completed')}>Зафиксировать результат после решения по НПА</button><button disabled={busy} onClick={()=>void setStatus(i.id,'withdrawn')}>Снять</button></>}
       {v&&<button onClick={()=>onOpenVotes(v.id)}>К голосованию →</button>}
      </div>}
     </article>
    })}
   </div>
   <footer className={'legislativeSessionRule '+layout.rule}><b>Логика переноса и голосований</b><p>При закрытии заседания все пункты со статусом «ожидает» или «рассматривается» автоматически становятся перенесёнными и создаются в повестке следующего заседания. Сам документ при этом не меняет стадий движения без отдельного процедурного решения в реестре НПА.</p></footer>
    </section>}
   </div>
  </>}

 </section>;
}
