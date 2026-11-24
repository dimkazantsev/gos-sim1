'use client';
import {userError} from '@/lib/userError';
import StageModuleHeader from '../ui/StageModuleHeader';
import {useCallback,useEffect,useRef,useState} from 'react';
import InstitutionRegistrationPanel from './InstitutionRegistrationPanel';
import VoteBallotControls from './VoteBallotControls';
import type {Vote as GameVote} from './types';
import {CheckCircle2,FileText,RefreshCcw,Vote,Mic2,MessageCircleQuestion,ClipboardCheck,PencilLine} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import {hasActiveGameRole} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';

type AppointedIdentity={candidate_user_id:string|null;candidate_name:string;office_key:string;office_title:string};
 type Session={id:string;game_id:string;session_no:number;title:string;time_limit_minutes:number;agenda_document_id:string|null;status:'draft'|'open'|'closed';chair_user_id:string|null;created_at:string;opened_at:string|null;closed_at:string|null;agenda_approved_at:string|null;agenda_approved_by:string|null;agenda_vote_id:string|null;moderator_approved_by:string|null;moderator_approved_at:string|null;deleted_accepted_agenda_id:string|null};
type Item={id:string;session_id:string;program_id:string;agenda_no:number;report_minutes:number;status:'pending'|'presenting'|'decision'|'completed'|'withdrawn';vote_id:string|null;result_note:string|null;started_at:string|null;completed_at:string|null;qa_closed_at:string|null};
type Program={id:string;title:string;responsible_ministry:string;status:string;responsible_minister_id:string|null;signed_at:string|null;government_vote_id:string|null};
type Question={id:string;session_id:string;title:string;description:string;duration_minutes:number;program_agenda_id:string|null;status:'pending'|'discussed';created_at:string};
type SpeakerQuestion={id:string;game_id:string;session_id:string;agenda_item_id:string;asked_by:string;question_text:string;answer_text:string|null;answered_by:string|null;created_at:string;answered_at:string|null};
type Proposal={id:string;session_id:string|null;program_id:string;section_key:string;original_text:string;proposed_text:string;justification:string;status:'submitted'|'accepted'|'rejected';review_note:string|null;created_by:string;created_at:string;incorporated_at:string|null};

