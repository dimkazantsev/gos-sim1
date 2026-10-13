'use client';
import {IconAction} from './ui/IconAction';
import {BrandIdentity,BrandName} from './ui/BrandIdentity';
import ChatToggleButton from './game/ChatToggleButton';
import {useEffect,useRef,useState} from 'react';
import {BookOpenText,CalendarDays,ChevronDown,ChevronLeft,ChevronRight,Eye,FileText,GraduationCap,GripVertical,Landmark,LayoutDashboard,LogOut,Menu,MessageCircle,Radio,Settings2,Share2,ShieldCheck,UserRound,Wallet,Vote as VoteIcon,Wifi} from 'lucide-react';
import {useRepublicGame} from './game/useRepublicGame';
import type {Member,View,Vote} from './game/types';
import type {ReturnTypeRepublic} from './game/viewTypes';
import {initials} from './game/constants';
import DashboardView from './game/DashboardView';
import {useDialog} from './ui/useDialog';
import PoliticalWallView from './game/PoliticalWallView';
import CrisisRoom from './game/CrisisRoom';
import StagesView from './game/StagesView';
import PartiesView from './game/PartiesView';
import VotesView from './game/VotesView';
import DocumentsView from './game/DocumentsView';
import GradesView from './game/GradesView';
import TeacherView from './game/TeacherView';
import ProfileView from './game/ProfileView';
import {PROFILE_SETUP_FIELDS,PROFILE_SETUP_LABELS,validProfileSetupStatus,type ProfileSetupStatus} from './game/profileSetup';
import RepublicComic from './game/RepublicComic';
import StageComics from './game/StageComics';
import GuidedTour,{getTourSteps,type TourTarget} from './game/GuidedTour';
import {useIntroProgress} from './game/introProgress';
import ChatPanel from './game/ChatPanel';
import EventWorkspace from './game/EventWorkspace';
import {AchievementCelebration} from './game/Achievements';
import {BlitzOverlay} from './game/Blitz';
import BudgetView from './game/BudgetView';
import {useSectionUpdates} from './game/useSectionUpdates';
import {supabase} from '@/lib/supabase';
import MobileDock from './game/MobileDock';
import {useSavedGameState,savedString} from './game/useSavedGameState';

const GENERIC_STUDENT='__generic_student_preview__';
type ScreenLocation={view:View;stageNo:number;documentId:string;voteId?:string;templateKey?:string};
const SCREEN_VIEWS=['dashboard','stages','parties','votes','documents','grades','actions','profile','events','teacher','budget'];
function validScreenHistory(value:unknown){
 if(!value||typeof value!=='object')return false;
 const history=value as {entries?:ScreenLocation[];index?:number};
 return Array.isArray(history.entries)&&history.entries.length>0&&history.entries.length<=60&&Number.isInteger(history.index)&&Number(history.index)>=0&&Number(history.index)<history.entries.length&&history.entries.every(e=>e&&SCREEN_VIEWS.includes(e.view)&&Number.isInteger(e.stageNo)&&e.stageNo>=0&&e.stageNo<=16&&typeof e.documentId==='string'&&e.documentId.length<=100&&(!e.voteId||typeof e.voteId==='string'&&e.voteId.length<=100)&&(!e.templateKey||typeof e.templateKey==='string'&&e.templateKey.length<=80));
}
function adjacentScreen(entries:ScreenLocation[],index:number,direction:-1|1,skipTeacher:boolean){
 for(let next=index+direction;next>=0&&next<entries.length;next+=direction){
  if(!skipTeacher||entries[next].view!=='teacher')return next;
 }
 return -1;
}

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
 if(institution==='all'||institution==='factions')return m.kind==='student'||(m.kind==='teacher'&&!['','руководитель симуляции','преподаватель','администратор'].includes(role.trim()));
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
  resetStageProgress:blocked as typeof g.resetStageProgress,
  setStageDeadline:blockedVoid,
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
  applyGhostVotingBatch:blocked as typeof g.applyGhostVotingBatch,
  deleteParty:blocked as typeof g.deleteParty,
  configureStageDeadline:blocked as typeof g.configureStageDeadline,
  updateMember:blocked as typeof g.updateMember,
  createVote:blocked as typeof g.createVote,
  castVote:blocked as typeof g.castVote,
  castVoteAllocation:blocked as typeof g.castVoteAllocation,
  setStudentMandates:blocked as typeof g.setStudentMandates,
  closeVote:blockedNull as typeof g.closeVote,
  setEvaluation:blockedVoid as typeof g.setEvaluation,
  publishEvent:blocked as typeof g.publishEvent,
  triggerCrisis:blockedVoid,
  ghostVoting:blockedMaybe as typeof g.ghostVoting,
  createDocument:blocked as typeof g.createDocument,
  updateMetric:blockedVoid as typeof g.updateMetric,
  saveProfile:blocked as typeof g.saveProfile,
  saveSignature:blocked as typeof g.saveSignature,
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

