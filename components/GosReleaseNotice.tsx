'use client';
import {useEffect,useState} from 'react';

/** GitHub Pages has no server-side navigation: compare only immutable build IDs.
 * Never reload an active classroom game without the participant's consent.
 */
const CURRENT_RELEASE=process.env.NEXT_PUBLIC_GOS_RELEASE||'';
const BASE=(process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'').replace(/\/$/,'');
const INTERVAL_MS=5*60*1000;
const MIN_RECHECK_MS=60*1000;

export default function GosReleaseNotice(){
 const [newVersion,setNewVersion]=useState(false);
 useEffect(()=>{
  if(!/^[0-9a-f]{40}$/i.test(CURRENT_RELEASE)||typeof window==='undefined')return;
  let cancelled=false,lastCheck=0,checking=false;
  const check=async()=>{
   if(cancelled||checking||document.visibilityState==='hidden'||!navigator.onLine||Date.now()-lastCheck<MIN_RECHECK_MS)return;
   lastCheck=Date.now();checking=true;
   try{
    const response=await fetch(BASE+'/release.json',{cache:'no-store',signal:AbortSignal.timeout(6000)});
    if(!response.ok)return;
    const data=await response.json() as {release?:unknown};
    if(!cancelled&&typeof data.release==='string'&&/^[0-9a-f]{40}$/i.test(data.release)){
     setNewVersion(data.release!==CURRENT_RELEASE);
    }
   }catch{/* Static host or network unavailable. Never interrupt the active game. */}
   finally{checking=false;}
  };
  const visibility=()=>{if(document.visibilityState==='visible')void check()};
  const focus=()=>void check();
  // Stagger classrooms opening 40 devices at once rather than stampeding the host.
  const startup=window.setTimeout(()=>void check(),4000+Math.floor(Math.random()*8000));
  const interval=window.setInterval(()=>void check(),INTERVAL_MS);
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('focus',focus);
  // A suspended or offline student must be checked as soon as they reconnect.
  window.addEventListener('online',focus);
  window.addEventListener('pageshow',focus);
  return()=>{
   cancelled=true;window.clearTimeout(startup);window.clearInterval(interval);
   document.removeEventListener('visibilitychange',visibility);
   window.removeEventListener('focus',focus);
   window.removeEventListener('online',focus);
   window.removeEventListener('pageshow',focus);
  };
 },[]);
 if(!newVersion)return null;
 const reload=()=>{
  if(window.confirm('Доступна новая версия ГОС.ID. Перед обновлением сохраните несохранённые документы и сообщения. Перезагрузить страницу?')){
   window.location.reload();
  }
 };
 return <aside className="gosReleaseNotice" role="status" aria-live="polite">
  <span>Доступно обновление ГОС.ID. Сохраните изменения перед перезагрузкой.</span>
  <button type="button" className="primary" onClick={reload}>Обновить</button>
 </aside>;
}
