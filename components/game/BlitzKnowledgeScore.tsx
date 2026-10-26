'use client';
import {userError} from '@/lib/userError';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
type Score={score:number;cases:number;actions:number;blitz:number;completion:number;cases_total:number;cases_right:number;actions_right:number;quiz_total:number;quiz_right:number;quiz_answered:number};
export default function BlitzKnowledgeScore({gameId,userId,stageNo}:{gameId:string;userId:string;stageNo:number}){
 const [score,setScore]=useState<Score|null>(null),[error,setError]=useState('');
 const scope=gameId+':'+userId+':'+stageNo,activeScope=useRef(scope),request=useRef(0);activeScope.current=scope;
 const go=async()=>{
  if(!gameId||!userId)return;const requestedScope=scope,ticket=++request.current;
  const result=await supabase.rpc('blitz_vsn',{p_game:gameId,p_student:userId,p_stage:stageNo});
  if(requestedScope!==activeScope.current||ticket!==request.current)return;
  if(result.error)setError(userError(result.error));else{setScore(result.data as Score);setError('')}
 };
 useEffect(()=>{setScore(null);setError('');return()=>{request.current++}},[scope]);
 useGameTableSync(gameId,['blitz_assignments','event_case_outcomes','event_decisions','formal_documents','stage_assessments'],go,scope,undefined,750,30000);
 useEffect(()=>{const updated=()=>void go();window.addEventListener('blitz:updated',updated);return()=>window.removeEventListener('blitz:updated',updated)},[scope]);
 return <section className="blitzVsnScore" aria-label="Показатель знаний ВСН"><header><b>Знания и правоприменение</b><strong>{score?Number(score.score).toFixed(2):'—'} / 1</strong></header>
 {score?<><div className="blitzVsnBreakdown">{([['Кейсы',score.cases],['Действия',score.actions],['Блиц',score.blitz],['Полнота',score.completion]] as [string,number][]).map(([name,value])=><span key={name}><small>{name}</small><b>{Number(value).toFixed(2)}</b></span>)}</div><p>Решения кейсов: {score.cases_right}/{score.cases_total}. Правомерные действия: {score.actions_right}. Блиц: {score.quiz_right}/{score.quiz_total}; отвечено: {score.quiz_answered}/{score.quiz_total}.</p><small>Отдельный показатель по знаниям; утверждённые итоговые оценки не изменяются автоматически.</small></>:<p>{error||'Загружается расчёт знаний по этапу…'}</p>}</section>;
}