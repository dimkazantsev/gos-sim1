'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import RepublicComic from './RepublicComic';
import {eligibleComicStages,type ComicChapter} from './stageComicModel';
import type {Stage} from './types';

export function comicSeenKey(gameId:string,userId:string,chapterId:string){return 'gos-id:stage-comic-seen:v2:'+gameId+':'+userId+':'+chapterId}

/** One bounded read on stage completion, using the existing stage sync. No polling or additional subscription. */
export default function StageComics({gameId,userId,stages,enabled,onOpenChange}:{gameId:string;userId:string;stages:Stage[];enabled:boolean;onOpenChange?:(open:boolean)=>void}){
 const signature=eligibleComicStages(stages).join(',');
 const [queue,setQueue]=useState<ComicChapter[]>([]),[seen,setSeen]=useState<string[]>([]),[canShow,setCanShow]=useState(false),[retry,setRetry]=useState(0);
 const scope=gameId+':'+userId,scopeRef=useRef(scope),shownRef=useRef(false),failed=useRef(false),notifyRef=useRef(onOpenChange);
 scopeRef.current=scope;notifyRef.current=onOpenChange;
 useEffect(()=>{
  failed.current=false;
  if(!gameId||!userId||!signature){setQueue([]);return}
  let active=true;const capturedScope=scope;
  void supabase.from('republic_comic_chapters').select('id,game_id,stage_no,kind,title,body,snapshot,created_at').eq('game_id',gameId).eq('kind','completed').in('stage_no',signature.split(',').map(Number)).order('stage_no').then(result=>{
   if(!active||capturedScope!==scopeRef.current)return;
   failed.current=!!result.error;
   if(result.error)return;
   const chapters=(result.data||[]).filter(c=>c.snapshot?.version===2) as ComicChapter[];
   const viewed=chapters.filter(c=>{try{return window.localStorage.getItem(comicSeenKey(gameId,userId,c.id))==='1'}catch{return false}}).map(c=>c.id);
   setSeen(previous=>[...new Set([...previous,...viewed])]);setQueue(chapters);
  },()=>{if(active)failed.current=true});
  return()=>{active=false};
 },[scope,signature,retry]);
 useEffect(()=>{
  const retryFailed=()=>{if(failed.current)setRetry(n=>n+1)};
  const visible=()=>{if(document.visibilityState==='visible')retryFailed()};
  window.addEventListener('online',retryFailed);document.addEventListener('visibilitychange',visible);
  return()=>{window.removeEventListener('online',retryFailed);document.removeEventListener('visibilitychange',visible)};
 },[]);
 // A result waits for an existing dialog (for example, a started blitz attempt).
 useEffect(()=>{
  function update(){if(!shownRef.current)setCanShow(!document.querySelector('[role="dialog"][aria-modal="true"]'))}
  update();const observer=new MutationObserver(update);observer.observe(document.body,{childList:true,subtree:true});
  return()=>observer.disconnect();
 },[]);
 const chapter=queue.find(c=>!seen.includes(c.id));
 const open=!!chapter&&enabled&&canShow;
 shownRef.current=open;
 useLayoutEffect(()=>{
  const otherDialog=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).some(panel=>panel.dataset.automaticComic!=='true');
  if(open&&otherDialog){shownRef.current=false;setCanShow(false);notifyRef.current?.(false);return}
  notifyRef.current?.(open);return()=>notifyRef.current?.(false);
 },[open]);
 function close(){
  if(!chapter)return;
  try{window.localStorage.setItem(comicSeenKey(gameId,userId,chapter.id),'1')}catch{/* In-memory progress prevents replay in this session. */}
  setSeen(previous=>[...previous,chapter.id]);
 }
 return chapter?<RepublicComic key={chapter.id} gameId={gameId} open={open} onClose={close} initialChapter={chapter}/>:null;
}
