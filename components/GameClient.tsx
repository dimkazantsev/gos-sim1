'use client';
import {useEffect,useState} from 'react';
import {BookOpenText,ChevronLeft,Eye,FileText,GraduationCap,Landmark,LayoutDashboard,LogOut,MessageCircle,Radio,Settings2,ShieldCheck,UserRound,Vote,Wifi} from 'lucide-react';
import {useRepublicGame} from './game/useRepublicGame';
import type {Member,View,Vote} from './game/types';
import type {ReturnTypeRepublic} from './game/viewTypes';
import {initials} from './game/constants';
import PoliticalWallView from './game/PoliticalWallView';
import StateMetricsDock from './game/StateMetricsDock';
import CrisisRoom from './game/CrisisRoom';
import StagesView from './game/StagesView';
import PartiesView from './game/PartiesView';
import VotesView from './game/VotesView';
import DocumentsView from './game/DocumentsView';
import GradesView from './game/GradesView';
import TeacherView from './game/TeacherView';
import ProfileView from './game/ProfileView';
import ChatPanel from './game/ChatPanel';

const GENERIC_STUDENT='__generic_student_preview__';

function fmtTimer(seconds:number){
 const m=Math.floor(seconds/60),s=seconds%60;
 return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

function actorsForStudent(m:Member){
 const role=(m.role_title||'').toLowerCase();
 const x:{key:string;label:string}[]=[{key:'participant',label:m.full_name}];
 if(m.team)x.push({key:'party',label:m.team});
 if(role.includes('президент'))x.push({key:'president',label:'Президент Российской Федерации'});
 if(role.includes('правительств')||role.includes('министр'))x.push({key:'government',label:'Правительство Российской Федерации'});
 if(role.includes('депутат')||(role.includes('государственн')&&role.includes('дум')))x.push({key:'gd',label:'Государственная Дума'});
 if(role.includes('совет федерац')||role.includes('сенатор'))x.push({key:'sf',label:'Совет Федерации'});
 if(role.includes('министр'))x.push({key:'ministry',label:m.role_title||'Федеральный орган исполнительной власти'});
 if(role.includes('муницип')||role.includes('глава города'))x.push({key:'municipality',label:'Орган местного самоуправления'});
 if(role.includes('сми')||role.includes('журналист'))x.push({key:'media',label:'Средства массовой информации'});
 return x;
}

function memberMatchesInstitution(m:Member|undefined,institution:string){
 if(!m||m.kind==='observer')return false;
 const role=(m.role_title||'').toLowerCase();
 if(institution==='all'||institution==='factions')return m.kind==='student';
 if(institution==='gd')return role.includes('депутат')||(role.includes('государственн')&&role.includes('дум'));
 if(institution==='government')return role.includes('правительств')||role.includes('министр');
 if(institution==='sf')return role.includes('совет федерац')||role.includes('сенатор');
 if(institution==='committee')return role.includes('комитет')||role.includes('депутат');
 if(institution==='municipality')return role.includes('муницип')||role.includes('администрац')||role.includes('глава города');
 return false;
}

function buildStudentPreview(g:ReturnTypeRepublic,student:Member){
 const party=g.parties.find(p=>p.name===student.team);
 const evaluations=g.evaluations.filter(e=>e.user_id===student.user_id);
 const average=evaluations.length?evaluations.reduce((a,b)=>a+b.score,0)/evaluations.length:0;
 const visibleChannels=g.channels.filter(c=>c.kind==='public'||(c.kind==='team'&&!!student.team&&c.name==='Фракция · '+student.team));
 const visibleInvites=g.partyInvitations.filter(inv=>
  inv.invited_user_id===student.user_id||
  (!!party&&party.leader_user_id===student.user_id&&inv.party_id===party.id)
 );
 const visiblePartyDocs=party?g.partyDocuments.filter(d=>d.party_id===party.id):[];

 function canVote(v:Vote){
  if(v.voting_mode==='member')return memberMatchesInstitution(student,v.institution_key||'all');
  if(!party)return false;
  if(v.voting_mode==='faction')return party.leader_user_id===student.user_id;
  return (g.partyMandates.find(x=>x.user_id===student.user_id&&x.party_id===party.id)?.effective_mandates||0)>0;
 }

 const blocked=async()=>{
  g.setError('Это безопасный режим просмотра студента. Действия от его имени заблокированы. Вернитесь в режим преподавателя, чтобы управлять игрой.');
  return false;
 };
 const blockedNull=async()=>{
  g.setError('Это безопасный режим просмотра студента. Действия от его имени заблокированы.');
  return null;
 };
 const blockedVoid=async()=>{
  g.setError('Это безопасный режим просмотра студента. Действия от его имени заблокированы.');
 };
 const blockedMaybe=async()=>{
  g.setError('Это безопасный режим просмотра студента. Действия от его имени заблокированы.');
  return undefined;
 };

 return {
  ...g,
  me:student,
  teacher:false,
  channels:visibleChannels,
  partyInvitations:visibleInvites,
  partyDocuments:visiblePartyDocs,
  myEvaluations:evaluations,
  averageVsn:average,
  availableActors:()=>actorsForStudent(student),
  canVote,
  logout:blockedVoid,
  setTurn:blockedVoid,
  setTurnMinutes:blockedVoid,
  openStage:blockedVoid,
  nextStage:blockedVoid,
  setStageDeadline:blockedVoid,
  submitAction:blocked as typeof g.submitAction,
  judgeAction:blockedVoid,
  createPoliticalPost:blockedNull as typeof g.createPoliticalPost,
  addMediaToPoliticalPost:blocked as typeof g.addMediaToPoliticalPost,
  acceptPoliticalPost:blocked as typeof g.acceptPoliticalPost,
  rejectPoliticalPost:blocked as typeof g.rejectPoliticalPost,
  approvePostImpact:blocked as typeof g.approvePostImpact,
  createVoteFromPost:blockedNull as typeof g.createVoteFromPost,
  updateImpactRule:blocked as typeof g.updateImpactRule,
  revertImpactEntry:blocked as typeof g.revertImpactEntry,
  createParty:blocked as typeof g.createParty,
  updateParty:blockedVoid as typeof g.updateParty,
  setPartyLeader:blocked as typeof g.setPartyLeader,
  setPartyMandates:blocked as typeof g.setPartyMandates,
  inviteToParty:blocked as typeof g.inviteToParty,
  respondPartyInvitation:blocked as typeof g.respondPartyInvitation,
  cancelPartyInvitation:blocked as typeof g.cancelPartyInvitation,
  removePartyMember:blocked as typeof g.removePartyMember,
  proposePartyAgreement:blocked as typeof g.proposePartyAgreement,
  respondPartyAgreement:blocked as typeof g.respondPartyAgreement,
  submitPartyRegistration:blocked as typeof g.submitPartyRegistration,
  reviewPartyRegistration:blocked as typeof g.reviewPartyRegistration,
  applyPartyGhostLoss:blocked as typeof g.applyPartyGhostLoss,
  drawGhostVoting:blockedNull as typeof g.drawGhostVoting,
  clearPartyGhostLoss:blocked as typeof g.clearPartyGhostLoss,
  updateMember:blockedVoid as typeof g.updateMember,
  createVote:blocked as typeof g.createVote,
  castVote:blockedVoid as typeof g.castVote,
  closeVote:blockedNull as typeof g.closeVote,
  setEvaluation:blockedVoid as typeof g.setEvaluation,
  publishEvent:blocked as typeof g.publishEvent,
  triggerCrisis:blockedVoid,
  ghostVoting:blockedMaybe as typeof g.ghostVoting,
  createDocument:blocked as typeof g.createDocument,
  updateMetric:blockedVoid as typeof g.updateMetric,
  saveProfile:blocked as typeof g.saveProfile,
  savePartyIdentity:blocked as typeof g.savePartyIdentity,
  uploadPartyDocument:blocked as typeof g.uploadPartyDocument,
  reviewPartyDocument:blockedVoid as typeof g.reviewPartyDocument,
  createFormalDocument:blockedNull as typeof g.createFormalDocument,
  advanceFormalDocument:blocked as typeof g.advanceFormalDocument,
  updateFormalDraft:blocked as typeof g.updateFormalDraft,
  vetoFormalDocument:blocked as typeof g.vetoFormalDocument,
  resolveBudgetConciliation:blocked as typeof g.resolveBudgetConciliation,
  startBudgetRejectionBranch:blocked as typeof g.startBudgetRejectionBranch,
  sendText:blocked as typeof g.sendText,
  sendChatFile:blocked as typeof g.sendChatFile,
  toggleRecording:blockedVoid as typeof g.toggleRecording
 } as ReturnTypeRepublic;
}

export default function GameClient({gameId}:{gameId:string}){
 const g=useRepublicGame(gameId);
 const [view,setView]=useState<View>('dashboard');
 const [focusFormalId,setFocusFormalId]=useState('');
 const [viewAs,setViewAs]=useState('');
 const {game,me,currentStage,teacher,chatOpen,setChatOpen,loading,error,setError,secondsLeft,logout,touchPresence,logActivity}=g;

 const genericStudent:Member|undefined=teacher&&game?{
  game_id:game.id,user_id:GENERIC_STUDENT,full_name:'Студент · предпросмотр',group_name:null,
  kind:'student',role_title:'Участник',team:null,score:0,joined_at:new Date(0).toISOString(),party_joined_at:null
 }:undefined;
 const previewStudent=teacher&&viewAs
  ? viewAs===GENERIC_STUDENT
    ? genericStudent
    : g.members.find(m=>m.user_id===viewAs&&m.kind==='student')
  : undefined;
 const previewMode=!!previewStudent;
 const vg=previewStudent?buildStudentPreview(g,previewStudent):g;
 const shownMe=vg.me||me;

 useEffect(()=>{
  if(!me||previewMode)return;
  const labels:Record<View,string>={dashboard:'Политические процессы',stages:'Этапы',parties:'Партия',votes:'Голосование',documents:'НПА / Формальные институты',actions:'Архив решений',grades:'Оценки',profile:'Мой профиль',teacher:'Управление'};
  void touchPresence(view,'Открыл раздел «'+labels[view]+'»');
  const id=setInterval(()=>void touchPresence(view),30000);
  return()=>clearInterval(id);
 },[view,me?.user_id,previewMode]);

 useEffect(()=>{
  if(!previewMode)return;
  if(view==='teacher')setView('dashboard');
  const visible=vg.channels;
  if(visible.length&&!visible.some(c=>c.id===g.channelId))g.setChannelId(visible[0].id);
 },[previewStudent?.user_id]);

 if(loading||!game||!me||!shownMe)return <main className="loginPage"><div className="loaderCard"><div className="spinner"/><div><b>GOS//SIM</b><p className="muted">{error||'Подключение к игре…'}</p></div></div></main>;

 const nav:[View,string][] = previewMode
  ? [['dashboard','Процессы'],['parties','Партия'],['votes','Голосование'],['documents','НПА'],['stages','Этапы'],['grades','Оценки'],['profile','Профиль']]
  : teacher
   ? [['teacher','Управление'],['dashboard','Процессы'],['parties','Партии'],['votes','Голосования'],['documents','НПА'],['stages','Этапы'],['grades','Оценки'],['profile','Профиль']]
   : [['dashboard','Процессы'],['parties','Партия'],['votes','Голосование'],['documents','НПА'],['stages','Этапы'],['grades','Оценки'],['profile','Профиль']];

 const navIcon=(key:View)=>{
  const P=key==='teacher'?Settings2:key==='dashboard'?LayoutDashboard:key==='parties'?Landmark:key==='votes'?Vote:key==='documents'?FileText:key==='stages'?BookOpenText:key==='grades'?GraduationCap:UserRound;
  return <P aria-hidden="true" strokeWidth={1.9}/>;
 };

 return <div className={'simShell '+(previewMode?'studentPreviewShell':'')}>
  <aside className="simSidebar">
   <div className="sidebarBrand">
    <div className="simLogo"><ShieldCheck aria-hidden="true"/><span>GS</span></div>
    <div><b>GOS//SIM</b><span>Республика Политология</span></div>
   </div>

   <section className="sidebarStage">
    <div className="sidebarStageNumber">{String(currentStage?.stage_no||game.current_round||1).padStart(2,'0')}</div>
    <div><small>ТЕКУЩИЙ ЭТАП</small><b>{currentStage?.title||game.title}</b></div>
    <span className={game.turn_open?'open':'paused'}>{game.turn_open?'Ход открыт':'Пауза'}</span>
   </section>

   <nav className="focusNav" aria-label="Разделы игры">
    <div className="focusNavInner">
     {nav.map(([k,label])=><button key={k} className={view===k?'active':''} onClick={()=>setView(k)} aria-current={view===k?'page':undefined}>{navIcon(k)}<span>{label}</span></button>)}
    </div>
   </nav>

   <div className="sidebarFooter">
    <div className="sidebarRealtime"><Wifi aria-hidden="true"/><span>{g.realtimeState==='connected'?'Синхронизация активна':g.realtimeState==='connecting'?'Подключение…':'Нет соединения'}</span><i className={g.realtimeState}/></div>
    <div className="sidebarUser">
     <div className="simAvatar">{initials(shownMe.full_name)}</div>
     <div className="simUserText"><b>{shownMe.full_name}</b><span>{previewMode?'Просмотр · '+(shownMe.role_title||'Участник'):shownMe.role_title||(teacher?'Преподаватель':'Участник')}</span></div>
     {previewMode?<button aria-label="Вернуться к преподавателю" className="sidebarIconButton" onClick={()=>setViewAs('')}><ChevronLeft/></button>:<button aria-label="Выйти" className="sidebarIconButton" onClick={logout}><LogOut/></button>}
    </div>
   </div>
  </aside>

  <div className="simWorkspace">
   <header className="simTop">
    <div className="mobileBrand"><div className="simLogo"><ShieldCheck aria-hidden="true"/><span>GS</span></div><b>GOS//SIM</b></div>
    <div className="simTopCenter">
     <div className="topStageCopy"><small>ЭТАП {String(currentStage?.stage_no||game.current_round||1).padStart(2,'0')}</small><strong>{currentStage?.title||game.title}</strong></div>
     <div className="topIndicators">
      <span className={`livePill ${game.turn_open?'on':'off'}`}><Radio aria-hidden="true"/>{game.turn_open?'ХОД ОТКРЫТ':'ПАУЗА'}</span>
      {game.turn_open&&game.turn_ends_at&&<span className="timerPill">{fmtTimer(secondsLeft)}</span>}
      <span className={`connectionPill ${g.realtimeState}`}><Wifi aria-hidden="true"/>{g.realtimeState==='connected'?'ONLINE':g.realtimeState==='connecting'?'SYNC':'OFFLINE'}</span>
     </div>
    </div>

    {teacher&&<label className={'viewAsSwitcher '+(previewMode?'active':'')}>
     <span>РЕЖИМ ПРОСМОТРА</span>
     <select value={viewAs} onChange={e=>setViewAs(e.target.value)}>
      <option value="">Преподаватель</option>
      <option value={GENERIC_STUDENT}>Студент · типовой вид</option>
      {g.members.some(m=>m.kind==='student')&&<optgroup label="Конкретный студент">
       {g.members.filter(m=>m.kind==='student').map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}{m.role_title?' · '+m.role_title:''}</option>)}
      </optgroup>}
     </select>
    </label>}

    <button className={`topChatButton ${chatOpen?'active':''}`} onClick={()=>setChatOpen(!chatOpen)} aria-label={chatOpen?'Закрыть связь':'Открыть связь'}><MessageCircle aria-hidden="true"/><span>Связь</span></button>
   </header>

   {previewMode&&<div className="studentPreviewBanner">
    <div><Eye aria-hidden="true"/><p><b>Режим студента:</b> {shownMe.full_name}{shownMe.team?' · '+shownMe.team:''}{shownMe.role_title?' · '+shownMe.role_title:''}. <strong>Действия от его имени заблокированы.</strong></p></div>
    <button onClick={()=>setViewAs('')}>Вернуться к преподавателю</button>
   </div>}

   <div className="simContentFlow">
    <StateMetricsDock g={vg}/>
    {!previewMode&&<div className="crisisShell"><CrisisRoom g={g}/></div>}

    <main className={`simMain ${chatOpen?'chatOpen':''} ${previewMode?'studentPreviewMain':''}`}>
     {error&&<div className="errorBox closable" onClick={()=>setError('')}>{error}</div>}
     {view==='dashboard'&&<PoliticalWallView g={vg} onOpenVotes={()=>setView('votes')} onOpenDocument={id=>{setFocusFormalId(id);setView('documents')}} onNavigate={v=>setView(v)}/>}
     {view==='stages'&&<StagesView g={vg} onOpenVotes={()=>setView('votes')}/>}
     {view==='parties'&&<PartiesView g={vg}/>}
     {view==='votes'&&<VotesView g={vg} onOpenDocument={id=>{setFocusFormalId(id);setView('documents')}} onOpenStages={()=>setView('stages')}/>}
     {view==='documents'&&<DocumentsView g={vg} focusId={focusFormalId} onOpenVotes={()=>setView('votes')}/>}
     {view==='grades'&&<GradesView g={vg}/>}
     {view==='actions'&&<PoliticalWallView g={vg} onOpenVotes={()=>setView('votes')} onOpenDocument={id=>{setFocusFormalId(id);setView('documents')}} onNavigate={v=>setView(v)}/>}
     {view==='profile'&&<ProfileView g={vg}/>}
     {view==='teacher'&&teacher&&!previewMode&&<TeacherView g={g} onOpenProcesses={()=>setView('dashboard')}/>}
    </main>
   </div>

   {chatOpen&&<ChatPanel g={vg}/>}
  </div>

  <nav className="mobileDock" aria-label="Мобильная навигация">
   {nav.slice(0,5).map(([k,label])=><button key={k} className={view===k?'active':''} onClick={()=>setView(k)}>{navIcon(k)}<span>{label}</span></button>)}
   <button className={view==='profile'?'active':''} onClick={()=>setView('profile')}><UserRound/><span>Ещё</span></button>
  </nav>
 </div>;
}