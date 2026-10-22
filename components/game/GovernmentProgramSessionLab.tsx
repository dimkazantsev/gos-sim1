'use client';
import {userError} from '@/lib/userError';
import StageModuleHeader from '../ui/StageModuleHeader';
import {useState} from 'react';
import {CheckCircle2,FileText,RefreshCcw,Vote,Mic2,MessageCircleQuestion,ClipboardCheck} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';

type Session={id:string;game_id:string;session_no:number;title:string;time_limit_minutes:number;agenda_document_id:string|null;status:'draft'|'open'|'closed';chair_user_id:string|null;created_at:string;opened_at:string|null;closed_at:string|null;agenda_approved_at:string|null;agenda_approved_by:string|null};
type Item={id:string;session_id:string;program_id:string;agenda_no:number;report_minutes:number;status:'pending'|'presenting'|'decision'|'completed'|'withdrawn';vote_id:string|null;result_note:string|null;started_at:string|null;completed_at:string|null;qa_closed_at:string|null};
type Program={id:string;title:string;responsible_ministry:string;status:string;responsible_minister_id:string|null;signed_at:string|null;government_vote_id:string|null};
type Question={id:string;session_id:string;title:string;description:string;duration_minutes:number;program_agenda_id:string|null;status:'pending'|'discussed';created_at:string};
type SpeakerQuestion={id:string;game_id:string;session_id:string;agenda_item_id:string;asked_by:string;question_text:string;answer_text:string|null;answered_by:string|null;created_at:string;answered_at:string|null};
type Proposal={id:string;session_id:string|null;program_id:string;section_key:string;original_text:string;proposed_text:string;justification:string;status:'submitted'|'accepted'|'rejected';review_note:string|null;created_by:string;created_at:string};

