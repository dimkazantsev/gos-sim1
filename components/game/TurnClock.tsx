'use client';
import {useEffect,useState} from 'react';
import {turnCountdown} from './turnCountdown';

function useTurnSeconds(endAt:string){
 const [seconds,setSeconds]=useState(0);
 useEffect(()=>{
  const tick=()=>setSeconds(Math.max(0,Math.floor((new Date(endAt).getTime()-Date.now())/1000)));
  tick();const id=setInterval(tick,1000);return()=>clearInterval(id);
 },[endAt]);
 return seconds;
}

export function TurnCountdownPill({endAt}:{endAt:string}){
 const remaining=turnCountdown(useTurnSeconds(endAt));
 return <span className="timerPill timerPillDuration" aria-label={remaining.ariaLabel} title={remaining.ariaLabel}>
  <span className="timerPillUnit" aria-hidden="true"><strong>{remaining.days}</strong><span className="timerPillUnitFull">ДНИ</span><span className="timerPillUnitCompact">д</span></span>
  <span className="timerPillUnit" aria-hidden="true"><strong>{remaining.hours}</strong><span className="timerPillUnitFull">ЧАСЫ</span><span className="timerPillUnitCompact">ч</span></span>
  <span className="timerPillUnit" aria-hidden="true"><strong>{remaining.minutes}</strong><span className="timerPillUnitFull">МИНУТЫ</span><span className="timerPillUnitCompact">м</span></span>
 </span>;
}

export function PublicTurnCountdown({endAt}:{endAt:string}){
 const seconds=useTurnSeconds(endAt),minutes=Math.floor(seconds/60),rest=seconds%60;
 return <>{String(minutes).padStart(2,'0')}:{String(rest).padStart(2,'0')}</>;
}
