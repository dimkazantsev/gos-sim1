'use client';
import StageModuleHeader from '../ui/StageModuleHeader';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';

type Session={id:string;game_id:string;session_no:number;title:string;time_limit_minutes:number;agenda_document_id:string|null;status:'draft'|'open'|'closed';chair_user_id:string|null;created_at:string;opened_at:string|null;closed_at:string|null};
type Item={id:string;session_id:string;program_id:string;agenda_no:number;report_minutes:number;status:'pending'|'presenting'|'decision'|'completed'|'withdrawn';vote_id:string|null;result_note:string|null;started_at:string|null;completed_at:string|null};
type Program={id:string;title:string;responsible_ministry:string;status:string;responsible_minister_id:string|null};
type Question={id:string;session_id:string;title:string;description:string;duration_minutes:number;program_agenda_id:string|null;status:'pending'|'discussed';created_at:string};
type Proposal={id:string;program_id:string;section_key:string;original_text:string;proposed_text:string;justification:string;status:'submitted'|'accepted'|'rejected';review_note:string|null;created_by:string;created_at:string};

export default function GovernmentProgramSessionLab({g,onOpenVotes,onOpenDocument}:{g:ReturnTypeRepublic;onOpenVotes:(id?:string)=>void;onOpenDocument?:(id:string)=>void}){
 const {game,me,teacher,members,votes,setError}=g;
 const [sessions,setSessions]=useState<Session[]>([]);
 const [items,setItems]=useState<Item[]>([]);
 const [programs,setPrograms]=useState<Program[]>([]);
 const [questions,setQuestions]=useState<Question[]>([]);
 const [proposals,setProposals]=useState<Proposal[]>([]);
 const [reviewProgram,setReviewProgram]=useState(''),[reviewSection,setReviewSection]=useState('structure'),[reviewOriginal,setReviewOriginal]=useState(''),[reviewProposed,setReviewProposed]=useState(''),[reviewReason,setReviewReason]=useState('');
 const [draftQuestions,setDraftQuestions]=useState([{title:'',description:'',minutes:10}]);
 const [questionTitle,setQuestionTitle]=useState(''),[questionDescription,setQuestionDescription]=useState(''),[questionMinutes,setQuestionMinutes]=useState(10);
 const [notice,setNotice]=useState('');
 const [selectedId,setSelectedId]=useState('');
 const [title,setTitle]=useState('');
 const [timeLimit,setTimeLimit]=useState(60);
 const [programId,setProgramId]=useState('');
 const [reportMinutes,setReportMinutes]=useState(7);
 const [busy,setBusy]=useState(false);
 const role=stageRoleTitles(g);
 const canManage=teacher||(role.includes('председател')&&role.includes('правительств'))||role.includes('президент');

 async function load(){
  if(!game)return;
  const [s,i,p,q,r]=await Promise.all([
   supabase.from('government_sessions').select('*').eq('game_id',game.id).order('session_no',{ascending:false}),
   supabase.from('government_program_agenda').select('*').eq('game_id',game.id).order('agenda_no'),
   supabase.from('state_programs').select('id,title,responsible_ministry,status,responsible_minister_id').eq('game_id',game.id).order('title'),
   supabase.from('government_session_questions').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('state_program_review_proposals').select('*').eq('game_id',game.id).order('created_at',{ascending:false})
  ]);
  const failure=[s,i,p,q,r].find(x=>x.error);if(failure?.error){setError(failure.error.message);return;}
  if(!s.error){const rows=(s.data||[]) as Session[];setSessions(rows);if(!selectedId&&rows[0])setSelectedId(rows[0].id)}
  if(!i.error)setItems((i.data||[]) as Item[]);
  if(!p.error)setPrograms((p.data||[]) as Program[]);
  if(!q.error)setQuestions((q.data||[]) as Question[]);
  if(!r.error)setProposals((r.data||[]) as Proposal[]);
 }
 useGameTableSync(game?.id,['government_sessions','government_program_agenda','government_session_questions','formal_documents','state_program_review_proposals','state_programs','game_votes','game_ballots','institution_session_registrations'],load,me?.user_id||'');

 if(!game||!me)return null;
 const activeGame=game;
 const selected=sessions.find(x=>x.id===selectedId)||sessions[0];
 const agenda=selected?items.filter(x=>x.session_id===selected.id).sort((a,b)=>a.agenda_no-b.agenda_no):[];
 const readyPrograms=programs.filter(p=>p.status==='ready');
 const meetingQuestions=selected?questions.filter(q=>q.session_id===selected.id):[];
 const current=agenda.find(x=>x.status==='presenting'||x.status==='decision');
 const name=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';
 const program=(id:string)=>programs.find(p=>p.id===id);
 const vote=(id:string|null)=>id?votes.find(v=>v.id===id):undefined;

 async function submitReview(){
  if(!reviewProgram||reviewProposed.trim().length<5||busy)return;
  setBusy(true);
  try{const r=await supabase.rpc('submit_state_program_review_proposal',{p_program_id:reviewProgram,p_section_key:reviewSection,p_original_text:reviewOriginal,p_proposed_text:reviewProposed,p_justification:reviewReason});if(r.error)throw r.error;setReviewProposed('');setReviewOriginal('');setReviewReason('');await load();setNotice('Предложение к государственной программе зарегистрировано.')}catch(e){setError(e)}finally{setBusy(false)}
 }
 async function resolveReview(id:string,action:'accepted'|'rejected'){
  if(busy)return;setBusy(true);
  try{const r=await supabase.rpc('review_state_program_proposal',{p_proposal_id:id,p_action:action,p_note:''});if(r.error)throw r.error;await load()}catch(e){setError(e)}finally{setBusy(false)}
 }
 async function create(){
  if(busy||draftQuestions.some(q=>q.title.trim().length<3)||!draftQuestions.length)return;
  setBusy(true);setNotice('');
  try{
   const r=await supabase.rpc('create_government_session_with_questions',{p_game_id:activeGame.id,p_title:title.trim()||'Заседание Правительства',p_time_limit_minutes:timeLimit,p_questions:draftQuestions.map(q=>({...q,title:q.title.trim()}))});
   if(r.error)throw r.error;
   if(r.data)setSelectedId(String(r.data));
   setTitle('');setDraftQuestions([{title:'',description:'',minutes:10}]);
   await load();setNotice('Заседание и документ повестки созданы в реестре документов.');
  }catch(e){setError(e)}finally{setBusy(false)}
 }
 async function addQuestion(){
  if(!selected||questionTitle.trim().length<3||busy)return;
  setBusy(true);
  try{
   const r=await supabase.rpc('add_government_session_question',{p_session_id:selected.id,p_title:questionTitle.trim(),p_description:questionDescription.trim(),p_duration_minutes:questionMinutes,p_program_id:null});
   if(r.error)throw r.error;
   setQuestionTitle('');setQuestionDescription('');await load();
  }catch(e){setError(e)}finally{setBusy(false)}
 }
 async function removeQuestion(id:string){
  if(busy)return;setBusy(true);
  try{const r=await supabase.rpc('remove_government_session_question',{p_question_id:id});if(r.error)throw r.error;await load()}catch(e){setError(e)}finally{setBusy(false)}
 }
 async function discussQuestion(id:string){
  if(busy)return;setBusy(true);
  try{const r=await supabase.rpc('set_government_session_question_discussed',{p_question_id:id});if(r.error)throw r.error;await load()}catch(e){setError(e)}finally{setBusy(false)}
 }
 async function add(){
  if(!selected||!programId)return;setBusy(true);const r=await supabase.rpc('add_program_to_government_agenda',{p_session_id:selected.id,p_program_id:programId,p_report_minutes:reportMinutes});
  if(r.error)setError(r.error.message);else{setProgramId('');await load()}setBusy(false);
 }
 async function open(){if(!selected)return;setBusy(true);const r=await supabase.rpc('open_government_session',{p_session_id:selected.id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function start(id:string){setBusy(true);const r=await supabase.rpc('start_government_program_report',{p_item_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function decision(id:string){setBusy(true);const r=await supabase.rpc('open_program_vote_from_agenda',{p_item_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function close(){if(!selected)return;setBusy(true);const r=await supabase.rpc('close_government_session',{p_session_id:selected.id});if(r.error)setError(r.error.message);else await load();setBusy(false)}

 return <section className="govSessionLab">
  <StageModuleHeader eyebrow="Этап 11 · Правительство" title="Заседание Правительства" description="Председатель формирует повестку и регламент. Министры представляют программы, члены Правительства регистрируются на заседание и голосуют; принятое решение оформляется постановлением." stats={[{label:"Заседание",value:selected?"№ "+selected.session_no:"Не создано",detail:selected?.status==="open"?"Идёт":selected?.status==="closed"?"Закрыто":"Подготовка повестки"},{label:"Регламент",value:selected?selected.time_limit_minutes+" мин.":"Не задан"}]}/>

  <section className="govProgramReview">
   <div className="govProgramReviewHeader"><div><h3>Государственные программы на рассмотрении</h3><p>Программы подготовлены на этапе 10. Здесь обсуждаются предложения о корректировке, замечания и решения. Повторного заполнения паспорта нет.</p></div><span>{programs.length} программ</span></div>
   <div className="govProgramReviewGrid">{programs.length?programs.map(p=><article key={p.id}>
    <small>{p.responsible_ministry}</small><h4>{p.title}</h4>
    <span>{p.status==='ready'?'Готова к заседанию':p.status==='adopted'?'Принята':p.status==='rejected'?'Отклонена':p.status==='government_vote'?'На голосовании':'В подготовке и согласовании'}</span>
    <p>{proposals.filter(q=>q.program_id===p.id).length} предложений по изменению</p>
    <button type="button" onClick={()=>{setReviewProgram(p.id);document.getElementById('gov-review-form')?.scrollIntoView({block:'nearest',behavior:'smooth'})}}>Рассмотреть и предложить правку</button>
   </article>):<p>Государственные программы пока не представлены. Их подготовка выполняется на этапе 10.</p>}</div>
   <div id="gov-review-form" className="govReviewForm">
    <h4>Предложение к программе</h4>
    <label>Программа<select value={reviewProgram} onChange={e=>setReviewProgram(e.target.value)}><option value="">Выберите программу</option>{programs.map(p=><option value={p.id} key={p.id}>{p.title}</option>)}</select></label>
    <label>Раздел<select value={reviewSection} onChange={e=>setReviewSection(e.target.value)}><option value="passport">Паспорт</option><option value="goals">Цели и показатели</option><option value="structure">Направления и мероприятия</option><option value="expenses">Финансирование и расходы</option><option value="other">Другое</option></select></label>
    <label>Действующая формулировка<textarea rows={2} value={reviewOriginal} onChange={e=>setReviewOriginal(e.target.value)} placeholder="Укажите исходный фрагмент программы"/></label>
    <label>Предлагаемая редакция<textarea rows={3} value={reviewProposed} onChange={e=>setReviewProposed(e.target.value)} placeholder="Опишите конкретное изменение"/></label>
    <label>Обоснование<textarea rows={2} value={reviewReason} onChange={e=>setReviewReason(e.target.value)} placeholder="Почему необходима корректировка?"/></label>
    <button type="button" className="primary" disabled={busy||!reviewProgram||reviewProposed.trim().length<5||me.kind==='observer'} onClick={()=>void submitReview()}>Зарегистрировать предложение</button>
   </div>
   {proposals.length>0&&<div className="govReviewList"><h4>Реестр предложений</h4>{proposals.map(p=><article key={p.id}>
    <div><b>{programs.find(x=>x.id===p.program_id)?.title||'Госпрограмма'}</b><small>{p.status==='submitted'?'На рассмотрении':p.status==='accepted'?'Одобрено к учёту':'Отклонено'}</small></div>
    <p>{p.proposed_text}</p>{p.justification&&<p>Обоснование: {p.justification}</p>}
    {canManage&&p.status==='submitted'&&<div className="govMeetingCreateActions"><button type="button" disabled={busy} onClick={()=>void resolveReview(p.id,'accepted')}>Одобрить предложение</button><button type="button" disabled={busy} onClick={()=>void resolveReview(p.id,'rejected')}>Отклонить</button></div>}
   </article>)}</div>}
   <p className="govReviewDisclaimer">Одобрение предложения фиксирует решение о корректировке. Подписанный паспорт и бюджет автоматически не изменяются: для изменения утверждённых сумм требуется отдельная процедура.</p>
  </section>
  <div className="govSessionTabs govSessionTabsFull">
   <div>{sessions.map(s=><button type="button" key={s.id} className={s.id===selected?.id?'active':''} onClick={()=>setSelectedId(s.id)}><b>№ {s.session_no}</b><span>{s.title}</span><em>{s.status==='open'?'Идёт':s.status==='closed'?'Завершено':'Проект'}</em></button>)}</div>
  </div>
  {canManage&&<details className="govSessionCreate govSessionCreateWide">
   <summary>＋ Подготовить заседание и документ повестки</summary>
   <div className="govMeetingCreate">
    <div className="govMeetingCreateFields">
     <label>Название заседания<input aria-label="Название заседания" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Например, очередное заседание Правительства"/></label>
     <label>Общий регламент, мин.<input type="number" min="5" max="240" value={timeLimit} onChange={e=>setTimeLimit(Number(e.target.value)||60)}/></label>
    </div>
    <h3>Вопросы повестки</h3><p>Внесите хотя бы один вопрос. Документ повестки создастся автоматически вместе с заседанием.</p>
    {draftQuestions.map((q,i)=><div className="govQuestionEditor" key={i}>
     <b>Вопрос {i+1}</b>
     <label>Название вопроса<input value={q.title} onChange={e=>setDraftQuestions(v=>v.map((x,j)=>j===i?{...x,title:e.target.value}:x))} placeholder="Что будет рассматриваться?"/></label>
     <label>Содержание и пояснение<textarea rows={2} value={q.description} onChange={e=>setDraftQuestions(v=>v.map((x,j)=>j===i?{...x,description:e.target.value}:x))} placeholder="Докладчик, проект решения, материалы"/></label>
     <label>Время, мин.<input type="number" min={1} max={60} value={q.minutes} onChange={e=>setDraftQuestions(v=>v.map((x,j)=>j===i?{...x,minutes:Number(e.target.value)}:x))}/></label>
     {draftQuestions.length>1&&<button type="button" className="secondary" onClick={()=>setDraftQuestions(v=>v.filter((_,j)=>j!==i))}>Убрать вопрос</button>}
    </div>)}
    <div className="govMeetingCreateActions">
     <button type="button" onClick={()=>setDraftQuestions(v=>v.length>=30?v:[...v,{title:'',description:'',minutes:10}])} disabled={busy||draftQuestions.length>=30}>＋ Добавить вопрос повестки</button>
     <button type="button" className="primary" disabled={busy||timeLimit<5||timeLimit>240||draftQuestions.some(q=>q.title.trim().length<3||q.minutes<1||q.minutes>60)} onClick={()=>void create()}>{busy?'Сохранение…':'Создать заседание и повестку'}</button>
    </div>
   </div>
  </details>}
  {notice&&<p role="status" className="govMeetingNotice">{notice}</p>}

  {selected&&<>
   <div className="govSessionBar"><div><small>ПРЕДСЕДАТЕЛЬСТВУЮЩИЙ</small><b>{name(selected.chair_user_id)}</b><span>{meetingQuestions.length+agenda.filter(x=>!meetingQuestions.some(q=>q.program_agenda_id===x.id)).length} вопросов в повестке</span></div>{canManage&&selected.status==='draft'&&<button className="primary" disabled={busy||(meetingQuestions.length===0&&agenda.length===0)} onClick={()=>void open()}>Открыть заседание</button>}{canManage&&selected.status==='open'&&<button className="primary" disabled={busy||!!current} onClick={()=>void close()}>Закрыть заседание</button>}</div>

   <section className="govAgendaDocument">
    <div><h3>Документ повестки</h3><p>Вопросы автоматически включаются в документ реестра. При открытии заседания редакция повестки фиксируется.</p></div>
    {selected.agenda_document_id&&<button type="button" onClick={()=>onOpenDocument?.(selected.agenda_document_id!)} disabled={!onOpenDocument}>Открыть в «Документах» →</button>}
   </section>
   <section className="govQuestionsPanel">
    <h3>Повестка заседания</h3>
    {meetingQuestions.map((q,i)=><article key={q.id} className="govQuestionItem">
      <span>{i+1}</span><div><b>{q.title}</b><p>{q.description||'Описание не указано'} · {q.duration_minutes} мин.</p><small>{q.status==='discussed'?'Рассмотрен':q.program_agenda_id?'Государственная программа':'Ожидает рассмотрения'}</small></div>
      {canManage&&selected.status==='draft'&&<button type="button" disabled={busy} onClick={()=>void removeQuestion(q.id)}>Убрать</button>}
      {canManage&&selected.status==='open'&&!q.program_agenda_id&&q.status==='pending'&&<button type="button" disabled={busy} onClick={()=>void discussQuestion(q.id)}>Отметить рассмотренным</button>}
     </article>)}
    {canManage&&selected.status==='draft'&&<div className="govQuestionAdd">
     <h4>Добавить вопрос в повестку</h4>
     <label>Название<input value={questionTitle} onChange={e=>setQuestionTitle(e.target.value)} placeholder="Новый вопрос заседания"/></label>
     <label>Содержание<textarea rows={2} value={questionDescription} onChange={e=>setQuestionDescription(e.target.value)}/></label>
     <label>Время, мин.<input type="number" min={1} max={60} value={questionMinutes} onChange={e=>setQuestionMinutes(Number(e.target.value))}/></label>
     <button type="button" disabled={busy||questionTitle.trim().length<3||questionMinutes<1||questionMinutes>60} onClick={()=>void addQuestion()}>Добавить вопрос</button>
    </div>}
   </section>
   {canManage&&selected.status==='draft'&&<div className="govAgendaBuilder"><select value={programId} onChange={e=>setProgramId(e.target.value)}><option value="">Выберите подписанную госпрограмму…</option>{readyPrograms.filter(p=>!agenda.some(i=>i.program_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.title} · {p.responsible_ministry}</option>)}</select><label>Доклад, мин.<input type="number" min="1" max="60" value={reportMinutes} onChange={e=>setReportMinutes(Number(e.target.value)||7)}/></label><button disabled={busy||!programId} onClick={()=>void add()}>Добавить в повестку</button></div>}

   <div className="govAgenda">
    {agenda.length===0?<div className="emptyState">В повестке пока нет государственных программ.</div>:agenda.map(i=>{const p=program(i.program_id),v=vote(i.vote_id);return <article className={'govAgendaItem '+i.status} key={i.id}><div className="govAgendaNo">{String(i.agenda_no).padStart(2,'0')}</div><div><small>{p?.responsible_ministry||'Ответственный исполнитель'}</small><h3>{p?.title||'Государственная программа'}</h3><p>Доклад: {i.report_minutes} мин. · ответственный министр: {name(p?.responsible_minister_id||null)}</p><div className="govAgendaTags"><span>{i.status==='pending'?'Ожидает':i.status==='presenting'?'Доклад':i.status==='decision'?'Решение Правительства':i.status==='completed'?'Рассмотрено':'Снято'}</span>{v&&<span className={v.status==='open'?'live':''}>{v.status==='open'?'● Голосование открыто':v.result_label||'Голосование закрыто'}</span>}</div>{i.result_note&&<blockquote>{i.result_note}</blockquote>}</div>
     {canManage&&selected.status==='open'&&<div className="govAgendaActions">{i.status==='pending'&&<button disabled={busy||!!current} onClick={()=>void start(i.id)}>Начать доклад</button>}{i.status==='presenting'&&<button className="primary" disabled={busy} onClick={()=>void decision(i.id)}>Перейти к решению →</button>}{i.status==='decision'&&<button onClick={()=>onOpenVotes(i.vote_id||undefined)}>Открыть голосование →</button>}</div>}
    </article>})}
   </div>

   <footer className="govSessionRule"><b>Процедура решения</b><p>Если требуется голосование, решение принимается большинством присутствующих при наличии кворума не менее половины состава Правительства; при равенстве голосов решающим является голос председательствующего. Система голосования уже учитывает эту модель.</p></footer>
  </>}
 </section>;
}
