'use client';
import {userError} from '@/lib/userError';
import StageModuleHeader from '../ui/StageModuleHeader';
import StyledSelect from '../ui/StyledSelect';
import styles from './StageForms.module.css';
import layout from './LegislativeSessionLab.module.css';
import {isStageWorkOpen} from './stageWorkStatus';
import {useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';
import InstitutionRegistrationPanel from './InstitutionRegistrationPanel';
import DumaReadingDiscussion,{type Discussion} from './DumaReadingDiscussion';
import type {Reading} from './Stage12ReadingWorkspace';

type Session={id:string;game_id:string;stage_no:number;reading_no?:number;reading_protocol?:boolean;session_no:number;title:string;scheduled_start:string|null;scheduled_end:string|null;agenda_document_id:string|null;status:'draft'|'open'|'closed';chair_user_id:string|null;created_at:string;opened_at:string|null;closed_at:string|null};
type AgendaItem=Discussion&{session_id:string;formal_document_id:string;agenda_no:number;status:'pending'|'in_progress'|'completed'|'carried_over'|'withdrawn';result_note:string|null;started_at:string|null;completed_at:string|null};

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
 const [correctionReason,setCorrectionReason]=useState('');
 const [note,setNote]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [feedback,setFeedback]=useState('');
 const activeReading=useRef(reading);activeReading.current=reading;
 const role=stageRoleTitles(g);
 const stageOpen=isStageWorkOpen(game,g.stages.find(s=>s.stage_no===12));
 const canManage=!readOnly&&(teacher||(stageOpen&&
  ((role.includes('председател')&&role.includes('дум'))||
   (role.includes('совет')&&role.includes('дум')))));

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
  const agendaResponse=sessionIds.length
   ?await supabase.from('duma_agenda_items').select('*').eq('game_id',game.id)
     .in('session_id',sessionIds).order('agenda_no')
   :null;
  if(activeReading.current!==requestReading)return;
  if(agendaResponse?.error){setError(userError(agendaResponse.error));return;}
  setSessions(rows);
  setSelectedId(previous=>rows.some(row=>row.id===previous)?previous:rows[0]?.id||'');
  setAgenda((agendaResponse?.data||[]) as AgendaItem[]);
 }
 useGameTableSync(game?.id,['duma_sessions','duma_agenda_items','formal_documents','game_votes','game_ballots','bill_committee_conclusions'],load,(me?.user_id||'')+':'+reading);

 if(!game||!me)return null;
 const activeGame=game;
 const selected=sessions.find(x=>x.id===selectedId&&(x.reading_no||1)===reading)||sessions.find(x=>(x.reading_no||1)===reading);
 const items=selected?agenda.filter(x=>x.session_id===selected.id).sort((a,b)=>a.agenda_no-b.agenda_no):[];
 // The package register and the chairman-approved meeting agenda are different
 // sources of truth. Never hide a prepared package simply because the chairman
 // has not placed it on the selected agenda.
 const stageBills=formalDocuments.filter(d=>d.stage_no===12&&d.workflow_key==='bill')
  .sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const agendaBillIds=new Set(items.map(item=>item.formal_document_id));
 const awaitingAgenda=stageBills.filter(d=>!agendaBillIds.has(d.id)).length;
 const docs=formalDocuments.filter(d=>['bill','budget','gd_resolution'].includes(d.workflow_key)&&d.doc_type!=='meeting_agenda'&&d.status_code!=='rejected'&&d.status_code!=='published'&&d.current_owner_key!=='system');
 const doc=(id:string)=>formalDocuments.find(d=>d.id===id);
 const voteFor=(id:string)=>votes.find(v=>v.formal_document_id===id&&v.status==='open'&&v.stage_no===12);
 const unfinished=items.filter(x=>x.status==='pending'||x.status==='in_progress').length;
 const current=items.find(x=>x.status==='in_progress');
 const unready=items.filter(i=>['pending','in_progress'].includes(i.status)&&doc(i.formal_document_id)?.workflow_key==='bill'&&doc(i.formal_document_id)?.status_code!=='reading'+reading);
 const routed=items.filter(x=>{const d=formalDocuments.find(doc=>doc.id===x.formal_document_id);return d&&['bill','budget'].includes(d.workflow_key)});
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
 async function correct(){
  if(!selected||!docId||busy||correctionReason.trim().length<10)return;
  setBusy(true);setFeedback('');
  const r=await supabase.rpc('correct_duma_agenda_after_open',{
   p_session_id:selected.id,p_document_id:docId,p_reason:correctionReason.trim()
  });
  if(r.error)setError(userError(r.error));
  else{
   setDocId('');setCorrectionReason('');await load();
   setFeedback('Корректировка повестки зафиксирована с основанием.');
  }
  setBusy(false);
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

 return <section className="legislativeLab">
  <StageModuleHeader variant="government" eyebrow={'Этап 12 · '+reading+' чтение'} title="Заседание Государственной Думы" description="Повестка → утверждение председателем → регистрация и кворум → выступления → голосование. Заседание открывается автоматически после выполнения всех условий." stats={[{label:"Заседание",value:selected?"№ "+selected.session_no:"Не создано",detail:selected?.status==="open"?"Идёт":selected?.status==="closed"?"Закрыто":"Подготовка повестки"},{label:"Пакетов Этапа 12",value:stageBills.length,detail:"В реестре НПА"},{label:"В повестке",value:items.length,detail:"Вопросов выбранного заседания"}]}/>

  {canManage&&<details className="legislativeCreate legislativeCreateWide">
   <summary>＋ Подготовить заседание Государственной Думы</summary>
   <div className="legislativeCreateGrid">
    <label>Название заседания<input aria-label="Название заседания" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Очередное заседание Государственной Думы"/></label>
    <label>Начало заседания<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label>Окончание заседания<input type="datetime-local" min={start||undefined} value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <p>Создаётся отдельное заседание для {reading}-го чтения. Если время не задано, действует регламент 20:00–00:00 по часовому поясу игры. Повестка автоматически собирается из пакетов соответствующего чтения.</p>
    <button type="button" className="primary" disabled={busy||!!(start&&end&&new Date(end)<=new Date(start))} onClick={()=>void create()}>{busy?'Создание…':'Создать заседание и документ повестки'}</button>
   </div>
  </details>}
  <div className={'legislativeSessionTabs legislativeSessionTabsFull '+layout.tabs}>
   <div>{sessions.map(s=><button type="button" key={s.id} className={s.id===selected?.id?'active':''} onClick={()=>setSelectedId(s.id)}><b>№ {s.session_no}</b><span>{s.title}</span><em>{s.status==='open'?'Идёт':s.status==='closed'?'Завершено':'Подготовка'}</em></button>)}</div>
  </div>

  {feedback&&<p role="status" className="legislativeFeedback">{feedback}</p>}
  <details className={layout.packageRegister} aria-label="Все пакеты законопроектов Этапа 12">
   <summary className={layout.packageSummary}>Все пакеты законопроектов <span>{stageBills.length} в реестре · {items.length} в выбранной повестке</span></summary>
   <header className={layout.packageRegisterHead}>
    <div><small>Реестр законодательных инициатив</small><h3>Пакеты Этапа 12 · {stageBills.length}</h3>
     <p>Все созданные законопроекты, независимо от включения в повестку. До открытия заседания новые пакеты автоматически включаются в проект повестки. После открытия возможна только обоснованная корректировка уполномоченным председателем.</p></div>
    <span className={layout.packageRegisterCount}>{stageBills.length} в реестре · {stageBills.length-awaitingAgenda} в повестке</span>
   </header>
   {stageBills.length===0?<p className={layout.packageRegisterEmpty}>Законопроекты Этапа 12 пока не созданы. Подготовьте пакет на вкладке «Материалы».</p>:
    <div className={layout.packageRegisterList}>
     {stageBills.map(bill=>{
      const inAgenda=agendaBillIds.has(bill.id);
      return <article className={layout.packageRegisterItem} key={bill.id} data-in-agenda={inAgenda?'true':'false'}>
       <div className={layout.packageRegisterDescription}>
        <small>{bill.registry_no} · {bill.status_label}</small>
        <h4>{bill.title}</h4>
        <span className={inAgenda?layout.packageInAgenda:layout.packageAwaitingAgenda}>
         {inAgenda?'В повестке заседания № '+selected?.session_no:'Не включён в повестку'}
        </span>
       </div>
       {onOpenDocument&&<button type="button" className="secondary" onClick={()=>onOpenDocument(bill.id)}>Открыть пакет</button>}
      </article>;
     })}
    </div>}
  </details>
  {!selected&&<div className={layout.empty}><b>Заседание Этапа 12 ещё не создано</b><p>Повестка Этапа 12 пока пуста. Завершённые заседания предыдущих этапов сохраняются в реестре НПА и не переносятся сюда автоматически.</p></div>}
  {selected&&<>
   <div className={'legislativeSessionBar '+layout.sessionBar}>
    <div><small>СЕССИЯ</small><h3>{selected.title}</h3><p>{selected.scheduled_start?new Date(selected.scheduled_start).toLocaleString('ru-RU'):'Начало не задано'}{selected.scheduled_end?' → '+new Date(selected.scheduled_end).toLocaleString('ru-RU'):''}</p></div>
    {selected.reading_protocol&&selected.status==='draft'&&<p className={layout.openingGate} role="status">{unready.length?'Ожидается передача всех пакетов на '+reading+' чтение. Не готовы: '+unready.length+'.':'Пакеты переданы на чтение. После утверждения повестки и достижения кворума 226 из 450 заседание откроется автоматически.'}</p>}
    {!selected.reading_protocol&&selected.status==='draft'&&canManage&&<button type="button" className="primary" disabled={busy||!items.length} onClick={()=>void open()}>Открыть перенесённое заседание прежнего регламента</button>}
    {canManage&&selected.status==='open'&&<button className="primary" disabled={busy} onClick={()=>void close()}>Закрыть и перенести остаток</button>}
   </div>

   {!selected.reading_protocol&&selected.status!=='closed'&&<p className={layout.openingGate}>Заседание подготовлено по прежнему регламенту. Его голосования, регистрация и перенос незавершённых вопросов сохраняются. Новая последовательность применяется к новым заседаниям чтений после завершения этих вопросов.</p>}
   {selected.status!=='closed'&&<InstitutionRegistrationPanel key={selected.id} g={g} stageNo={12} initialBody="gd" allowedBodies={['gd']} freshAttendance={!!selected.reading_protocol} readOnly={readOnly} defaultOpen={selected.status==='draft'&&unready.length===0} onOpenDocument={onOpenDocument}/>}

   <section className={'legislativeDocBridge '+layout.documentBridge}><div><b>Реестр НПА · повестка заседания № {selected.session_no}</b><p>До открытия заседания повестка пополняется автоматически. Председатель утверждает её и открывает регистрацию. После кворума начинается заседание; голосование доступно после выступлений и обсуждения.</p></div>{selected.agenda_document_id&&<button type="button" disabled={!onOpenDocument} onClick={()=>onOpenDocument?.(selected.agenda_document_id!)}>Открыть документ повестки →</button>}</section>
   {canManage&&selected.status==='draft'&&<div className={styles.grid}><StyledSelect wrap label="Дополнительный документ для повестки" value={docId} onChange={setDocId} options={[{value:'',label:'Выберите документ из реестра НПА…'},...docs.filter(d=>!items.some(i=>i.formal_document_id===d.id)).map(d=>({value:d.id,label:d.registry_no+' · '+d.title+' · '+d.status_label}))]}/><div className={styles.actions}><button disabled={busy||!docId} onClick={()=>void add()}>Добавить другой документ</button></div></div>}
   {canManage&&selected.status==='open'&&<details className={layout.correctionPanel}>
    <summary>Корректировка повестки после открытия заседания</summary>
    <div className={layout.correctionFields}>
     <p>Новые законопроекты больше не включаются автоматически. Председатель может добавить вопрос только по отдельному решению с указанием основания. Корректировка сохраняется в истории игры.</p>
     <StyledSelect wrap label="Пакет для корректировки" value={docId} onChange={setDocId} options={[{value:'',label:'Выберите законопроект Этапа 12…'},...stageBills.filter(d=>!items.some(i=>i.formal_document_id===d.id)&&d.status_code!=='rejected'&&d.status_code!=='published'&&d.current_owner_key!=='system').map(d=>({value:d.id,label:d.registry_no+' · '+d.title}))]}/>
     <label>Основание корректировки<textarea rows={3} maxLength={500} value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)} placeholder="Укажите причину внесения вопроса после открытия заседания (не менее 10 символов)"/></label>
     <button type="button" className="primary" disabled={busy||!docId||correctionReason.trim().length<10} onClick={()=>void correct()}>Зафиксировать корректировку</button>
    </div>
   </details>}

   <details className={'legislativeRouteGuide '+layout.routeGuide}><summary>Полный маршрут законопроекта</summary><div>{['Регистрация','Комитет','Совет ГД','I чтение','Поправки','II чтение','III чтение','Совет Федерации','Президент'].map((x,i)=><span key={x}><small>{i+1}</small>{x}</span>)}</div><p>Поправки принимаются во время подготовки ко II чтению. Успешное голосование переводит законопроект на следующую стадию в реестре. Закон, принятый в III чтении, направляется в Совет Федерации, затем Президенту.</p></details>
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
  </>}
 </section>;
}