export default function GovernmentProgramSessionLab({g,onOpenVotes,onOpenDocument,onEditProgram,readOnly=false}:{g:ReturnTypeRepublic;onOpenVotes:(id?:string)=>void;onOpenDocument?:(id:string)=>void;onEditProgram?:(id:string)=>void;readOnly?:boolean}){
 const {game,me,teacher,members,votes,setError}=g;
 const [sessions,setSessions]=useState<Session[]>([]);
 const [identitySnapshot,setIdentitySnapshot]=useState<{gameId:string;rows:AppointedIdentity[]}>({gameId:'',rows:[]});
 const assignmentVersion=(g.officeAssignments||[]).filter(a=>a.status==='active'&&/правительств|министр/i.test(a.role_title)).map(a=>a.user_id+':'+a.role_title).sort().join('|');
 useEffect(()=>{if(!game?.id||!me?.user_id)return;let active=true;const gameId=game.id;
  void supabase.from('government_nominations').select('candidate_user_id,candidate_name,office_key,office_title').eq('game_id',gameId).eq('status','appointed').in('stage_no',[8,9]).order('appointed_at',{ascending:false}).limit(40).then(({data,error})=>{if(active&&!error)setIdentitySnapshot({gameId,rows:(data||[]) as AppointedIdentity[]})});
  return()=>{active=false};
 },[game?.id,me?.user_id,assignmentVersion]);
 const appointed=identitySnapshot.gameId===game?.id?identitySnapshot.rows:[];
 const [items,setItems]=useState<Item[]>([]);
 const [programs,setPrograms]=useState<Program[]>([]);
 const [questions,setQuestions]=useState<Question[]>([]);
 const [proposals,setProposals]=useState<Proposal[]>([]);
 const [speakerQuestions,setSpeakerQuestions]=useState<SpeakerQuestion[]>([]);
 const [questionDrafts,setQuestionDrafts]=useState<Record<string,string>>({});
 const [answerDrafts,setAnswerDrafts]=useState<Record<string,string>>({});
 const [reviewProgram,setReviewProgram]=useState(''),[reviewSection,setReviewSection]=useState('structure'),[reviewOriginal,setReviewOriginal]=useState(''),[reviewProposed,setReviewProposed]=useState(''),[reviewReason,setReviewReason]=useState('');
 const [pmReasons,setPmReasons]=useState<Record<string,string>>({}),pmRequestBusy=useRef(false);
 const [notice,setNotice]=useState('');
 const [expandedAmendments,setExpandedAmendments]=useState<string|null>(null);
 const [agendaEdit,setAgendaEdit]=useState<{session:string;original:string;body:string}|null>(null);
 const [selectedId,setSelectedId]=useState('');
 const [timeLimit,setTimeLimit]=useState(60);
 const [busy,setBusy]=useState(false);
 const [attendance,setAttendance]=useState<{session:string;users:string[]}>({session:'',users:[]});
 const onGovernmentAttendance=useCallback((session:string,users:string[])=>{setAttendance(previous=>previous.session===session&&previous.users.length===users.length&&users.every(id=>previous.users.includes(id))?previous:{session,users});},[]);
 const isPM=hasActiveGameRole(g,/^председатель\s+правительства(?:\s|$)/u);
 const isPresident=hasActiveGameRole(g,/^президент российской федерации$/u);
 const canManage=teacher||isPM||isPresident;
 const canSign=(teacher||isPM)&&!readOnly;
 const canApprove=(teacher||isPM)&&!readOnly;
 const stageOpen=g.stages.some(s=>s.stage_no===11&&s.status==='open');
 const canSubmit=(teacher||hasActiveGameRole(g,/^(?:председатель|заместитель\s+председателя)\s+правительства(?:\s|$)/u))&&!readOnly;

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
  const activeSession=sessionRows.find(x=>x.id===selectedId)||sessionRows.find(x=>x.status==='open')||sessionRows[0];
  const activeItem=((i.data||[]) as Item[]).find(x=>x.session_id===activeSession?.id&&x.status==='presenting');
  // At most one programme presentation is active. Fetch its questions only.
  // Each user can ask two questions; load only this report, up to 100 attendees.
  if(activeItem){
   const speaker=await supabase.from('government_program_speaker_questions').select('*')
     .eq('game_id',game.id).eq('agenda_item_id',activeItem.id)
     .order('created_at',{ascending:true}).limit(200);
   if(speaker.error){setError(userError(speaker.error));return;}
   setSpeakerQuestions((speaker.data||[]) as SpeakerQuestion[]);
  }else setSpeakerQuestions([]);
  if(!s.error){setSessions(sessionRows);if(!sessionRows.some(row=>row.id===selectedId)&&sessionRows[0])setSelectedId(activeSession?.id||sessionRows[0].id)}
  if(!i.error)setItems((i.data||[]) as Item[]);
  if(!p.error)setPrograms((p.data||[]) as Program[]);
  if(!q.error)setQuestions((q.data||[]) as Question[]);
  if(!r.error)setProposals((r.data||[]) as Proposal[]);
 }
 useGameTableSync(game?.id,['government_sessions','government_program_agenda','government_session_questions','state_program_review_proposals','state_programs','government_program_speaker_questions'],load,(me?.user_id||'')+':'+selectedId);

 const visibleSession=sessions.find(x=>x.id===selectedId)||sessions.find(x=>x.status==='open')||sessions[0];
 const agendaSummary=g.formalDocuments.find(d=>d.id===visibleSession?.agenda_document_id);
 useEffect(()=>{if(agendaSummary&&agendaSummary.body_text==null)void g.ensureFormalDocument(agendaSummary.id,agendaSummary.updated_at);},[game?.id,me?.user_id,agendaSummary?.id,agendaSummary?.updated_at,agendaSummary?.body_text]);
 if(!game||!me)return null;
 const activeGame=game;
 const selected=visibleSession;
 const agenda=selected?items.filter(x=>x.session_id===selected.id).sort((a,b)=>a.agenda_no-b.agenda_no):[];
 const pendingPmPrograms=programs.filter(p=>p.status==='pm_review'&&!p.signed_at);
 const readyPrograms=programs.filter(p=>p.status==='ready'||(
  p.status==='government_vote'&&!!p.signed_at&&!!p.government_vote_id
  &&votes.some(v=>v.id===p.government_vote_id&&v.status==='open'&&v.procedure_key==='state_program')
  &&!g.ballots.some(b=>b.vote_id===p.government_vote_id)
  &&!items.some(a=>a.program_id===p.id)
 ));
 const meetingQuestions=selected?questions.filter(q=>q.session_id===selected.id):[];
 const meetingProposals=selected?proposals.filter(p=>p.session_id===selected.id):[];
 const current=agenda.find(x=>x.status==='presenting'||x.status==='decision');
 const agendaDoc=selected?g.formalDocuments.find(d=>d.id===selected.agenda_document_id):undefined;
 const agendaVote=selected?.agenda_vote_id?votes.find(v=>v.id===selected.agenda_vote_id):undefined;
 const deletedAcceptedAgenda=!!selected?.deleted_accepted_agenda_id&&!selected.agenda_document_id&&agendaVote?.status==='closed'&&agendaVote.result_code==='passed'&&agendaVote.result_quorum_met;
 const agendaSigned=deletedAcceptedAgenda||!!selected?.agenda_approved_at&&agendaDoc?.status_code==='published';
 const agendaAccepted=deletedAcceptedAgenda||agendaSigned&&agendaVote?.status==='closed'&&agendaVote.result_code==='passed'&&agendaVote.result_quorum_met&&agendaVote.body===agendaDoc?.body_text;
 const registeredUsers=attendance.session===selected?.id?attendance.users:[];
 const mayCorrect=canApprove&&stageOpen&&!!selected&&selected.status!=='closed'&&!current&&!!agendaDoc?.body_text&&agendaVote?.status!=='open'&&agendaVote?.result_code!=='passed';
 const amendmentProgram=current?.status==='presenting'&&!!current.qa_closed_at?current.program_id:null;
 const autoMinutes=selected?g.formalDocuments.find(x=>x.doc_type==='minutes'&&x.metadata?.automatic_session_id===selected.id):undefined;
 const name=(id:string|null,office?:string)=>{const key=(office||'').trim().toLocaleLowerCase('ru-RU');const matches=appointed.filter(a=>a.candidate_user_id===id);const role=key==='prime_minister'?matches.find(a=>a.office_key==='prime_minister'):key?matches.find(a=>{const title=a.office_title.trim().toLocaleLowerCase('ru-RU');return title===key||title.endsWith(' — '+key)}):undefined;return role?.candidate_name||members.find(m=>m.user_id===id)?.full_name||'—';};
 const program=(id:string)=>programs.find(p=>p.id===id);
 const vote=(id:string|null)=>id?votes.find(v=>v.id===id):undefined;

 async function decidePmProgram(programId:string,action:'revision'|'ready'){
  if(!canSubmit||busy||pmRequestBusy.current||!pendingPmPrograms.some(p=>p.id===programId))return;
  const reason=(pmReasons[programId]||'').trim();
  if(action==='revision'&&(reason.length<10||reason.length>1500))return;
  pmRequestBusy.current=true;setBusy(true);
  try{
   const r=action==='revision'
    ?await supabase.rpc('request_state_program_revision',{p_program_id:programId,p_reason:reason})
    :await supabase.rpc('advance_state_program',{p_program_id:programId,p_action:'pm_ready'});
   if(r.error)throw r.error;
   setPmReasons(previous=>{const next={...previous};delete next[programId];return next});
   await load();
   setNotice(action==='revision'?'Государственная программа возвращена разработчикам с замечаниями.':'Государственная программа внесена в проект повестки Этапа 11.');
  }catch(e){setError(userError(e))}
  finally{pmRequestBusy.current=false;setBusy(false)}
 }
 async function submitReview(){
  if(!selected||reviewProgram!==amendmentProgram||!agendaAccepted||reviewProposed.trim().length<5||busy||selected.status!=='open')return;
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
  if(!selected||!canApprove||!stageOpen||busy)return;setBusy(true);
  try{if(!selected.agenda_document_id)throw new Error('Повестка ещё не сформирована');const r=teacher?await supabase.rpc('teacher_approve_government_agenda',{p_session_id:selected.id}):await supabase.rpc('sign_institution_meeting_agenda',{p_document_id:selected.agenda_document_id});if(r.error)throw r.error;await load();await g.refresh();setNotice('Повестка утверждена. Регистрация на заседание открыта.');}
  catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function open(){if(!selected||!canApprove||busy)return;setBusy(true);
  try{const r=await supabase.rpc('open_government_session',{p_session_id:selected.id});if(r.error)throw r.error;await load();setNotice('Регистрация открыта. После регистрации всех членов голосование откроется автоматически; при наличии кворума его можно открыть для присутствующих.');}
  catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function openAgendaVote(){
  if(!selected||!canApprove||busy)return;setBusy(true);
  try{const r=await supabase.rpc('open_government_agenda_vote',{p_session_id:selected.id});if(r.error)throw r.error;await load();await g.refresh();}catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function saveAgendaText(){
  if(!selected||!mayCorrect||agendaEdit?.session!==selected.id||busy)return;setBusy(true);
  try{const r=await supabase.rpc('correct_government_agenda_text',{p_session_id:selected.id,p_body:agendaEdit.body,p_expected_body:agendaEdit.original});if(r.error)throw r.error;setAgendaEdit(null);await load();setNotice(teacher?'Текст исправлен. Утвердите новую редакцию и вынесите её на повторное голосование.':'Текст исправлен. Подпишите новую редакцию и вынесите её на повторное голосование.');}catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function returnForAmendments(programId:string){
  if(!canApprove||busy)return;setBusy(true);
  const accepted=meetingProposals.filter(p=>p.program_id===programId&&p.status==='accepted'&&!p.incorporated_at);
  const reason=('Внесите одобренные поправки в паспорт программы и повторно направьте его на согласование. '+accepted.map(p=>p.proposed_text).join('; ')).slice(0,1500);
  try{const r=await supabase.rpc('request_state_program_revision',{p_program_id:programId,p_reason:reason});if(r.error)throw r.error;await load();setNotice('Ответственному министерству возвращена ГП для внесения одобренных поправок.');}catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function confirmAmendments(programId:string){
  if(!selected||!canApprove||busy)return;setBusy(true);
  try{const r=await supabase.rpc('confirm_government_program_amendments',{p_session_id:selected.id,p_program_id:programId});if(r.error)throw r.error;await load();setNotice('Внесение одобренных поправок подтверждено.');}catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function editProgramme(id:string){
  if(readOnly||busy||!onEditProgram)return;
  setBusy(true);setNotice('');
  try{
   const r=await supabase.rpc('begin_stage11_program_revision',{p_program_id:id});
   if(r.error)throw r.error;
   onEditProgram(id);
  }catch(e){setError(userError(e))}
  finally{setBusy(false)}
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
 async function closeDiscussion(item:Item){
  if(!canApprove||busy)return;setBusy(true);
  try{const r=await supabase.rpc('close_government_program_questions',{p_item_id:item.id});if(r.error)throw r.error;if(reviewProgram!==item.program_id){setReviewSection('structure');setReviewOriginal('');setReviewProposed('');setReviewReason('');}setReviewProgram(item.program_id);setExpandedAmendments(item.id);await load();setNotice('Обсуждение завершено. Рассмотрите поправки либо переходите к итоговому голосованию, если их нет.');}catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function decision(id:string){
  if(!canApprove||busy)return;setBusy(true);
  try{const r=await supabase.rpc('open_program_vote_from_agenda',{p_item_id:id});if(r.error)throw r.error;await load();await g.refresh();}catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function sign(programId:string){
  if(!canSign||busy)return;setBusy(true);
  try{const r=await supabase.rpc('sign_adopted_state_program',{p_program_id:programId});if(r.error)throw r.error;await load();setNotice('Государственная программа опубликована.');}
  catch(e){setError(userError(e))}finally{setBusy(false)}
 }
 async function close(){if(!selected)return;setBusy(true);const r=await supabase.rpc('close_government_session',{p_session_id:selected.id});if(r.error)setError(userError(r.error));else await load();setBusy(false)}

 async function finishVote(v:GameVote){
  if(!canApprove||busy||v.status!=='open'||!confirm('Завершить голосование и зафиксировать итог по поданным голосам?'))return;
  setBusy(true);try{await g.closeVote(v.id);await load()}finally{setBusy(false)}
 }
 function ballotPanel(v:GameVote,programme:boolean){
  const mine=g.ballots.find(b=>b.vote_id===v.id&&b.voter_id===me!.user_id);
  const allowed=stageOpen&&!readOnly&&g.canVote(v)&&registeredUsers.includes(me!.user_id);
  const pending=registeredUsers.some(id=>Number(v.electorate_snapshot?.weights?.[id]||0)>0&&!g.ballots.some(b=>b.vote_id===v.id&&b.voter_id===id));
  const tally=g.tally(v),closed=v.status==='closed';
  return <section className="govMeetingSpeakerQuestions" aria-label={programme?'Голосование по государственной программе':'Голосование за повестку'}>
   <h5>{closed?'Результат голосования':programme?'Решение по государственной программе':'Голосование за повестку'}</h5>
   <p>{programme?'Принять: ':'За: '}{closed?v.result_yes??tally.yes:tally.yes} · {programme?'Отклонить: ':'Против: '}{closed?v.result_no??tally.no:tally.no}{programme&&<> · Вернуть на доработку: {closed?v.result_abstain??tally.abstain:tally.abstain}</>}</p>
   {closed?<strong>{v.result_label||v.result_code}</strong>:<>
    {g.canVote(v)?<VoteBallotControls key={v.id} vote={v} maxWeight={g.ballotWeight(v)} canCast={allowed} ballot={mine} onSubmit={(yes,no,abstain)=>g.castVoteAllocation(v,yes,no,abstain)}/>:!teacher&&<p>Право голоса имеют зарегистрированные члены Правительства.</p>}
    {g.canVote(v)&&!allowed&&!readOnly&&<p>Для голосования зарегистрируйтесь на заседание.</p>}
    {canApprove&&<button type="button" className="primary" disabled={busy||!stageOpen||!teacher&&(registeredUsers.length===0||pending)} onClick={()=>void finishVote(v)}>Завершить голосование</button>}
   </>}
  </section>;
 }
 return <section className="govSessionLab">
  <StageModuleHeader variant="government" eyebrow="Этап 11 · Правительство Российской Федерации" title="Рассмотрение государственных программ" description="Этап 10: проверка и внесение ГП в повестку. Этап 11: подпись, регистрация, голосование за повестку, обсуждение и поправки к каждой ГП, затем итоговое решение." stats={[{label:'Государственные программы',value:String(programs.length)},{label:'Повестка',value:agendaAccepted?'Принята':agendaVote?.status==='open'?'На голосовании':agendaSigned?'Утверждена':selected?'На согласовании':'Не создана'}]}/>
  <div className="govMeetingFlow" aria-label="Порядок рассмотрения">
   <div><span>01</span><strong>Подготовка повестки</strong><small>Из согласованных ГП</small></div>
   <div><span>02</span><strong>Подпись и регистрация</strong><small>Председатель и члены Правительства</small></div>
   <div><span>03</span><strong>Голосование за повестку</strong><small>Утверждение документа</small></div>
   <div><span>04</span><strong>Обсуждение и поправки</strong><small>По каждой программе</small></div>
   <div><span>05</span><strong>Решение по ГП</strong><small>Принятие, доработка или отклонение</small></div>
  </div>
  {canSubmit&&<section className="govMeetingAuto govPmReview" aria-label="Предварительное согласование государственных программ">
   <div><span className="govEyebrow">Предварительное согласование</span><h3>ГП, поступившие Председателю Правительства</h3><p>Рассмотрите программу до включения в проект повестки. Возврат требует письменных замечаний; после исправлений программа снова поступит непосредственно Председателю.</p></div>
   {pendingPmPrograms.length===0?<p>Государственных программ, ожидающих решения Председателя, сейчас нет.</p>:
    <div className="govPmReviewItems">{pendingPmPrograms.map(p=><article className="govPmReviewItem" key={p.id}>
     <header><div><strong>{p.title}</strong><small>{p.responsible_ministry}</small></div><span>На согласовании</span></header>
     <label>Причина возврата на доработку
      <textarea rows={3} maxLength={1500} disabled={busy} value={pmReasons[p.id]||''} onChange={e=>setPmReasons(old=>({...old,[p.id]:e.target.value}))} placeholder="Укажите, что исправить в целях, показателях, мероприятиях или финансировании"/>
      <small>Для возврата напишите причину длиной не менее 10 символов.</small>
     </label>
     <div className="govPmReviewActions">
      <button type="button" disabled={busy||(pmReasons[p.id]||'').trim().length<10} onClick={()=>void decidePmProgram(p.id,'revision')}>Вернуть на доработку</button>
      <button type="button" className="primary" disabled={busy} onClick={()=>void decidePmProgram(p.id,'ready')}>Внести в повестку</button>
     </div>
    </article>)}</div>}
  </section>}
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
    <div className="govMeetingAgendaHead"><div><span className="govEyebrow">Официальный документ · Заседание № {selected.session_no}</span><h3>Повестка заседания Правительства</h3><p>{agenda.length} государственных программ · {selected.time_limit_minutes} минут по регламенту. {agendaAccepted?(deletedAcceptedAgenda?'Принята голосованием. Документ удалён из реестра; решение сохранено.':'Принята голосованием Правительства.'):agendaVote?.status==='open'?'Голосование по повестке идёт.':agendaVote?.status==='closed'?'Повестка не принята. Необходима корректировка.':agendaSigned?'Утверждена; ожидается голосование.':(teacher?'Ожидается утверждение повестки.':'Ожидается личная подпись Председателя Правительства.')}</p></div>
     <div className="govMeetingAgendaHeadActions">{selected.agenda_document_id&&<button type="button" className="secondary" onClick={()=>onOpenDocument?.(selected.agenda_document_id!)} disabled={!onOpenDocument}><FileText size={17}/>Открыть документ</button>}<button type="button" className="secondary" onClick={()=>void load()} disabled={busy}><RefreshCcw size={17}/>Обновить</button></div></div>
    {meetingQuestions.length>0&&<div className="govLegacyQuestions">{meetingQuestions.map((q,i)=><div key={q.id}><span>{i+1}.</span><strong>{q.title}</strong><small>{q.status==='discussed'?'Рассмотрен':'Дополнительный вопрос'}</small></div>)}</div>}
    {(!agendaEdit||agendaEdit.session!==selected.id)&&agendaDoc?.body_text&&<section className="civicAgendaSyncedPreview" aria-label="Текст повестки"><strong>Текст повестки</strong><div className="govMeetingAgendaText">{agendaDoc.body_text}</div></section>}
    <div className="govMeetingAgendaActions">
     <div><strong>{selected.status==='closed'?'Заседание завершено':selected.status==='open'?'Заседание открыто':selected.agenda_approved_at?'Повестка утверждена':'Ожидает утверждения'}</strong><small>Председательствующий: {name(selected.chair_user_id,'prime_minister')}.</small></div>
     {canApprove&&selected.status==='draft'&&!agendaSigned&&<><button type="button" className="govMeetingRefreshPrograms secondary" aria-label="Обновить список государственных программ" disabled={busy} onClick={()=>void sync()}><RefreshCcw size={17} aria-hidden="true"/><span>Обновить список ГП</span></button><button type="button" className="primary" disabled={busy||!stageOpen||agenda.length===0} onClick={()=>void approve()}><ClipboardCheck size={17}/>{teacher?'Утвердить повестку':'Сохранить и подписать'}</button></>}
     {canApprove&&selected.status==='draft'&&agendaSigned&&<button type="button" className="primary" disabled={busy||!stageOpen} onClick={()=>void open()}><Mic2 size={17}/>Открыть регистрацию</button>}
     {canApprove&&teacher&&selected.status==='open'&&!selected.agenda_document_id&&!deletedAcceptedAgenda&&<button type="button" className="secondary" disabled={busy} onClick={()=>void sync()}><RefreshCcw size={17}/>Сформировать новую повестку</button>}
     {canApprove&&selected.status==='open'&&!agendaSigned&&!!selected.agenda_document_id&&<button type="button" className="primary" disabled={busy||!stageOpen||agenda.length===0} onClick={()=>void approve()}><ClipboardCheck size={17}/>{teacher?'Утвердить повестку':'Подписать повестку'}</button>}
     {canApprove&&selected.status==='open'&&agendaSigned&&!selected.agenda_vote_id&&<button type="button" className="primary" disabled={busy||!stageOpen||registeredUsers.length===0} onClick={()=>void openAgendaVote()}><Vote size={17}/>Начать голосование по повестке</button>}
     {agendaVote&&<button type="button" className="secondary" onClick={()=>onOpenVotes(agendaVote.id)}><Vote size={17}/>Открыть в реестре голосований</button>}
     {mayCorrect&&<button type="button" className="secondary" onClick={()=>setAgendaEdit(agendaEdit?.session===selected.id?null:{session:selected.id,original:agendaDoc!.body_text!,body:agendaDoc!.body_text!})}><PencilLine size={16}/>Корректировать текст повестки</button>}
     {canApprove&&selected.status==='open'&&agendaAccepted&&<button type="button" disabled={busy||!!current||agenda.some(a=>a.status==='pending'&&program(a.program_id)?.status==='ready')} onClick={()=>void close()}>Закрыть заседание</button>}
     {selected.status==='closed'&&autoMinutes&&onOpenDocument&&<button type="button" className="secondary" onClick={()=>onOpenDocument(autoMinutes.id)}><FileText size={17}/>Опубликованный протокол</button>}
    </div>
    {mayCorrect&&agendaEdit?.session===selected.id&&<div className="govReviewForm"><label>Текст новой редакции<textarea rows={10} maxLength={20000} value={agendaEdit.body} onChange={e=>setAgendaEdit({...agendaEdit,body:e.target.value})}/></label><button type="button" className="primary" disabled={busy||agendaEdit.body.trim().length<80||agendaEdit.body.trim()===agendaEdit.original.trim()} onClick={()=>void saveAgendaText()}>Сохранить корректировку</button></div>}
    {!stageOpen&&selected.status==='draft'&&<p className="govMeetingHint govMeetingAgendaStageHint">Проект сформирован в реестре НПА. Утверждение доступно после открытия Этапа 11.</p>}
   </section>
   {selected.status!=='closed'&&<InstitutionRegistrationPanel key={selected.id} g={g} stageNo={11} initialBody="government" allowedBodies={['government']} sessionId={selected.id} defaultOpen governmentIntegrated governmentOfficeNames={appointed} onGovernmentAttendance={onGovernmentAttendance} readOnly={readOnly||!stageOpen||selected.status!=='open'||!agendaSigned} onOpenDocument={onOpenDocument}/>}
   {agendaVote&&ballotPanel(agendaVote,false)}
   {!agendaAccepted&&selected.status==='open'&&<p className="govMeetingHint">Для рассмотрения ГП зарегистрируйте присутствующих, обеспечьте кворум и примите повестку большинством голосов.</p>}
   <section className="govMeetingProgrammeList" aria-label="Представление государственных программ">
    <div className="govMeetingListHeader"><h3>Государственные программы в повестке</h3><p>Для каждой программы: обсуждение → поправки → итоговое голосование. Принятая ГП включается в бюджет, возвращённая редактируется, отклонённая окончательна.</p></div>
    {agenda.length===0?<p className="govMeetingHint">В повестке ещё нет государственных программ.</p>:agenda.map((item)=>{
      const p=program(item.program_id),v=vote(item.vote_id);
      const qa=speakerQuestions.filter(q=>q.agenda_item_id===item.id);
      const awaiting=qa.filter(q=>!q.answer_text);
      const speaker=canApprove||p?.responsible_minister_id===me.user_id;
      const itemProposals=meetingProposals.filter(q=>q.program_id===item.program_id);
      const amendmentsOpen=expandedAmendments===item.id;
      const maySubmitAmendment=!!p&&stageOpen&&!readOnly&&agendaAccepted&&selected.status==='open'&&amendmentProgram===item.program_id&&me.kind!=='observer';
      const pendingAmendments=itemProposals.some(q=>q.status==='submitted');
      const acceptedAmendments=itemProposals.filter(q=>q.status==='accepted');
      const unincorporated=acceptedAmendments.some(q=>!q.incorporated_at);
      const mayEdit=!readOnly&&!!onEditProgram&&p?.signed_at==null&&!p?.government_vote_id&&!item.vote_id&&
        !!p&&['draft','revision','minister_review','pm_review','ready'].includes(p.status)&&
        (teacher||p.responsible_minister_id===me.user_id)&&g.stages.some(s=>s.stage_no===11&&s.status==='open');
      return <article className={'govMeetingProgramme govMeetingProgramme-'+item.status} key={item.id}>
       <header><span className="govMeetingProgrammeNo">{String(item.agenda_no).padStart(2,'0')}</span><div><span className="govEyebrow">{p?.responsible_ministry||'Ответственное министерство'}</span><h4>{p?.title||'Государственная программа'}</h4><p>Докладчик: {name(p?.responsible_minister_id||null,p?.responsible_ministry)} · Регламент: {item.report_minutes} минут</p></div><strong className="govMeetingProgrammeStatus">{item.status==='pending'?(p?.status==='revision'?'На доработке':'Ожидает доклада'):item.status==='presenting'?(item.qa_closed_at?'Поправки':'Обсуждение'):item.status==='decision'?'Голосование':item.status==='completed'?'Рассмотрена':'Снята с рассмотрения'}</strong></header>
       {item.result_note&&<p className="govMeetingDecisionNote">{item.result_note}</p>}
       {item.status==='presenting'&&!item.qa_closed_at&&<div className="govMeetingSpeakerQuestions" aria-label="Вопросы выступающему">
        <div className="govMeetingSpeakerHead"><div><h5><MessageCircleQuestion size={18}/>Вопросы к докладчику</h5><p>После выступления участники задают вопросы. На каждый вопрос нужно ответить до открытия голосования.</p></div><span>{qa.length} вопросов</span></div>
        {qa.length>0&&<div className="govMeetingSpeakerList">{qa.map(q=><div key={q.id} className="govMeetingSpeakerEntry"><div><strong>{name(q.asked_by)}</strong><p>{q.question_text}</p></div>{q.answer_text?<div className="govMeetingSpeakerAnswer"><strong><CheckCircle2 size={15}/>Ответ: {name(q.answered_by)}</strong><p>{q.answer_text}</p></div>:speaker?<div className="govMeetingSpeakerInput"><label>Ответ на вопрос<textarea rows={2} maxLength={4000} value={answerDrafts[q.id]||''} onChange={e=>setAnswerDrafts(old=>({...old,[q.id]:e.target.value}))}/></label><button type="button" disabled={busy||(answerDrafts[q.id]||'').trim().length<2} onClick={()=>void answer(q.id)}>Ответить</button></div>:<small>Ожидает ответа докладчика</small>}</div>)}</div>}
        {me.kind!=='observer'&&<div className="govMeetingSpeakerInput"><label>Задать вопрос выступающему<textarea rows={2} maxLength={2000} placeholder="Сформулируйте вопрос по целям, мероприятиям или финансированию программы" value={questionDrafts[item.id]||''} onChange={e=>setQuestionDrafts(old=>({...old,[item.id]:e.target.value}))}/></label><button type="button" disabled={busy||(questionDrafts[item.id]||'').trim().length<10} onClick={()=>void ask(item.id)}>Отправить вопрос</button></div>}
        {canApprove&&<div className="govMeetingSpeakerFinish"><small>{awaiting.length?('Ожидают ответа: '+awaiting.length):'Ответы на вопросы завершены.'}</small><button type="button" className="primary" disabled={busy||awaiting.length>0} onClick={()=>void closeDiscussion(item)}><ClipboardCheck size={17}/>Завершить обсуждение и перейти к поправкам</button></div>}
       </div>}
       <div className="govMeetingProgrammeActions">
        <button type="button" className="secondary" aria-expanded={amendmentsOpen} aria-controls={"gov-amendments-"+item.id} onClick={()=>{if(amendmentsOpen){setExpandedAmendments(null);return}setExpandedAmendments(item.id);if(maySubmitAmendment&&reviewProgram!==item.program_id){setReviewProgram(item.program_id);setReviewSection('structure');setReviewOriginal('');setReviewProposed('');setReviewReason('');}}}><PencilLine size={16}/>Поправки{itemProposals.length>0?' ('+itemProposals.length+')':''}</button>
        {mayEdit&&<button type="button" className="secondary" disabled={busy} onClick={()=>void editProgramme(p.id)}><PencilLine size={16}/>Редактировать</button>}
        {canApprove&&agendaAccepted&&selected.status==='open'&&item.status==='pending'&&(p?.status==='ready'||p?.status==='government_vote')&&<button type="button" className="primary" disabled={busy||!!current} onClick={()=>void start(item.id)}><Mic2 size={16}/>Начать представление</button>}
        {canApprove&&agendaAccepted&&p?.status==='ready'&&acceptedAmendments.length>0&&<button type="button" className="secondary" disabled={busy} onClick={()=>void confirmAmendments(item.program_id)}>Подтвердить внесение поправок в паспорт ГП</button>}
        {item.vote_id&&<button type="button" className="secondary" onClick={()=>onOpenVotes(item.vote_id!)}><Vote size={17}/>Открыть в реестре голосований</button>}
        {p?.status==='adopted'&&canSign&&!g.formalDocuments.some(d=>d.game_id===game!.id&&d.stage_no===11&&d.doc_type==='government_resolution'&&d.metadata?.state_program_id===p.id&&d.status_code==='published')&&<button type="button" className="primary" disabled={busy} onClick={()=>void sign(p.id)}>{p.signed_at?'Опубликовать постановление':teacher?'Удостоверить и опубликовать принятую ГП':'Подписать и опубликовать принятую ГП'}</button>}
       </div>
       {amendmentsOpen&&<section id={"gov-amendments-"+item.id} className="govMeetingSpeakerQuestions govMeetingInlineAmendments" aria-label="Поправки к государственной программе">
        <div className="govMeetingSpeakerHead"><div><h5>Поправки к государственной программе</h5><p>{p?.title||'Государственная программа'}</p></div></div>
        {maySubmitAmendment?<div className="govReviewForm">
    <label>Раздел<select value={reviewSection} onChange={e=>setReviewSection(e.target.value)}><option value="passport">Паспорт</option><option value="goals">Цели и показатели</option><option value="structure">Направления и мероприятия</option><option value="expenses">Финансирование и расходы</option><option value="other">Другое</option></select></label>
    <label>Действующая формулировка<textarea rows={2} value={reviewOriginal} onChange={e=>setReviewOriginal(e.target.value)} placeholder="Укажите исходный фрагмент программы"/></label>
    <label>Предлагаемая редакция<textarea rows={3} value={reviewProposed} onChange={e=>setReviewProposed(e.target.value)} placeholder="Опишите конкретное изменение"/></label>
    <label>Обоснование<textarea rows={2} value={reviewReason} onChange={e=>setReviewReason(e.target.value)} placeholder="Почему необходима корректировка?"/></label>
    <button type="button" className="primary" disabled={busy||reviewProgram!==item.program_id||reviewProposed.trim().length<5||me.kind==='observer'} onClick={()=>void submitReview()}>Внести поправку</button>
        </div>:<p className="govMeetingDecisionNote">{item.status==='pending'||item.status==='presenting'&&!item.qa_closed_at?'Внесение поправок доступно после завершения обсуждения.':'Внесение новых поправок сейчас недоступно.'}</p>}
   {itemProposals.length>0&&<div className="govReviewList"><h4>Внесённые поправки</h4>{itemProposals.map(p=><article key={p.id}>
    <div><b>{'Поправка'}</b><small>{p.status==='submitted'?'На рассмотрении':p.status==='accepted'?(p.incorporated_at?'Внесена в паспорт':'Одобрена · ожидает внесения'):'Отклонено'}</small></div>
    <p>{p.proposed_text}</p>{p.justification&&<p>Обоснование: {p.justification}</p>}
    {canApprove&&p.program_id===amendmentProgram&&p.status==='submitted'&&<div className="govMeetingCreateActions"><button type="button" disabled={busy} onClick={()=>void resolveReview(p.id,'accepted')}>Одобрить предложение</button><button type="button" disabled={busy} onClick={()=>void resolveReview(p.id,'rejected')}>Отклонить</button></div>}
   </article>)}</div>}
        {itemProposals.length===0&&<p className="govMeetingDecisionNote">Поправок пока нет.</p>}
       </section>}
       {item.status==='presenting'&&!!item.qa_closed_at&&<div className="govMeetingSpeakerQuestions"><h5>Поправки к государственной программе</h5><p>{pendingAmendments?'Сначала рассмотрите поступившие поправки.':unincorporated?'Одобренные поправки должны быть внесены в паспорт ГП.':'Все поправки рассмотрены или не поступали.'}</p>{canApprove&&unincorporated&&!pendingAmendments&&<button type="button" className="secondary" disabled={busy} onClick={()=>void returnForAmendments(item.program_id)}>Передать на внесение одобренных поправок</button>}{canApprove&&<button type="button" className="primary" disabled={busy||pendingAmendments||unincorporated} onClick={()=>void decision(item.id)}><Vote size={17}/>Открыть итоговое голосование по ГП</button>}</div>}
       {v&&ballotPanel(v,true)}
      </article>;
     })}
   </section>
   <footer className="govSessionRule"><b>Процедура решения</b><p>Этап 10: разработка и внесение ГП в повестку. Этап 11: подпись Председателя, регистрация всех членов, голосование за повестку, обсуждение, поправки и голосование по каждой ГП. Принятая программа автоматически учитывается в проекте бюджета. При отсутствии большинства проводится повторное голосование.</p></footer>
  </>}
 </section>;
}