export default function GameClient({gameId,initialMobileMenuOpen=false}:{gameId:string;initialMobileMenuOpen?:boolean}){
 const g=useRepublicGame(gameId);
 // The game deliberately uses scheduled API refreshes instead of always-on
 // Supabase Realtime. A disconnected WebSocket is not the same as being offline.
 // Browser onLine is a network hint, not a server health check.
 const [browserOnline,setBrowserOnline]=useState(true);
 useEffect(()=>{
  const update=()=>setBrowserOnline(navigator.onLine);
  update();
  window.addEventListener('online',update);
  window.addEventListener('offline',update);
  return()=>{
   window.removeEventListener('online',update);
   window.removeEventListener('offline',update);
  };
 },[]);
 const connectionDisplay=g.realtimeState==='disconnected'&&browserOnline?'polling':g.realtimeState;
 const connectionLabel=connectionDisplay==='polling'?'По расписанию':connectionDisplay==='connected'?'В сети':connectionDisplay==='connecting'?'Подключение…':'Нет сети';
 const connectionDescription=connectionDisplay==='polling'?'Данные обновляются периодически, при действиях и открытии разделов. Это не проверка доступности сервера.':connectionDisplay==='connected'?'Постоянная синхронизация активна':connectionDisplay==='connecting'?'Подключение…':'Браузер сообщает об отсутствии сети';
 const [screenHistory,setScreenHistory,navigationHydrated,navigationRestored]=useSavedGameState<{entries:ScreenLocation[];index:number}>(gameId,g.me?.user_id,'navigation',{
  entries:[{view:'dashboard',stageNo:0,documentId:''}],index:0
 },validScreenHistory);
 const sharedLinkHandled=useRef(false);
 useEffect(()=>{
  if(!navigationHydrated||!g.me?.user_id||sharedLinkHandled.current)return;
  sharedLinkHandled.current=true;
  if(typeof URLSearchParams==='undefined'||!window.location?.search)return;
  const q=new URLSearchParams(window.location.search);
  const section=q.get('section');
  if(!section||!SCREEN_VIEWS.includes(section)||section==='teacher')return;
  const id=q.get('document')||'',vote=q.get('vote')||'',step=Number(q.get('stage')||0);
  const target:ScreenLocation={view:section as View,stageNo:Number.isInteger(step)&&step>=1&&step<=16?step:0,documentId:/^[0-9a-f-]{36}$/i.test(id)?id:'',voteId:/^[0-9a-f-]{36}$/i.test(vote)?vote:''};
  setScreenHistory(prev=>({entries:[target],index:0}));
 },[navigationHydrated,g.me?.user_id,gameId]);
 const sharedChatHandled=useRef(false);
 useEffect(()=>{
  if(sharedChatHandled.current||!navigationHydrated||!g.me||g.me.kind==='observer'||typeof window==='undefined'||typeof URLSearchParams==='undefined')return;
  const q=new URLSearchParams(window.location.search);
  if(q.get('openChat')!=='1')return;
  if(!g.channels.length)return;
  const desired=q.get('channel')||'';
  if(desired&&g.channels.some(c=>c.id===desired))g.setChannelId(desired);
  g.setChatOpen(true);
  sharedChatHandled.current=true;
 },[navigationHydrated,g.me?.user_id,g.channels,gameId]);
 async function shareCurrentScreen(){
  const u=new URL(window.location.href);
  // GitHub Pages serves one static HTML for all ?section=... links. Share the
  // dedicated public preview page, which forwards users to the same section.
  if(u.hostname==='dimkazantsev.github.io'&&u.pathname.startsWith('/gos-sim1/'))u.pathname='/gos-sim1/visit/';
  u.search='';u.hash='';u.searchParams.set('section',currentScreen.view);
  if(currentScreen.stageNo)u.searchParams.set('stage',String(currentScreen.stageNo));
  if(currentScreen.documentId)u.searchParams.set('document',currentScreen.documentId);
  if(currentScreen.voteId)u.searchParams.set('vote',currentScreen.voteId);
  try{
   if(navigator.share){await navigator.share({title:'ГОС.ID — Цифровая платформа России',url:u.toString()});return}
   await navigator.clipboard.writeText(u.toString());
   window.alert('Ссылка скопирована. Доступна участникам этой игры.');
  }catch(e){if((e as Error).name!=='AbortError')window.alert('Не удалось отправить ссылку.')}
 }
 const currentScreen=screenHistory.entries[screenHistory.index];
 const view=currentScreen.view;
 useEffect(()=>{g.setActiveView?.(view)},[g.setActiveView,view]);
 const focusFormalId=currentScreen.documentId;
 const focusStage=currentScreen.stageNo;
 const [viewAs,setViewAs]=useState('');
 const [viewAsOpen,setViewAsOpen]=useState(false);
 const viewAsRef=useRef<HTMLDivElement>(null);
 const [mobileMenuOpen,setMobileMenuOpen]=useState(initialMobileMenuOpen);
 const [mobileDockEditing,setMobileDockEditing]=useState(false);
 const [sidebarOrder,setSidebarOrder]=useState<string[]>([]);
 const sidebarDrag=useRef('');
 useEffect(()=>{try{setSidebarOrder(JSON.parse(window.localStorage.getItem('gos-sims-sidebar:'+gameId)||'[]'))}catch{setSidebarOrder([])}},[gameId]);
 const [crisisExpanded,setCrisisExpanded]=useState(false);
 const [chatDrafts,setChatDrafts]=useState<Record<string,string>>({});
 const mobileDialogRef=useDialog(mobileMenuOpen,()=>setMobileMenuOpen(false));
 const [pendingEvents,setPendingEvents]=useState(0);
 const sectionUpdates=useSectionUpdates(gameId,g.me?.user_id,view,!!viewAs);
 const sectionBadge=(key:string)=>Math.min(999,Math.max(sectionUpdates?.[key]||0,key==='events'?pendingEvents:0));
 const [selectedProfileId,setSelectedProfileId]=useSavedGameState(gameId,g.me?.user_id,'profile-selected','',savedString);
 const [completingProfile,setCompletingProfile]=useState(false);
 const [onboardingNotice,setOnboardingNotice]=useState('');
 const [setupStatus,setSetupStatus]=useState<ProfileSetupStatus|null>(null);
 const [setupChecking,setSetupChecking]=useState(false);
 const [setupPromptBusy,setSetupPromptBusy]=useState(false);
 const [setupWelcomeActive,setSetupWelcomeActive]=useState(false);
 const setupPromptScope=useRef('');
 const [setupFocusVersion,setSetupFocusVersion]=useState(0);
 const [tourMode,setTourMode]=useState<'idle'|'choice'|'tour'>('idle');
 const [tourIndex,setTourIndex]=useState(0);
 const [stageComicOpen,setStageComicOpen]=useState(false);
 const tourOfferedScope=useRef('');
 const setupRequest=useRef(0);
 useEffect(()=>{
  if(!viewAsOpen)return;
  function onPointerDown(event:PointerEvent){
   if(!viewAsRef.current?.contains(event.target as Node))setViewAsOpen(false);
  }
  function onEscape(event:KeyboardEvent){
   if(event.key!=='Escape')return;
   event.preventDefault();
   setViewAsOpen(false);
   viewAsRef.current?.querySelector<HTMLButtonElement>('.viewAsTrigger')?.focus();
  }
  document.addEventListener('pointerdown',onPointerDown);
  document.addEventListener('keydown',onEscape);
  const frame=requestAnimationFrame(()=>viewAsRef.current?.querySelector<HTMLButtonElement>('.viewAsMenu [aria-checked="true"]')?.focus());
  return()=>{
   cancelAnimationFrame(frame);
   document.removeEventListener('pointerdown',onPointerDown);
   document.removeEventListener('keydown',onEscape);
  };
 },[viewAsOpen]);
 function selectViewAs(next:string){
  setViewAs(next);
  setViewAsOpen(false);
  requestAnimationFrame(()=>viewAsRef.current?.querySelector<HTMLButtonElement>('.viewAsTrigger')?.focus());
 }
 function onPreviewMenuKeyDown(event:React.KeyboardEvent<HTMLDivElement>){
  if(event.key!=='ArrowDown'&&event.key!=='ArrowUp'&&event.key!=='Home'&&event.key!=='End')return;
  const options=Array.from(viewAsRef.current?.querySelectorAll<HTMLButtonElement>('.viewAsMenu [role="menuitemradio"]')||[]);
  if(!options.length)return;
  event.preventDefault();
  const current=options.indexOf(document.activeElement as HTMLButtonElement);
  const index=event.key==='Home'?0:event.key==='End'?options.length-1:
   event.key==='ArrowDown'?(current+1)%options.length:(current+options.length-1)%options.length;
  options[index]?.focus();
 }
 function finishScreenNavigation(){
  setMobileMenuOpen(false);
  if(window.matchMedia('(max-width:1099px)').matches)g.setChatOpen(false);
  requestAnimationFrame(()=>document.getElementById('game-main')?.focus());
 }
 function navigate(next:View,target?:{stageNo?:number;documentId?:string;voteId?:string;templateKey?:string},profileVerified=false,fromTourClick=false){
  const owner=g.me;
  const p=g.profiles.find(row=>row.user_id===owner?.user_id);
  if(!profileVerified&&owner&&owner.kind!=='observer'&&navigationHydrated&&g.profilesLoaded&&!p?.onboarding_completed_at&&!introOpen&&next!=='profile'&&tourMode!=='tour'){
   setOnboardingNotice('Сначала завершите оформление личного профиля.');
   next='profile';
  }
  if(fromTourClick&&tourMode==='tour'){
   const steps=getTourSteps(!!g.teacher);
   if(steps[tourIndex]?.target===next){
    if(tourIndex===steps.length-1){rememberTourChoice('completed');setTourMode('idle')}
    else setTourIndex(value=>value+1);
   }
  }
  const destination:ScreenLocation={view:next,stageNo:target?.stageNo??0,documentId:target?.documentId??'',voteId:target?.voteId??'',templateKey:target?.templateKey??''};
  setScreenHistory(previous=>{
   const current=previous.entries[previous.index];
   if(current.view===destination.view&&current.stageNo===destination.stageNo&&current.documentId===destination.documentId&&current.voteId===destination.voteId&&current.templateKey===destination.templateKey)return previous;
   const entries=[...previous.entries.slice(0,previous.index+1),destination].slice(-60);
   return {entries,index:entries.length-1};
  });
  finishScreenNavigation();
 }
 function navigateProfile(id:string){setSelectedProfileId(id);navigate('profile')}
 function rememberDocument(id?:string){
  setScreenHistory(previous=>({entries:previous.entries.map((screen,index)=>index===previous.index&&screen.view==='documents'?{...screen,documentId:id||'',templateKey:''}:screen),index:previous.index}));
 }
 function clearVoteFocus(){
  setScreenHistory(previous=>({entries:previous.entries.map((screen,index)=>index===previous.index&&screen.view==='votes'?{...screen,voteId:''}:screen),index:previous.index}));
 }
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
 const observer=me?.kind==='observer';
 const myProfile=g.profiles.find(p=>p.user_id===me?.user_id);
 const {open:introOpen,seen:introSeen,finish:closeIntro,syncError:introSyncError}=useIntroProgress({
  gameId:game?.id||'',userId:me?.user_id||'',ready:!loading&&g.profilesLoaded&&game?.id===gameId,
  observer:!!observer,serverSeen:!!(g.introAccountSeen||myProfile?.intro_seen_at||myProfile?.onboarding_completed_at),
  persist:async()=>{
   if(!game)throw new Error('Игра ещё загружается');
   const r=await supabase.rpc('mark_my_intro_seen',{p_game:game.id});
   if(r.error)throw r.error;
   await g.refresh();
  }
 });
 const onboardingRequired=!!me&&!observer&&!myProfile?.onboarding_completed_at;
 function rememberTourChoice(choice:'accepted'|'skipped'|'completed'){
  if(!game||!me)return;
  try{window.localStorage.setItem('gos-id:tour-choice:v1:'+game.id+':'+me.user_id,choice)}catch{/* The tutorial is optional. */}
 }
 function beginTour(){
  rememberTourChoice('accepted');
  setTourIndex(0);setTourMode('tour');setMobileMenuOpen(false);setSelectedProfileId('');
  setChatOpen(false);navigate('dashboard',undefined,true);
 }
 function skipTour(){
  rememberTourChoice('skipped');setTourMode('idle');setMobileMenuOpen(false);setChatOpen(false);
  if(onboardingRequired)navigate('profile',undefined,true);
 }
 function toggleTourChat(){
  const opening=!chatOpen;
  setChatOpen(opening);
  if(tourMode==='tour'&&opening&&getTourSteps(!!teacher)[tourIndex]?.target==='chat')setTourIndex(x=>x+1);
 }
 useEffect(()=>{
  if(!game||!me||observer||previewMode||g.loading||!g.profilesLoaded||!navigationHydrated||introOpen||!introSeen||!onboardingRequired)return;
  const scope=game.id+':'+me.user_id;
  if(tourOfferedScope.current===scope)return;
  let seen=false;
  try{seen=!!window.localStorage.getItem('gos-id:tour-choice:v1:'+scope)}catch{}
  if(seen)return;
  tourOfferedScope.current=scope;
  setTourMode('choice');
  navigate('dashboard',undefined,true);
 },[game?.id,me?.user_id,observer,previewMode,g.loading,g.profilesLoaded,navigationHydrated,introOpen,introSeen,onboardingRequired]);

 async function loadProfileSetup(){
  if(!game||!me||observer)return;
  const token=++setupRequest.current;
  setSetupChecking(true);
  const r=await supabase.rpc('get_my_game_profile_setup',{p_game:game.id});
  if(token!==setupRequest.current)return;
  if(r.error||!validProfileSetupStatus(r.data)){
   setOnboardingNotice('Не удалось проверить полноту профиля. Повторите проверку в профиле.');
  }else setSetupStatus(r.data);
  setSetupChecking(false);
 }
 useEffect(()=>{
  if(!game||!me||observer||g.loading||!g.profilesLoaded||!navigationHydrated||!introSeen||previewMode){
   setupRequest.current++;setSetupStatus(null);return;
  }
  void loadProfileSetup();
  return()=>{setupRequest.current++};
 },[game?.id,me?.user_id,g.profilesLoaded,navigationHydrated,introSeen,observer,previewMode,myProfile?.onboarding_completed_at]);
 useEffect(()=>{
  setupWelcomeActive&&setSetupWelcomeActive(false);
  setupPromptScope.current='';
 },[game?.id,me?.user_id]);
 useEffect(()=>{
  if(!game||!me||!introSeen||introOpen||previewMode||tourMode!=='idle'||!onboardingRequired||!setupStatus||setupChecking||setupStatus.completed||setupStatus.prompt_seen)return;
  const scope=game.id+':'+me.user_id;
  if(setupPromptScope.current===scope)return;
  setupPromptScope.current=scope;
  setSetupWelcomeActive(true);
  // Record the FIRST display, not every login or each click. The dialog stays
  // open until the person explicitly proceeds to the missing profile fields.
  void supabase.rpc('mark_my_game_profile_setup_prompt_seen',{p_game:game.id}).then(r=>{
   if(r.error){setOnboardingNotice('Не удалось сохранить первое знакомство: '+r.error.message);setupPromptScope.current='';return}
   setSetupStatus(prev=>prev?{...prev,prompt_seen:true}:prev);
  });
 },[game?.id,me?.user_id,introSeen,introOpen,previewMode,tourMode,onboardingRequired,setupStatus?.completed,setupStatus?.prompt_seen,setupChecking]);
 const showSetupWelcome=!!onboardingRequired&&setupWelcomeActive&&!!setupStatus&&!setupStatus.completed&&introSeen&&!introOpen&&!previewMode&&tourMode==='idle';
 const setupDialogRef=useDialog(showSetupWelcome,()=>{});
 const tourChoiceDialogRef=useDialog(tourMode==='choice'&&!introOpen,()=>{});
 async function goToIncompleteProfile(){
  if(!game||!me||setupPromptBusy)return;
  setSetupPromptBusy(true);
  if(!setupStatus?.prompt_seen){
   const r=await supabase.rpc('mark_my_game_profile_setup_prompt_seen',{p_game:game.id});
   if(r.error){
    setOnboardingNotice('Не удалось сохранить первое знакомство: '+r.error.message);
    setSetupPromptBusy(false);return;
   }
   setSetupStatus(prev=>prev?{...prev,prompt_seen:true}:prev);
  }
  setSetupWelcomeActive(false);
  setSelectedProfileId('');
  navigate('profile');
  setSetupFocusVersion(x=>x+1);
  setSetupPromptBusy(false);
 }

 useEffect(()=>{
  if(!game||!me||previewMode)return;
  let live=true;
  async function count(){
   const [r,i]=await Promise.all([supabase.from('event_assignments').select('id',{count:'exact',head:true}).eq('game_id',game!.id).eq('recipient_id',me!.user_id).eq('status','pending'),supabase.from('event_collaboration_invites').select('id',{count:'exact',head:true}).eq('game_id',game!.id).eq('recipient_id',me!.user_id).eq('status','pending')]);
   if(live&&!r.error&&!i.error)setPendingEvents((r.count||0)+(i.count||0));
  }
  void count();const poll=setInterval(()=>void count(),30000);
  const channel=supabase.channel('event-count:'+game.id+':'+me.user_id)
   .on('postgres_changes',{event:'*',schema:'public',table:'event_assignments',filter:'game_id=eq.'+game.id},()=>void count()).subscribe();
  return()=>{live=false;clearInterval(poll);void supabase.removeChannel(channel)};
 },[game?.id,me?.user_id,previewMode,view]);


 const backIndex=onboardingRequired?-1:adjacentScreen(screenHistory.entries,screenHistory.index,-1,previewMode);
 const forwardIndex=onboardingRequired?-1:adjacentScreen(screenHistory.entries,screenHistory.index,1,previewMode);
 function moveHistory(index:number){
  if(index<0||onboardingRequired)return;
  setScreenHistory(previous=>({...previous,index}));
  finishScreenNavigation();
 }
 const vg=previewStudent?buildStudentPreview(g,previewStudent):observer&&me?{...buildStudentPreview(g,me),logout:g.logout} as ReturnTypeRepublic:g;
 const shownMe=vg.me||me;
 const chatDraftKey=(shownMe?.user_id||'')+':'+g.channelId;
 useEffect(()=>{
  // Never interpret a temporarily missing profile row during initial loading
  // as an incomplete onboarding. Doing so overwrites the restored screen on F5.
  if(!game||!me||g.loading||!g.profilesLoaded||!navigationHydrated||navigationRestored||me.kind==='observer'||introOpen||!introSeen||tourMode!=='idle'||myProfile?.onboarding_completed_at)return;
  if(view!=='profile')navigate('profile');
 },[game?.id,me?.user_id,g.loading,g.profilesLoaded,navigationHydrated,navigationRestored,introSeen,myProfile?.onboarding_completed_at,introOpen,tourMode,view]);
 async function completeOnboarding(){
  if(!game||!me||completingProfile)return;
  setCompletingProfile(true);setOnboardingNotice('');
  const r=await supabase.rpc('complete_my_game_profile',{p_game:game.id});
  if(r.error){setOnboardingNotice('Проверьте обязательные поля: '+r.error.message);await loadProfileSetup();setSetupFocusVersion(x=>x+1)}
  else{setOnboardingNotice('Профиль заполнен. Добро пожаловать в игру!');setSetupStatus({completed:true,prompt_seen:true,missing:[]});await g.refresh();navigate('dashboard',undefined,true)}
  setCompletingProfile(false);
 }
 function finishIntro(){
  closeIntro();setTourMode('choice');navigate('dashboard',undefined,true);
 }
 

 useEffect(()=>{
  if(!me||previewMode||me.kind==='observer')return;
  const labels:Record<View,string>={dashboard:'Обзор игры',stages:'Этапы',parties:'Партия',votes:'Голосование',documents:'НПА / Формальные институты',actions:'Политический процесс',grades:'Оценки',profile:'Мой профиль',teacher:'Управление',events:'Event · ситуации',budget:'Бюджет'};
  void touchPresence(view,'Открыл раздел «'+labels[view]+'»');
  const id=setInterval(()=>void touchPresence(view),30000);
  return()=>clearInterval(id);
 },[view,me?.user_id,previewMode]);

 useEffect(()=>{
  if(!previewMode)return;
  if(view==='teacher')navigate('dashboard');
  const visible=vg.channels;
  if(visible.length&&!visible.some(c=>c.id===g.channelId))g.setChannelId(visible[0].id);
 },[previewStudent?.user_id]);


 if(loading||!game||!me||!shownMe||!navigationHydrated)return <main className="connectionPage"><section className="connectionCard" aria-live="polite"><span className="wordmark"><BrandName/></span>{!error&&<div className="spinner"/>}<h1>{error?'Не удалось открыть игру':'Подключаемся к республике'}</h1><p>{error||'Загружаем этапы, команды и последние события.'}</p>{error&&<div><button className="primary" onClick={()=>window.location.reload()}>Попробовать снова</button><a className="secondary" href="/">Вернуться ко входу</a></div>}</section></main>;

 const nav:[View,string][]=[['dashboard','Обзор игры'],['stages','Этапы и задачи'],['actions','Политический процесс'],['parties',teacher&&!previewMode?'Партии':'Моя партия'],['votes','Голосования'],['documents','Реестр НПА'],['budget','Бюджет'],['grades','Оценки и разбор'],['events','События и ситуации'],...(teacher&&!previewMode?[['teacher','Управление'] as [View,string]]:[]),['profile','Мой профиль']];

 const navIcon=(key:View)=>{
  const P=key==='events'?CalendarDays:key==='teacher'?Settings2:key==='dashboard'?LayoutDashboard:key==='actions'?Radio:key==='parties'?Landmark:key==='votes'?VoteIcon:key==='documents'?FileText:key==='stages'?BookOpenText:key==='grades'?GraduationCap:key==='budget'?Wallet:UserRound;
  return <P aria-hidden="true" strokeWidth={1.9}/>;
 };
 const mobilePrimary:View[]=teacher&&!previewMode?['teacher','dashboard','stages','votes']:['dashboard','stages','parties','votes'];
 const mobileSecondary=nav.filter(([k])=>!mobilePrimary.includes(k));
 const dockShortLabels:Record<View,string>={dashboard:'Обзор',stages:'Этапы',actions:'Процесс',parties:'Партии',votes:'Голоса',documents:'НПА',grades:'Оценки',events:'События',budget:'Бюджет',teacher:'Пульт',profile:'Профиль'};
 const dockItems=[...mobilePrimary,...mobileSecondary.map(([k])=>k)].map(key=>({key,label:nav.find(([k])=>k===key)![1],shortLabel:dockShortLabels[key],icon:sectionBadge(key)>0?<span className="eventDockIcon">{navIcon(key)}<i className="eventDockBadge">{sectionBadge(key)}</i></span>:navIcon(key)}));

 function sidebarKeys(){return [...sidebarOrder,...nav.map(x=>x[0]).filter(x=>!sidebarOrder.includes(x))].filter(x=>nav.some(n=>n[0]===x))}
 function reorderSidebar(from:string,to:string){
  const order=sidebarKeys(),fromIndex=order.indexOf(from),toIndex=order.indexOf(to);
  if(fromIndex<0||toIndex<0||from===to)return;
  order.splice(fromIndex,1);order.splice(toIndex,0,from);setSidebarOrder(order);
  try{window.localStorage.setItem('gos-sims-sidebar:'+gameId,JSON.stringify(order))}catch{}
 }
 return <div className={'simShell '+(previewMode?'studentPreviewShell':'')+(observer?' observerShell':'')}>
  <a className="skipLink" href="#game-main">Перейти к содержимому</a>
  <aside className="simSidebar">
   <div className="sidebarBrand">
    <BrandIdentity tagline/>
   </div>

   <section className="sidebarStage">
    <div className="sidebarStageNumber">{String(currentStage?.stage_no||game.current_round||1).padStart(2,'0')}</div>
    <div><small>ТЕКУЩИЙ ЭТАП</small><b>{currentStage?.title||game.title}</b></div>
    <span className={game.turn_open?'open':'paused'}>{game.turn_open?'Ход открыт':'Пауза'}</span>
   </section>

   <nav className="focusNav" aria-label="Разделы игры">
    <div className="focusNavInner">
     {[...nav].sort((a,b)=>{const rank=(key:string)=>sidebarOrder.includes(key)?sidebarOrder.indexOf(key):sidebarOrder.length+nav.findIndex(x=>x[0]===key);return rank(a[0])-rank(b[0])}).map(([k,label])=><button key={k} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const from=sidebarDrag.current;if(from)reorderSidebar(from,k);sidebarDrag.current=''}} className={view===k?'active':''} data-tour-view={k} onClick={()=>{if(k==='profile')setSelectedProfileId('');navigate(k,undefined,false,true)}} aria-current={view===k?'page':undefined}>
      <span className="sidebarDragHandle" draggable tabIndex={0} role="button" aria-label={'Переместить раздел «'+label+'». Стрелки вверх и вниз меняют порядок.'} title="Перетащите для изменения порядка" onClick={e=>e.stopPropagation()} onDragStart={e=>{sidebarDrag.current=k;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',k)}} onDragEnd={()=>{sidebarDrag.current=''}} onKeyDown={e=>{if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;e.preventDefault();e.stopPropagation();const order=sidebarKeys(),i=order.indexOf(k),to=i+(e.key==='ArrowUp'?-1:1);if(to>=0&&to<order.length)reorderSidebar(k,order[to])}}><GripVertical size={15} aria-hidden="true"/></span>
      {navIcon(k)}<span className="sidebarRouteLabel">{label}</span>{sectionBadge(k)>0&&<i className="navBadge" aria-label={'Новых: '+sectionBadge(k)}>{sectionBadge(k)}</i>}</button>)}
    </div>
   </nav>

   <div className="sidebarFooter">
    <div className="sidebarRealtime"><Wifi aria-hidden="true"/><span>{connectionDisplay==='polling'?'Периодическое обновление':connectionDisplay==='connected'?'Синхронизация активна':connectionDisplay==='connecting'?'Подключение…':'Нет сети'}</span><i className={connectionDisplay}/></div>
    <div className="sidebarUser">
     <div className="simAvatar">{initials(shownMe.full_name)}</div>
     <div className="simUserText"><b>{shownMe.full_name}</b><span>{previewMode?'Просмотр · '+(shownMe.role_title||'Участник'):shownMe.role_title||(teacher?'Преподаватель':'Участник')}</span></div>
     {previewMode?<button aria-label="Вернуться к преподавателю" className="sidebarIconButton" onClick={()=>setViewAs('')}><ChevronLeft/></button>:<button aria-label="Выйти" className="sidebarIconButton" onClick={logout}><LogOut/></button>}
    </div>
   </div>
  </aside>

  <div className={'simWorkspace '+(chatOpen?'chatOpen':'')}>
   <header className="simTop">
    <div className="mobileBrand"><BrandIdentity tagline/></div>
    <nav className="topScreenHistory" aria-label="История разделов">
     <button type="button" className="screenHistoryButton" onClick={()=>moveHistory(backIndex)} disabled={backIndex<0} aria-label="Вернуться к предыдущему экрану" title="Назад"><ChevronLeft aria-hidden="true"/></button>
     <button type="button" className="screenHistoryButton" onClick={()=>moveHistory(forwardIndex)} disabled={forwardIndex<0} aria-label="Перейти к следующему экрану" title="Вперёд"><ChevronRight aria-hidden="true"/></button>
    </nav>
    <div className="simTopCenter">
     <div className="topStageCopy"><small>ЭТАП {String(currentStage?.stage_no||game.current_round||1).padStart(2,'0')}</small><strong>{nav.find(([key])=>key===view)?.[1]||game.title}</strong></div>
     <div className="topIndicators">
      <span className={`livePill ${game.turn_open?'on':'off'}`} aria-label={game.turn_open?'Ход открыт':'Пауза'} title={game.turn_open?'Ход открыт':'Пауза'}><Radio aria-hidden="true"/><span className="livePillText">{game.turn_open?'Ход открыт':'Пауза'}</span></span>
      <button type="button" className="gameShareScreen" onClick={()=>void shareCurrentScreen()} title="Поделиться текущим разделом или документом" aria-label="Поделиться текущим разделом"><Share2 size={17} aria-hidden="true"/><span>Поделиться</span></button>
      {game.turn_open&&game.turn_ends_at&&<span className="timerPill" aria-label="Время до конца хода">{fmtTimer(secondsLeft)}</span>}
      <span className={`connectionPill ${connectionDisplay}`} role="status" aria-label={connectionDescription} title={connectionDescription}><Wifi aria-hidden="true"/><span className="connectionLabel">{connectionLabel}</span></span>
     </div>
    </div>

    {teacher&&<div className={'viewAsSwitcher '+(previewMode?'active':'')} ref={viewAsRef}>
     <button type="button" className="viewAsTrigger" aria-haspopup="menu" aria-expanded={viewAsOpen} aria-controls={viewAsOpen?'game-view-as-menu':undefined} aria-label={'Режим просмотра: '+(!viewAs?'Преподаватель':viewAs===GENERIC_STUDENT?'Студент':previewStudent?.full_name||'Студент')} onClick={()=>setViewAsOpen(open=>!open)}>
      <Eye className="viewAsMobileIcon" aria-hidden="true"/><span className="viewAsTriggerText">
       <span className="viewAsLabel">РЕЖИМ ПРОСМОТРА</span>
       <strong className="viewAsValue">{!viewAs?'Преподаватель':viewAs===GENERIC_STUDENT?'Студент':previewStudent?.full_name||'Студент'}</strong>
      </span>
      <ChevronDown className="viewAsChevron" aria-hidden="true"/>
     </button>
     {viewAsOpen&&<div className="viewAsMenu" id="game-view-as-menu" role="menu" aria-label="Выбрать режим просмотра" onKeyDown={onPreviewMenuKeyDown}>
      <button type="button" role="menuitemradio" aria-checked={!viewAs} className={!viewAs?'selected':''} onClick={()=>selectViewAs('')}>Преподаватель</button>
      <button type="button" role="menuitemradio" aria-checked={viewAs===GENERIC_STUDENT} className={viewAs===GENERIC_STUDENT?'selected':''} onClick={()=>selectViewAs(GENERIC_STUDENT)}>Студент</button>
      {g.members.some(m=>m.kind==='student')&&<div role="separator" className="viewAsMenuDivider">Конкретный студент</div>}
      {g.members.filter(m=>m.kind==='student').map(m=><button type="button" key={m.user_id} role="menuitemradio" aria-checked={viewAs===m.user_id} className={viewAs===m.user_id?'selected':''} title={m.full_name+(m.role_title?' · '+m.role_title:'')} onClick={()=>selectViewAs(m.user_id)}>{m.full_name}{m.role_title&&<small>{m.role_title}</small>}</button>)}
     </div>}
    </div>}

    <ChatToggleButton chatOpen={chatOpen} onToggle={toggleTourChat} unreadCount={g.chatUnreadCount} mentionCount={g.chatMentionCount}/>
   </header>

   {previewMode&&<div className="studentPreviewBanner">
    <div><Eye aria-hidden="true"/><p><b>Режим студента:</b> {shownMe.full_name}{shownMe.team?' · '+shownMe.team:''}{shownMe.role_title?' · '+shownMe.role_title:''}. <strong>Действия от его имени заблокированы.</strong></p></div>
    <button onClick={()=>setViewAs('')}>Вернуться к преподавателю</button>
   </div>}

   <div className="simContentFlow">
    {!previewMode&&g.crises.some(c=>c.status==='active')&&<section className="crisisNotice"><div><b>В республике активен кризис</b><span>{g.crises.find(c=>c.status==='active')?.crisis_type}</span></div><button className="secondary" aria-expanded={crisisExpanded} onClick={()=>setCrisisExpanded(!crisisExpanded)}>{crisisExpanded?'Свернуть штаб':'Открыть кризисный штаб'}</button>{crisisExpanded&&<div className="crisisNoticeBody"><CrisisRoom g={g}/></div>}</section>}

    <main id="game-main" tabIndex={-1} className={`simMain ${chatOpen?'chatOpen':''} ${previewMode?'studentPreviewMain':''}`}>
     {error&&<div className="errorBox closable" role="alert"><span>{error}</span><IconAction onClick={()=>setError('')} label="Закрыть сообщение об ошибке"/></div>}
     {view==='dashboard'&&<DashboardView g={vg} onOpenProfile={navigateProfile} onNavigate={v=>navigate(v,v==='stages'?{stageNo:currentStage?.stage_no||game.current_round}:undefined)}/>}
     {view==='stages'&&<StagesView g={vg} readOnly={previewMode||observer} focusStageNo={focusStage} onOpenVotes={voteId=>navigate('votes',voteId?{voteId}:undefined)} onOpenDocument={id=>navigate('documents',{documentId:id})} onCreateDocument={(templateKey,stageNo)=>navigate('documents',{templateKey,stageNo})} onNavigate={v=>navigate(v)}/>}
     {view==='parties'&&<PartiesView g={vg}/>}
     {view==='votes'&&<VotesView g={vg} focusId={currentScreen.voteId} onClearFocus={clearVoteFocus} onOpenDocument={id=>navigate('documents',{documentId:id})} onOpenStages={()=>navigate('stages')}/>}
     {view==='budget'&&<BudgetView g={vg} readOnly={previewMode||observer} onOpenDocument={id=>navigate('documents',{documentId:id})} onOpenEvents={()=>navigate('events')} onOpenVotes={voteId=>navigate('votes',{voteId})} onOpenStage={stageNo=>navigate('stages',{stageNo})}/>}
     {view==='documents'&&<DocumentsView g={vg} readOnly={previewMode||observer} focusId={focusFormalId} createTemplate={currentScreen.templateKey} createStageNo={focusStage} onSelectDocument={rememberDocument} onOpenBudget={()=>navigate('budget')} onOpenVotes={voteId=>navigate('votes',{voteId})}/>}
     {view==='grades'&&<GradesView g={vg} onOpenProfile={navigateProfile}/>}
     {view==='actions'&&<PoliticalWallView g={vg} readOnly={previewMode||observer} focusPending={true} onOpenVotes={()=>navigate('votes')} onOpenDocument={id=>navigate('documents',{documentId:id})} onNavigate={navigate}/>}
     {view==='profile'&&<ProfileView g={vg} targetUserId={selectedProfileId} readOnly={previewMode||observer} onStartTutorial={beginTour} previewAchievementsUserId={teacher&&viewAs===GENERIC_STUDENT?me?.user_id:undefined} onOpenProfile={navigateProfile} onOwnProfile={()=>{setSelectedProfileId('');navigate('profile')}} setupStatus={setupStatus} setupNotice={onboardingNotice} setupFocusVersion={setupFocusVersion} onProfileChanged={()=>void loadProfileSetup()} onFinishSetup={()=>void completeOnboarding()}/>}
     {view==='events'&&<EventWorkspace g={vg} readOnly={previewMode||observer}/>}
     {view==='teacher'&&teacher&&!previewMode&&<TeacherView g={g} onStartTutorial={beginTour} onNavigate={destination=>navigate(destination)} onOpenProcesses={()=>navigate('actions')} onOpenStages={stageNo=>navigate('stages',{stageNo})}
       onOpenChat={channelId=>{g.setChannelId(channelId);g.setChatOpen(true)}}/>}
    </main>
   </div>

   {chatOpen&&<ChatPanel g={vg} readOnly={observer} draft={chatDrafts[chatDraftKey]||''} onDraftChange={text=>setChatDrafts(current=>({...current,[chatDraftKey]:text}))} onOpenMember={uid=>{g.setChatOpen(false);navigateProfile(uid)}}/>}
  </div>

  {mobileMenuOpen&&<div className="mobileMoreBackdrop" onClick={()=>setMobileMenuOpen(false)}>
   <section ref={mobileDialogRef} tabIndex={-1} className="mobileMoreSheet" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()} aria-label="Все разделы">
    <header><div><small>НАВИГАЦИЯ</small><b>Все разделы игры</b></div><IconAction onClick={()=>setMobileMenuOpen(false)} label="Закрыть меню"/></header>
    <div className="mobileAllGrid">{nav.map(([k,label])=><button key={k} type="button" aria-current={view===k?'page':undefined} className={view===k?'active':''} data-tour-view={k} onClick={()=>navigate(k,undefined,false,true)}>{navIcon(k)}<span>{label}</span></button>)}<button type="button" className={chatOpen?'active':''} aria-haspopup="dialog" onClick={()=>{setMobileMenuOpen(false);setChatOpen(true)}}><span className="mobileMenuChatIcon"><MessageCircle aria-hidden="true"/>{g.chatUnreadCount>0&&<i className={g.chatMentionCount>0?'hasMention':''}>{g.chatUnreadCount>99?'99+':g.chatUnreadCount}</i>}</span><span>Чат</span></button></div>
    <footer className="mobileAccount"><div><b>{shownMe.full_name}</b><span>{shownMe.role_title||(teacher?'Преподаватель':'Участник')}</span></div>{previewMode?<button className="secondary" onClick={()=>{setViewAs('');setMobileMenuOpen(false)}}>К преподавателю</button>:<button className="secondary" onClick={logout}><LogOut aria-hidden="true"/>Выйти</button>}</footer>
   </section>
  </div>}
  {tourMode==='choice'&&!introOpen&&!previewMode&&<div className="tourChoiceBackdrop">
    <section ref={tourChoiceDialogRef} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="tour-choice-title" className="tourChoice">
     <small>ГОС.ID · НАЧАЛО РАБОТЫ</small>
     <h2 id="tour-choice-title">Познакомимся с Республикой?</h2>
     <p>Пролог закончился. Предлагаем пройти интерактивное обучение: интерфейс затемнится, а подсказки по очереди покажут основные разделы. Нажимайте на выделенные кнопки, чтобы открыть их и перейти к следующему шагу.</p>
     <p>После экскурсии вы завершите оформление профиля. Если пропустите экскурсию, профиль всё равно потребуется заполнить. Обучение можно повторить в любой момент через личный профиль.</p>
     <div className="tourChoiceActions"><button type="button" className="tourStart" onClick={beginTour}>Пройти обучение</button><button type="button" className="tourLater" onClick={skipTour}>Пропустить</button></div>
     <span className="tourChoiceNote">Экскурсия не меняет игровые данные, оценки и решения.</span>
    </section>
   </div>}
  {tourMode==='tour'&&!introOpen&&!previewMode&&<GuidedTour step={getTourSteps(!!teacher)[tourIndex]} index={tourIndex} total={getTourSteps(!!teacher).length} onSkip={skipTour} onFallback={(target:TourTarget)=>target==='chat'?toggleTourChat():navigate(target,undefined,true,true)}/>}
  {showSetupWelcome&&setupStatus&&<div className="profileSetupBackdrop">
    <section ref={setupDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="profile-setup-title" aria-describedby="profile-setup-description" className="profileSetupWelcome">
     <div className="profileSetupWelcomeIcon"><UserRound size={26} aria-hidden="true"/></div>
     <small className="profileSetupEyebrow">ГОС.ID · ПЕРВОЕ ЗНАКОМСТВО</small>
     <h2 id="profile-setup-title">Первое знакомство с Республикой</h2>
     <p id="profile-setup-description">Подготовьте личный профиль участника: заполните обязательные сведения, подтвердите почту и установите пароль.</p>
     <div className="profileSetupProgress"><span>Заполнено {PROFILE_SETUP_FIELDS.length-setupStatus.missing.length} из {PROFILE_SETUP_FIELDS.length}</span><div className="profileSetupProgressTrack"><i style={{width:String((PROFILE_SETUP_FIELDS.length-setupStatus.missing.length)/PROFILE_SETUP_FIELDS.length*100)+'%'}}/></div></div>
     <div className="profileSetupChecklist">{PROFILE_SETUP_FIELDS.map(field=><span key={field} className={!setupStatus.missing.includes(field)?'isDone':''}><span aria-hidden="true">{setupStatus.missing.includes(field)?'○':'✓'}</span>{PROFILE_SETUP_LABELS[field]}</span>)}</div>
     {(onboardingNotice||introSyncError)&&<p role="alert" className="profileSetupModalError">{onboardingNotice||introSyncError}</p>}
     <button type="button" className="primary profileSetupStart" disabled={setupPromptBusy} onClick={()=>void goToIncompleteProfile()}>{setupPromptBusy?'Открываем профиль…':'Перейти к заполнению'}</button>
    </section>
   </div>} <BlitzOverlay gameId={gameId} enabled={me?.kind==='student'&&!previewMode&&!introOpen&&!onboardingRequired&&tourMode==='idle'&&!stageComicOpen}/>
  <AchievementCelebration gameId={gameId} userId={me?.user_id} enabled={me?.kind==='student'&&!previewMode&&!introOpen&&!stageComicOpen}/>
  <StageComics key={gameId+':'+me?.user_id} gameId={gameId} userId={me?.user_id||''} stages={g.stages} enabled={!g.loading&&!previewMode&&!introOpen&&!onboardingRequired&&tourMode==='idle'} onOpenChange={setStageComicOpen}/>
  <RepublicComic gameId={gameId} intro open={introOpen} onClose={()=>void finishIntro()}/>
  <MobileDock items={dockItems} activeView={view} storageKey={'gos-sims-dock:'+shownMe.user_id+(teacher&&!previewMode?':teacher':':student')} editing={mobileDockEditing} setEditing={setMobileDockEditing} onNavigate={k=>{if(k==='profile')setSelectedProfileId('');navigate(k,undefined,false,true)}} onChat={()=>{setMobileMenuOpen(false);toggleTourChat()}} chatOpen={chatOpen} chatUnreadCount={g.chatUnreadCount} chatMentionCount={g.chatMentionCount} allOpen={mobileMenuOpen} onAll={()=>{setChatOpen(false);setMobileMenuOpen(true)}}/></div>;
}
