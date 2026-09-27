'use client';
import {useEffect,useState} from 'react';
import {useRepublicGame} from './game/useRepublicGame';
import type {View} from './game/types';
import {initials} from './game/constants';
import PoliticalWallView from './game/PoliticalWallView';
import StateMetricsDock from './game/StateMetricsDock';
import StagesView from './game/StagesView';
import PartiesView from './game/PartiesView';
import VotesView from './game/VotesView';
import DocumentsView from './game/DocumentsView';
import TeacherView from './game/TeacherView';
import ProfileView from './game/ProfileView';
import ChatPanel from './game/ChatPanel';

function fmtTimer(seconds:number){
 const m=Math.floor(seconds/60),s=seconds%60;
 return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

export default function GameClient({gameId}:{gameId:string}){
 const g=useRepublicGame(gameId);
 const [view,setView]=useState<View>('dashboard');
 const [focusFormalId,setFocusFormalId]=useState('');
 const {game,me,currentStage,teacher,chatOpen,setChatOpen,loading,error,setError,secondsLeft,logout,touchPresence,logActivity}=g;

 useEffect(()=>{
  if(!me)return;
  if(teacher&&view==='dashboard')setView('teacher');
 },[teacher,me?.user_id]);

 useEffect(()=>{
  if(!me)return;
  const labels:Record<View,string>={dashboard:'Политические процессы',stages:'Этапы',parties:'Партия',votes:'Голосование',documents:'НПА / Формальные институты',actions:'Архив решений',profile:'Мой профиль',teacher:'Управление'};
  void touchPresence(view,'Открыл раздел «'+labels[view]+'»');
  const id=setInterval(()=>void touchPresence(view),30000);
  return()=>clearInterval(id);
 },[view,me?.user_id]);

 if(loading||!game||!me)return <main className="loginPage"><div className="loaderCard"><div className="spinner"/><div><b>GOS//SIM</b><p className="muted">{error||'Подключение к игре…'}</p></div></div></main>;

 const nav:[View,string,string][] = teacher
  ? [['teacher','✦','Управление'],['dashboard','◎','Политические процессы'],['parties','◈','Партии'],['votes','✓','Голосования'],['documents','▤','НПА'],['stages','◫','Этапы'],['profile','●','Профиль']]
  : [['dashboard','◎','Политические процессы'],['parties','◈','Партия'],['votes','✓','Голосование'],['documents','▤','НПА'],['stages','◫','Этапы'],['profile','●','Мой профиль']];


 return <div className="simShell">
  <header className="simTop">
   <div className="simBrand"><div className="simLogo">GS</div><div><b>GOS//SIM</b><span>Республика Политология</span></div></div>
   <div className="simTopCenter">
    <strong>{currentStage?.stage_no||game.current_round}. {currentStage?.title||game.title}</strong>
    <div className="topIndicators">
     <span className={`livePill ${game.turn_open?'on':'off'}`}>● {game.turn_open?'ХОД ОТКРЫТ':'ПАУЗА'}</span>
     {game.turn_open&&game.turn_ends_at&&<span className="timerPill">{fmtTimer(secondsLeft)}</span>}
     <span className={`connectionPill ${g.realtimeState}`}>{g.realtimeState==='connected'?'● ONLINE':g.realtimeState==='connecting'?'○ SYNC':'! OFFLINE'}</span>
    </div>
   </div>
   <div className="simUser">
    <div className="simAvatar">{initials(me.full_name)}</div>
    <div className="simUserText"><b>{me.full_name}</b><span>{me.role_title||(teacher?'Преподаватель':'Участник')}</span></div>
    <button className="logoutButton" onClick={logout}>Выйти</button>
   </div>
  </header>

  <nav className="focusNav" aria-label="Разделы игры">
   <div className="focusNavInner">
    {nav.map(([k,ic,label])=><button key={k} className={view===k?'active':''} onClick={()=>setView(k)} aria-current={view===k?'page':undefined}><i>{ic}</i><span>{label}</span></button>)}
   </div>
  </nav>

  <StateMetricsDock g={g}/>

  <main className={`simMain ${chatOpen?'chatOpen':''}`}>
   {error&&<div className="errorBox closable" onClick={()=>setError('')}>{error}</div>}
   {view==='dashboard'&&<PoliticalWallView g={g} onOpenVotes={()=>setView('votes')} onOpenDocument={id=>{setFocusFormalId(id);setView('documents')}} onNavigate={v=>setView(v)}/>} 
   {view==='stages'&&<StagesView g={g} onOpenVotes={()=>setView('votes')}/>} 
   {view==='parties'&&<PartiesView g={g}/>}
   {view==='votes'&&<VotesView g={g} onOpenDocument={id=>{setFocusFormalId(id);setView('documents')}} onOpenStages={()=>setView('stages')}/>} 
   {view==='documents'&&<DocumentsView g={g} focusId={focusFormalId} onOpenVotes={()=>setView('votes')}/>} 
   {view==='actions'&&<PoliticalWallView g={g} onOpenVotes={()=>setView('votes')} onOpenDocument={id=>{setFocusFormalId(id);setView('documents')}} onNavigate={v=>setView(v)}/>} 
   {view==='profile'&&<ProfileView g={g}/>} 
   {view==='teacher'&&teacher&&<TeacherView g={g}/>}  
   {!chatOpen&&<button className="floatingChat" onClick={()=>{setChatOpen(true);void logActivity('navigation','Открыл связь','chat')}}>⌁ <span>Связь</span></button>}
  </main>

  {chatOpen&&<ChatPanel g={g}/>}
 </div>;
}
