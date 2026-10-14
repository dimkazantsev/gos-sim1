'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
type Score={score:number;cases:number;actions:number;blitz:number;completion:number;cases_total:number;cases_right:number;actions_right:number;quiz_total:number;quiz_right:number;quiz_answered:number};
export default function BlitzKnowledgeScore({gameId,userId,stageNo}:{gameId:string;userId:string;stageNo:number}){
 const [score,setScore]=useState<Score|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!gameId||!userId)return;
  let current=true,request=0;
  setScore(null);
  const go=async()=>{
   const token=++request;
   const result=await supabase.rpc('blitz_vsn',{p_game:gameId,p_student:userId,p_stage:stageNo});
   if(!current||token!==request)return;
   if(result.error)setError(result.error.message);
   else{setScore(result.data as Score);setError('')}
  };
  void go();
  const updated=()=>void go();
  window.addEventListener('blitz:updated',updated);
  const channel=supabase.channel('blitz-vsn-score:'+gameId+':'+userId+':'+stageNo)
   .on('postgres_changes',{event:'UPDATE',schema:'public',table:'blitz_assignments',filter:'user_id=eq.'+userId},updated).subscribe();
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void go()},30000);
  return()=>{current=false;clearInterval(timer);window.removeEventListener('blitz:updated',updated);void supabase.removeChannel(channel)};
 },[gameId,userId,stageNo]);
 return <section className="blitzVsnScore" aria-label="Показатель знаний ВСН"><header><b>Знания и правоприменение</b><strong>{score?Number(score.score).toFixed(2):'—'} / 1</strong></header>
 {score?<><div className="blitzVsnBreakdown">{([['Кейсы',score.cases],['Действия',score.actions],['Блиц',score.blitz],['Полнота',score.completion]] as [string,number][]).map(([name,value])=><span key={name}><small>{name}</small><b>{Number(value).toFixed(2)}</b></span>)}</div><p>Решения кейсов: {score.cases_right}/{score.cases_total}. Правомерные действия: {score.actions_right}. Блиц: {score.quiz_right}/{score.quiz_total}; отвечено: {score.quiz_answered}/{score.quiz_total}.</p><small>Отдельный показатель по знаниям; утверждённые итоговые оценки не изменяются автоматически.</small></>:<p>{error||'Загружается расчёт знаний по этапу…'}</p>}</section>;
}