export default function GovernmentProgramSessionLab({g,onOpenVotes,onOpenDocument}:{g:ReturnTypeRepublic;onOpenVotes:(id?:string)=>void;onOpenDocument?:(id:string)=>void}){
 const {game,me,teacher,members,votes,setError}=g;
 const [sessions,setSessions]=useState<Session[]>([]);
 const [items,setItems]=useState<Item[]>([]);
 const [programs,setPrograms]=useState<Program[]>([]);
 const [questions,setQuestions]=useState<Question[]>([]);
 const [proposals,setProposals]=useState<Proposal[]>([]);
 const [speakerQuestions,setSpeakerQuestions]=useState<SpeakerQuestion[]>([]);
 const [questionDrafts,setQuestionDrafts]=useState<Record<string,string>>({});
 const [answerDrafts,setAnswerDrafts]=useState<Record<string,string>>({});
 const [reviewProgram,setReviewProgram]=useState(''),[reviewSection,setReviewSection]=useState('structure'),[reviewOriginal,setReviewOriginal]=useState(''),[reviewProposed,setReviewProposed]=useState(''),[reviewReason,setReviewReason]=useState('');
 const [notice,setNotice]=useState('');
 const [selectedId,setSelectedId]=useState('');
 const [timeLimit,setTimeLimit]=useState(60);
 const [busy,setBusy]=useState(false);
 const role=stageRoleTitles(g);
 const isPM=role.split(' | ').some(t=>/^председатель\s+правительства(?:\s|$)/u.test(t));
 const canManage=teacher||isPM||role.includes('президент');
 const canSign=teacher||isPM;
 const canApprove=isPM;

 async function load(){
  if(!game)return;
  const [s,i,p,q,r]=await Promise.all([
   supabase.from('government_sessions').select('*').eq('game_id',game.id).order('session_no',{ascending:false}).limit(20),
   supabase.from('government_program_agenda').select('*').eq('game_id',game.id).order('agenda_no').limit(150),
   supabase.from('state_programs').select('id,title,responsible_ministry,status,responsible_minister_id,signed_at,government_vote_id').eq('game_id',game.id).order('title').limit(100),
   supabase.from('government_session_questions').select('*').eq('game_id',game.id).order('created_at').limit(120),
   supabase.from('state_program_review_proposals').select('*').eq('game_id',game.id).order('created_at',{ascending:false}).limit(100)
  ]);
  const failure=[s,i,p,q,r].find(x=>x.error);if(failure?.error){setError(userError(failure.error));return;}
  const sessionRows=(s.data||[]) as Session[];
  const activeSession=sessionRows.find(x=>x.id===selectedId)||sessionRows[0];
  const activeItem=((i.data||[]) as Item[]).find(x=>x.session_id===activeSession?.id&&x.status==='presenting');
  // At most one programme presentation is active. Fetch its questions only.
  // Each user can ask two questions; 40 attendees means at most 80 rows per report.
  if(activeItem){
   const speaker=await supabase.from('government_program_speaker_questions').select('*')
     .eq('game_id',game.id).eq('agenda_item_id',activeItem.id)
     .order('created_at',{ascending:true}).limit(80);
   if(speaker.error){setError(userError(speaker.error));return;}
   setSpeakerQuestions((speaker.data||[]) as SpeakerQuestion[]);
  }else setSpeakerQuestions([]);
  if(!s.error){setSessions(sessionRows);if(!sessionRows.some(row=>row.id===selectedId)&&sessionRows[0])setSelectedId(sessionRows[0].id)}
  if(!i.error)setItems((i.data||[]) as Item[]);
  if(!p.error)setPrograms((p.data||[]) as Program[]);
  if(!q.error)setQuestions((q.data||[]) as Question[]);
  if(!r.error)setProposals((r.data||[]) as Proposal[]);
 }
 useGameTableSync(game?.id,['government_sessions','government_program_agenda','government_session_questions','formal_documents','state_program_review_proposals','state_programs','game_votes','game_ballots','institution_session_registrations','government_program_speaker_questions'],load,(me?.user_id||'')+':'+selectedId);

 if(!game||!me)return null;
 const activeGame=game;
 const selected=sessions.find(x=>x.id===selectedId)||sessions[0];
 const agenda=selected?items.filter(x=>x.session_id===selected.id).sort((a,b)=>a.agenda_no-b.agenda_no):[];
 const readyPrograms=programs.filter(p=>p.status==='ready'||(
  p.status==='government_vote'&&!!p.signed_at&&!!p.government_vote_id
  &&votes.some(v=>v.id===p.government_vote_id&&v.status==='open'&&v.procedure_key==='state_program')
  &&!g.ballots.some(b=>b.vote_id===p.government_vote_id)
  &&!items.some(a=>a.program_id===p.id)
 ));
 const meetingQuestions=selected?questions.filter(q=>q.session_id===selected.id):[];
 const reviewablePrograms=selected?programs.filter(p=>agenda.some(a=>a.program_id===p.id)):[];
 const meetingProposals=selected?proposals.filter(p=>p.session_id===selected.id):[];
 const current=agenda.find(x=>x.status==='presenting'||x.status==='decision');
 const name=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';
 const program=(id:string)=>programs.find(p=>p.id===id);
 const vote=(id:string|null)=>id?votes.find(v=>v.id===id):undefined;

 async function submitReview(){
  if(!selected||!reviewablePrograms.some(p=>p.id===reviewProgram)||reviewProposed.trim().length<5||busy||selected.status==='closed')return;
  setBusy(true);
  try{const r=await supabase.rpc('submit_government_agenda_program_proposal',{p_session_id:selected.id,p_program_id:reviewProgram,p_section_key:reviewSection,p_original_text:reviewOriginal,p_proposed_text:reviewProposed,p_justification:reviewReason});if(r.error)throw r.error;setReviewProposed('');setReviewOriginal('');setReviewReason('');await load();setNotice('Предложение к государственной программе зарегистрировано.')}catch(e){setError(e)}finally{setBusy(false)}
 }
 async function resolveReview(id:string,action:'accepted'|'rejected'){
  if(busy)return;setBusy(true);
  try{const r=await supabase.rpc('review_state_program_proposal',{p_proposal_id:id,p_action:action,p_note:''});if(r.error)throw r.error;await load()}catch(e){setError(e)}finally{setBusy(false)}
 }
 async function create(){
  if(!canApprove||busy)return;
  setBusy(true);setNotice('');
  try{
   const r=await supabase.rpc('create_government_session_from_programmes',{p_game_id:activeGame.id,p_time_limit_minutes:timeLimit});
   if(r.error)throw r.error;
   if(r.data)setSelectedId(String(r.data));
   await load();setNotice('Проект повестки автоматически сформирован из согласованных государственных программ.');
  }catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function sync(){
  if(!selected||!canApprove||busy)return;setBusy(true);
  try{const r=await supabase.rpc('sync_government_session_programmes',{p_session_id:selected.id});if(r.error)throw r.error;await load();setNotice('Повестка сверена с согласованными программами Этапа 10.');}
  catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function approve(){
  if(!selected||!canApprove||busy)return;setBusy(true);
  try{const r=await supabase.rpc('approve_government_session_agenda',{p_session_id:selected.id});if(r.error)throw r.error;await load();setNotice('Председатель Правительства утвердил повестку. Документ оформлен в Реестре НПА.');}
  catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function open(){if(!selected||!canApprove||busy)return;setBusy(true);
  try{const r=await supabase.rpc('open_government_session',{p_session_id:selected.id});if(r.error)throw r.error;await load();setNotice('Заседание открыто. Зарегистрируйтесь на заседание, затем начните представление программ.');}
  catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function start(id:string){if(!canApprove||busy)return;setBusy(true);
  try{const r=await supabase.rpc('start_government_program_report',{p_item_id:id});if(r.error)throw r.error;await load();}
  catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function ask(id:string){
  const value=(questionDrafts[id]||'').trim();
  if(busy||value.length<10||value.length>2000)return;setBusy(true);
  try{const r=await supabase.rpc('ask_government_program_speaker',{p_item_id:id,p_question:value});if(r.error)throw r.error;
   setQuestionDrafts(old=>({...old,[id]:''}));await load();setNotice('Вопрос докладчику зарегистрирован.');
  }catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function answer(id:string){
  const value=(answerDrafts[id]||'').trim();
  if(busy||value.length<2||value.length>4000)return;setBusy(true);
  try{const r=await supabase.rpc('answer_government_program_speaker',{p_question_id:id,p_answer:value});if(r.error)throw r.error;
   setAnswerDrafts(old=>({...old,[id]:''}));await load();
  }catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function decision(id:string){
  if(!canApprove||busy)return;setBusy(true);
  try{
   const qa=await supabase.rpc('close_government_program_questions',{p_item_id:id});if(qa.error)throw qa.error;
   const r=await supabase.rpc('open_program_vote_from_agenda',{p_item_id:id});if(r.error)throw r.error;
   await load();setNotice('Вопросы рассмотрены. Голосование по представленной государственной программе открыто.');
  }catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function sign(programId:string){
  if(!canSign||busy)return;setBusy(true);
  try{const r=await supabase.rpc('sign_adopted_state_program',{p_program_id:programId});if(r.error)throw r.error;await load();setNotice('Государственная программа подписана и опубликована.');}
  catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function close(){if(!selected)return;setBusy(true);const r=await supabase.rpc('close_government_session',{p_session_id:selected.id});if(r.error)setError(userError(r.error));else await load();setBusy(false)}

 return <section className="govSessionLab">
  <StageModuleHeader variant="government" eyebrow="Этап 11 · Правительство Российской Федерации" title="Рассмотрение государственных программ" description="Проекты Этапа 10 автоматически включаются в повестку. После утверждения Председателем Правительства проводятся доклады, вопросы и голосование; принятые программы подписываются и публикуются." stats={[{label:'Государственные программы',value:String(programs.length),detail:'Представляются после согласования на Этапе 10'},{label:'Повестка',value:selected?.agenda_approved_at?'Утверждена':selected?'На согласовании':'Не создана'}]}/>
  <div className="govMeetingFlow" aria-label="Порядок рассмотрения">
   <div><span>01</span><strong>Подготовка повестки</strong><small>Из согласованных ГП</small></div>
   <div><span>02</span><strong>Утверждение</strong><small>Председателем Правительства</small></div>
   <div><span>03</span><strong>Доклад и вопросы</strong><small>На заседании</small></div>
   <div><span>04</span><strong>Решение</strong><small>Голосование и публикация</small></div>
  </div>
  {sessions.length>0&&<div className="govSessionTabs govSessionTabsFull" aria-label="Заседания Правительства"><div>{sessions.map(session=><button type="button" key={session.id} className={session.id===selected?.id?'active':''} onClick={()=>setSelectedId(session.id)}><b>№ {session.session_no}</b><span>{session.title}</span><em>{session.status==='closed'?'Завершено':session.status==='open'?'Идёт':session.agenda_approved_at?'Повестка утверждена':'Проект повестки'}</em></button>)}</div></div>}
  {canApprove&&!selected&&<section className="govMeetingAuto" aria-label="Автоматическая повестка">
    <div><span className="govEyebrow">Подготовка заседания</span><h3>Государственные программы из Этапа 10</h3><p>Система самостоятельно сформирует проект официальной повестки из согласованных ГП. Ни одну программу не нужно переносить вручную.</p></div>
    <div className="govMeetingAutoPreview">{readyPrograms.length?readyPrograms.map((p,index)=><div key={p.id}><span>{String(index+1).padStart(2,'0')}</span><div><strong>{p.title}</strong><small>{p.responsible_ministry}</small></div></div>):<p>Согласованных программ для новой повестки пока нет. Завершите проверку ГП в «Работе» на Этапе 10.</p>}</div>
    <div className="govMeetingAutoActions"><label>Общий регламент, мин.<input type="number" min={5} max={240} value={timeLimit} onChange={e=>setTimeLimit(Number(e.target.value)||60)}/></label><button type="button" className="primary" disabled={busy||readyPrograms.length===0||timeLimit<5||timeLimit>240} onClick={()=>void create()}>Сформировать проект повестки</button></div>
   </section>}
  {notice&&<p role="status" className="govMeetingNotice">{notice}</p>}
  {!selected&&!canApprove&&<p className="govMeetingHint">Повестка появится после формирования и утверждения Председателем Правительства. Согласованные проекты ГП сохраняются в разделе «Работа».</p>}
  {selected&&<>
   <section className="govMeetingAgendaCard" aria-label="Официальная повестка Правительства">
    <div className="govMeetingAgendaHead"><div><span className="govEyebrow">Официальный документ · Заседание № {selected.session_no}</span><h3>Повестка заседания Правительства</h3><p>{agenda.length} государственных программ · {selected.time_limit_minutes} минут по регламенту. {selected.agenda_approved_at?'Утверждена Председателем Правительства.':'Сформирована автоматически и ожидает утверждения.'}</p></div>
     <div className="govMeetingAgendaHeadActions">{selected.agenda_document_id&&<button type="button" className="secondary" onClick={()=>onOpenDocument?.(selected.agenda_document_id!)} disabled={!onOpenDocument}><FileText size={17}/>Открыть документ</button>}<button type="button" className="secondary" onClick={()=>void load()} disabled={busy}><RefreshCcw size={17}/>Обновить</button></div></div>
    {meetingQuestions.length>0&&<div className="govLegacyQuestions">{meetingQuestions.map((q,i)=><div key={q.id}><span>{i+1}.</span><strong>{q.title}</strong><small>{q.status==='discussed'?'Рассмотрен':'Дополнительный вопрос'}</small></div>)}</div>}
    <div className="govMeetingAgendaActions">
     <div><strong>{selected.status==='closed'?'Заседание завершено':selected.status==='open'?'Заседание открыто':selected.agenda_approved_at?'Повестка утверждена':'Ожидает утверждения'}</strong><small>Председательствующий: {name(selected.chair_user_id)}.</small></div>
     {canApprove&&selected.status==='draft'&&!selected.agenda_approved_at&&<><button type="button" disabled={busy} onClick={()=>void sync()}><RefreshCcw size={16}/>Обновить список ГП</button><button type="button" className="primary" disabled={busy||agenda.length===0} onClick={()=>void approve()}><ClipboardCheck size={17}/>Утвердить повестку</button></>}
     {canApprove&&selected.status==='draft'&&!!selected.agenda_approved_at&&<button type="button" className="primary" disabled={busy} onClick={()=>void open()}><Mic2 size={17}/>Открыть заседание</button>}
     {canApprove&&selected.status==='open'&&<button type="button" disabled={busy||!!current} onClick={()=>void close()}>Закрыть заседание</button>}
    </div>
   </section>
   <section className="govMeetingProgrammeList" aria-label="Представление государственных программ">
    <div className="govMeetingListHeader"><h3>Государственные программы в повестке</h3><p>Для каждой программы: доклад → вопросы выступающему → голосование Правительства → оформление решения.</p></div>
    {agenda.length===0?<p className="govMeetingHint">В повестке ещё нет государственных программ.</p>:agenda.map((item)=>{
      const p=program(item.program_id),v=vote(item.vote_id);
      const qa=speakerQuestions.filter(q=>q.agenda_item_id===item.id);
      const awaiting=qa.filter(q=>!q.answer_text);
      const speaker=canApprove||p?.responsible_minister_id===me.user_id;
      return <article className={'govMeetingProgramme govMeetingProgramme-'+item.status} key={item.id}>
       <header><span className="govMeetingProgrammeNo">{String(item.agenda_no).padStart(2,'0')}</span><div><span className="govEyebrow">{p?.responsible_ministry||'Ответственное министерство'}</span><h4>{p?.title||'Государственная программа'}</h4><p>Докладчик: {name(p?.responsible_minister_id||null)} · Регламент: {item.report_minutes} минут</p></div><strong className="govMeetingProgrammeStatus">{item.status==='pending'?'Ожидает доклада':item.status==='presenting'?'Доклад и вопросы':item.status==='decision'?'Голосование':item.status==='completed'?'Рассмотрена':'Снята с рассмотрения'}</strong></header>
       {item.result_note&&<p className="govMeetingDecisionNote">{item.result_note}</p>}
       {item.status==='presenting'&&<div className="govMeetingSpeakerQuestions" aria-label="Вопросы выступающему">
        <div className="govMeetingSpeakerHead"><div><h5><MessageCircleQuestion size={18}/>Вопросы к докладчику</h5><p>После выступления участники задают вопросы. На каждый вопрос нужно ответить до открытия голосования.</p></div><span>{qa.length} вопросов</span></div>
        {qa.length>0&&<div className="govMeetingSpeakerList">{qa.map(q=><div key={q.id} className="govMeetingSpeakerEntry"><div><strong>{name(q.asked_by)}</strong><p>{q.question_text}</p></div>{q.answer_text?<div className="govMeetingSpeakerAnswer"><strong><CheckCircle2 size={15}/>Ответ: {name(q.answered_by)}</strong><p>{q.answer_text}</p></div>:speaker?<div className="govMeetingSpeakerInput"><label>Ответ на вопрос<textarea rows={2} maxLength={4000} value={answerDrafts[q.id]||''} onChange={e=>setAnswerDrafts(old=>({...old,[q.id]:e.target.value}))}/></label><button type="button" disabled={busy||(answerDrafts[q.id]||'').trim().length<2} onClick={()=>void answer(q.id)}>Ответить</button></div>:<small>Ожидает ответа докладчика</small>}</div>)}</div>}
        {me.kind!=='observer'&&<div className="govMeetingSpeakerInput"><label>Задать вопрос выступающему<textarea rows={2} maxLength={2000} placeholder="Сформулируйте вопрос по целям, мероприятиям или финансированию программы" value={questionDrafts[item.id]||''} onChange={e=>setQuestionDrafts(old=>({...old,[item.id]:e.target.value}))}/></label><button type="button" disabled={busy||(questionDrafts[item.id]||'').trim().length<10} onClick={()=>void ask(item.id)}>Отправить вопрос</button></div>}
        {canApprove&&<div className="govMeetingSpeakerFinish"><small>{awaiting.length?('Ожидают ответа: '+awaiting.length):'Ответы на вопросы завершены.'}</small><button type="button" className="primary" disabled={busy||awaiting.length>0} onClick={()=>void decision(item.id)}><Vote size={17}/>Завершить вопросы и открыть голосование</button></div>}
       </div>}
       <div className="govMeetingProgrammeActions">
        {canApprove&&selected.status==='open'&&item.status==='pending'&&<button type="button" className="primary" disabled={busy||!!current} onClick={()=>void start(item.id)}><Mic2 size={16}/>Начать представление</button>}
        {item.vote_id&&<button type="button" className={item.status==='decision'?'primary':'secondary'} onClick={()=>onOpenVotes(item.vote_id!)}><Vote size={17}/>{item.status==='decision'?'Перейти к голосованию':'Открыть результаты голосования'}</button>}
        {p?.status==='adopted'&&canSign&&!g.formalDocuments.some(d=>d.game_id===game!.id&&d.stage_no===11&&d.doc_type==='government_resolution'&&d.metadata?.state_program_id===p.id&&d.status_code==='published')&&<button type="button" className="primary" disabled={busy} onClick={()=>void sign(p.id)}>{p.signed_at?'Опубликовать постановление':'Подписать и опубликовать принятую ГП'}</button>}
       </div>
       {v?.status==='open'&&<p className="govMeetingVoteHint">Голосование открыто по этой программе. Участники, зарегистрированные на заседание, голосуют во вкладке «Голосования».</p>}
      </article>;
     })}
   </section>
  <details className="govMeetingExtra"><summary>Предложения и замечания к государственным программам</summary><section className="govProgramReview">
   <div className="govProgramReviewHeader"><div><h3>Государственные программы на рассмотрении</h3><p>Программы Этапа 10 рассматриваются после включения в повестку. Ранее открытое голосование без поданных голосов можно связать с докладом, не создавая дубликата.</p></div><span>{reviewablePrograms.length} программ</span></div>
   <div className="govProgramReviewGrid">{reviewablePrograms.length?reviewablePrograms.map(p=><article key={p.id}>
    <small>{p.responsible_ministry}</small><h4>{p.title}</h4>
    <span>{p.status==='ready'?'Готова к заседанию':p.status==='adopted'?(p.signed_at?'Подписана и опубликована':'Ожидает подписи Председателя Правительства'):p.status==='rejected'?'Отклонена':p.status==='government_vote'?'На голосовании':'В подготовке и согласовании'}</span>
    <p>{meetingProposals.filter(q=>q.program_id===p.id).length} предложений по изменению</p>
    <button type="button" onClick={()=>{setReviewProgram(p.id);document.getElementById('gov-review-form')?.scrollIntoView({block:'nearest',behavior:'smooth'})}}>Рассмотреть и предложить правку</button>
   </article>):<p>Сначала включите программу из этапа 10 в повестку заседания.</p>}</div>
   {reviewablePrograms.length>0&&selected.status!=='closed'&&<div id="gov-review-form" className="govReviewForm">
    <h4>Предложение к программе</h4>
    <label>Программа<select value={reviewProgram} onChange={e=>setReviewProgram(e.target.value)}><option value="">Выберите программу</option>{reviewablePrograms.map(p=><option value={p.id} key={p.id}>{p.title}</option>)}</select></label>
    <label>Раздел<select value={reviewSection} onChange={e=>setReviewSection(e.target.value)}><option value="passport">Паспорт</option><option value="goals">Цели и показатели</option><option value="structure">Направления и мероприятия</option><option value="expenses">Финансирование и расходы</option><option value="other">Другое</option></select></label>
    <label>Действующая формулировка<textarea rows={2} value={reviewOriginal} onChange={e=>setReviewOriginal(e.target.value)} placeholder="Укажите исходный фрагмент программы"/></label>
    <label>Предлагаемая редакция<textarea rows={3} value={reviewProposed} onChange={e=>setReviewProposed(e.target.value)} placeholder="Опишите конкретное изменение"/></label>
    <label>Обоснование<textarea rows={2} value={reviewReason} onChange={e=>setReviewReason(e.target.value)} placeholder="Почему необходима корректировка?"/></label>
    <button type="button" className="primary" disabled={busy||!reviewProgram||reviewProposed.trim().length<5||me.kind==='observer'} onClick={()=>void submitReview()}>Зарегистрировать предложение</button>
   </div>}
   {meetingProposals.length>0&&<div className="govReviewList"><h4>Реестр предложений</h4>{meetingProposals.map(p=><article key={p.id}>
    <div><b>{programs.find(x=>x.id===p.program_id)?.title||'Госпрограмма'}</b><small>{p.status==='submitted'?'На рассмотрении':p.status==='accepted'?'Одобрено к учёту':'Отклонено'}</small></div>
    <p>{p.proposed_text}</p>{p.justification&&<p>Обоснование: {p.justification}</p>}
    {canManage&&p.status==='submitted'&&<div className="govMeetingCreateActions"><button type="button" disabled={busy} onClick={()=>void resolveReview(p.id,'accepted')}>Одобрить предложение</button><button type="button" disabled={busy} onClick={()=>void resolveReview(p.id,'rejected')}>Отклонить</button></div>}
   </article>)}</div>}
   <p className="govReviewDisclaimer">Одобрение предложения фиксирует решение о корректировке. Подписанный паспорт и бюджет автоматически не изменяются: для изменения утверждённых сумм требуется отдельная процедура.</p>
  </section></details>
   <footer className="govSessionRule"><b>Процедура решения</b><p>Государственные программы разрабатываются на Этапе 10. На Этапе 11 Председатель утверждает автоматически подготовленную повестку, проводятся доклады и ответы на вопросы, затем голосование зарегистрированных участников. Принятые ГП подписываются и публикуются после положительного решения.</p></footer>
  </>}
 </section>;
}
