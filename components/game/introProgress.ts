'use client';
import {useEffect,useRef,useState} from 'react';

const PREFIX='gos-sims:intro-seen:v2:';
function readSeen(scope:string){
 try{return window.localStorage.getItem(PREFIX+scope)==='1'}catch{return false}
}
function rememberSeen(scope:string){
 try{window.localStorage.setItem(PREFIX+scope,'1')}catch{/* The confirmed server timestamp remains authoritative. */}
}

/** Local progress only suppresses replay. Profile completion and permissions stay server verified. */
export function useIntroProgress({gameId,userId,ready,observer,serverSeen,persist}:{
 gameId:string;userId:string;ready:boolean;observer:boolean;serverSeen:boolean;persist:()=>Promise<void>;
}){
 const scope=gameId&&userId?userId:'';
 const [open,setOpen]=useState(false),[seenScope,setSeenScope]=useState(''),[syncError,setSyncError]=useState('');
 const started=useRef(''),persistRef=useRef(persist);
 persistRef.current=persist;
 const seen=!!scope&&(serverSeen||seenScope===scope);

 useEffect(()=>{
  if(!scope||observer){setOpen(false);return}
  if(!ready)return;
  if(serverSeen||readSeen(scope)||(()=>{try{return window.localStorage.getItem('gos-sims:intro-seen:v1:'+gameId+':'+userId)==='1'}catch{return false}})()){
   rememberSeen(scope);setSeenScope(scope);if(started.current!==scope)setOpen(false);return;
  }
  if(started.current!==scope){started.current=scope;rememberSeen(scope);setSeenScope(scope);setOpen(true)}
 },[scope,ready,observer,serverSeen]);

 useEffect(()=>{
  if(!scope||!ready||observer||!seen||serverSeen)return;
  let active=true,inFlight=false,retry:ReturnType<typeof setTimeout>|undefined,delay=5000;
  async function sync(){
   if(!active||inFlight||navigator.onLine===false)return;
   if(retry){clearTimeout(retry);retry=undefined}
   inFlight=true;
   try{
    await persistRef.current();
    if(active)setSyncError('');
   }catch{
    if(active){
     setSyncError('Просмотр сохранён на этом устройстве. Синхронизация с базой повторится после восстановления связи.');
     retry=setTimeout(()=>void sync(),delay);delay=Math.min(delay*2,60000);
    }
   }finally{inFlight=false}
  }
  const reconnect=()=>void sync();
  const visible=()=>{if(document.visibilityState==='visible')void sync()};
  void sync();window.addEventListener('online',reconnect);document.addEventListener('visibilitychange',visible);
  return()=>{active=false;if(retry)clearTimeout(retry);window.removeEventListener('online',reconnect);document.removeEventListener('visibilitychange',visible)};
 },[scope,ready,observer,seen,serverSeen]);

 function finish(){
  if(!scope||observer)return;
  rememberSeen(scope);started.current=scope;setSeenScope(scope);setOpen(false);
 }
 return {open,seen,finish,syncError};
}
