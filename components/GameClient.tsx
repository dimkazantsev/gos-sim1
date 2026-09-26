'use client';
import {useState} from 'react';
import {useRepublicGame} from './game/useRepublicGame';
import type {View} from './game/types';
import {gameStatus,initials} from './game/constants';
import DashboardView from './game/DashboardView';
import StagesView from './game/StagesView';
import PartiesView from './game/PartiesView';
import VotesView from './game/VotesView';
import DocumentsView from './game/DocumentsView';
import ActionsView from './game/ActionsView';
import TeacherView from './game/TeacherView';
import ChatPanel from './game/ChatPanel';

function fmtTimer(seconds:number){
 const m=Math.floor(seconds/60),s=seconds%60;
 return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

export default function GameClient({gameId}:{gameId:string}){
 const g=useRepublicGame(gameId);
 const [view,setView]=useState<View>('dashboard');
 const {game,me,currentStage,teacher,chatOpen,setChatOpen,loading,error,setError,secondsLeft,logout,averageVsn}=g;

 if(loading||!game||!me)return <main className="loginPage"><div className="loaderCard"><div className="spinner"/><div><b>GOS//SIM</b><p className="muted">{error||'Подключение к «Республике Политология»…'}</p></div></div></main>;

 const nav:[View,string,string][]=[
  ['dashboard','◎','Ситуационный центр'],
  ['stages','◫','16 этапов'],
  ['parties','◈','Партии'],
  ['votes','✓','Голосования'],
  ['documents','▤','Документы'],
  ['actions','▣','Решения']
 ];

 return <div className="simShell">
  <header className="simTop">
   <div className="simBrand"><div className="simLogo">GS</div><div><b>GOS//SIM</b><span>Республика Политология</span></div></div>
   <div className="simTopCenter"><strong>{game.title}</strong><div className="topIndicators"><span className={`livePill ${game.turn_open?'on':'off'}`}>● {game.turn_open?'ХОД ОТКРЫТ':'ПАУЗА'}</span><span className="stagePill">Этап {currentStage?.stage_no||game.current_round}/16</span>{game.turn_open&&game.turn_ends_at&&<span className="timerPill">{fmtTimer(secondsLeft)}</span>}</div></div>
   <div className="simUser"><div className="simAvatar">{initials(me.full_name)}</div><div><b>{me.full_name}</b><span>{me.role_title||(teacher?'Руководитель симуляции':'Участник')}</span></div><button onClick={logout}>Выйти</button></div>
  </header>

  <aside className="simNav">
   <nav>{nav.map(([k,ic,label])=><button key={k} className={view===k?'active':''} onClick={()=>setView(k)}><i>{ic}</i><span>{label}</span></button>)}{teacher&&<button className={view==='teacher'?'active':''} onClick={()=>setView('teacher')}><i>✦</i><span>Режиссёрская</span></button>}</nav>
   <div className="stageMini"><small>ТЕКУЩИЙ ЭТАП</small><b>{currentStage?.stage_no}. {currentStage?.title}</b><span>{currentStage?.mode}</span><div className="progressLine"><i style={{width:`${((currentStage?.stage_no||1)/16)*100}%`}}/></div></div>
   <div className="roleMini"><small>МОЯ РОЛЬ</small><b>{me.role_title||me.kind}</b><span>{me.team||me.group_name||'Без фракции'}</span><em>ВСН: {averageVsn?averageVsn.toFixed(1):'—'} · {gameStatus(game.status)}</em></div>
  </aside>

  <main className={`simMain ${chatOpen?'chatOpen':''}`}>
   {error&&<div className="errorBox closable" onClick={()=>setError('')}>{error}</div>}
   {view==='dashboard'&&<DashboardView g={g} onNavigate={()=>setView('actions')}/>}
   {view==='stages'&&<StagesView g={g}/>}
   {view==='parties'&&<PartiesView g={g}/>}
   {view==='votes'&&<VotesView g={g}/>}
   {view==='documents'&&<DocumentsView g={g}/>}
   {view==='actions'&&<ActionsView g={g}/>}
   {view==='teacher'&&teacher&&<TeacherView g={g}/>}
   {!chatOpen&&<button className="floatingChat" onClick={()=>setChatOpen(true)}>⌁ <span>Связь</span></button>}
  </main>

  {chatOpen&&<ChatPanel g={g}/>}
 </div>
}
