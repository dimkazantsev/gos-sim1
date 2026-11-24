'use client';
import {useEffect,useRef} from 'react';
import {firstPresenceWriteDelay} from './firstPresenceWriteDelay';
import {schedulePresenceHeartbeat} from './presenceHeartbeat';

const labels={dashboard:'Обзор игры',stages:'Этапы',parties:'Партия',votes:'Голосование',documents:'НПА / Формальные институты',actions:'Политический процесс',grades:'Оценки',profile:'Мой профиль',teacher:'Управление',events:'Ситуационные решения',budget:'Бюджет'} as const;
type PresenceView=keyof typeof labels;
type PresenceWriter=(view:string,label?:string)=>Promise<void>;

/** One independent, visibility-aware SQL presence lifecycle per game/account. */
export function usePresenceHeartbeat({gameId,userId,view,enabled,touchPresence}:{gameId:string;userId?:string;view:PresenceView;enabled:boolean;touchPresence:PresenceWriter}){
 const admission=useRef({scope:'',readyAt:0});
 const writer=useRef(touchPresence);writer.current=touchPresence;
 useEffect(()=>{
  if(!userId||!enabled)return;
  const scope=gameId+':'+userId;
  if(admission.current.scope!==scope)admission.current={scope,readyAt:Date.now()+firstPresenceWriteDelay(userId)};
  const heartbeatMs=68000+firstPresenceWriteDelay(userId)%6000;
  const lifecycle=schedulePresenceHeartbeat({
   readyAt:admission.current.readyAt,heartbeatMs,
   write:navigation=>{void writer.current(view,navigation?'Открыл раздел «'+labels[view]+'»':undefined)},
   isVisible:()=>document.visibilityState==='visible',now:Date.now,
   schedule:(fn,delay)=>setTimeout(fn,delay),cancel:timer=>clearTimeout(timer)
  });
  document.addEventListener('visibilitychange',lifecycle.visibilityChanged);
  return()=>{document.removeEventListener('visibilitychange',lifecycle.visibilityChanged);lifecycle.dispose()};
 },[gameId,userId,view,enabled]);
}
