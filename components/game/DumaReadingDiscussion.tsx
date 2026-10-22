'use client';
import {useEffect,useState} from 'react';
import {Clock3,Mic2} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';
import styles from './LegislativeSessionLab.module.css';

export type Discussion={id:string;discussion_phase?:string;speaker_user_id?:string|null;speech_ends_at?:string|null;opened_document_step:string|null};
const labels:Record<string,string>={report:'Доклад',committee:'Позиция профильного комитета',questions:'Вопросы и ответы',debate:'Обсуждение',amendments:'Голосования по поправкам',vote:'Голосование по законопроекту'};
export default function DumaReadingDiscussion({g,item,canManage,onRefresh}:{g:ReturnTypeRepublic;item:Discussion;canManage:boolean;onRefresh:()=>Promise<void>}){
 const [now,setNow]=useState(()=>Date.now()),[speaker,setSpeaker]=useState(''),[seconds,setSeconds]=useState(180),[busy,setBusy]=useState(false);
 const phase=item.discussion_phase||'report';
 const phases=item.opened_document_step==='reading2'?['report','debate','amendments','vote']:item.opened_document_step==='reading3'?['report','debate','vote']:['report','committee','questions','debate','vote'];
 const maximum=phase==='questions'?1200:phase==='report'&&item.opened_document_step==='reading2'?420:phase==='report'?180:86400;
 const left=item.speech_ends_at?Math.max(0,Math.ceil((new Date(item.speech_ends_at).getTime()-now)/1000)):null;
 useEffect(()=>{setSpeaker('');setSeconds(Math.min(180,maximum))},[item.id,phase,maximum]);
 useEffect(()=>{if(!item.speech_ends_at)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[item.speech_ends_at]);
 async function act(next:string,start=false){
  if(busy||!canManage)return;setBusy(true);
  try{const result=await supabase.rpc('set_duma_discussion_phase',{p_item_id:item.id,p_phase:next,p_speaker:start?speaker:null,p_seconds:start?seconds:null});if(result.error)throw result.error;await onRefresh()}
  catch(error){g.setError(userError(error))}finally{setBusy(false)}
 }
 const next=phases[phases.indexOf(phase)+1];
 return <section className={styles.discussion} aria-label="Выступления и обсуждение">
  <ol className={styles.discussionSteps}>{phases.map((code,index)=><li key={code} aria-current={phase===code?'step':undefined} data-done={index<phases.indexOf(phase)}>{labels[code]}</li>)}</ol>
  {phase!=='vote'&&phase!=='amendments'&&<><header className={styles.speakerHead}><div><Mic2 size={18}/><b>{labels[phase]}</b></div><span className={styles.timer} role="timer" aria-label="Оставшееся время выступления"><Clock3 size={17}/>{left===null?'Таймер не запущен':left===0?'Время истекло':String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0')}</span></header>
   <p>{item.speaker_user_id?g.members.find(m=>m.user_id===item.speaker_user_id)?.full_name||'Выступающий участник':'Председатель предоставляет слово участнику.'} {maximum===86400?'Время выступления определяет председатель.':'Максимум для этого выступления: '+Math.floor(maximum/60)+' мин.'}</p>
   {canManage&&<div className={styles.speakerControls}><label>Выступающий<select aria-label="Выступающий" value={speaker} onChange={e=>setSpeaker(e.target.value)} disabled={busy}><option value="">Выберите участника</option>{g.members.filter(m=>m.kind!=='observer'&&!m.roster_archived_at).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label><label>Время, секунд<input aria-label="Время выступления, секунд" type="number" min={1} max={maximum} value={seconds} onChange={e=>setSeconds(Number(e.target.value))} disabled={busy}/></label><button type="button" className="secondary" disabled={busy||!speaker||!Number.isInteger(seconds)||seconds<1||seconds>maximum||left!==null&&left>0} onClick={()=>void act(phase,true)}>Предоставить слово</button></div>}
  </>}
  {phase==='amendments'&&<p>Рассмотрите внесённые поправки в таблице выше. После голосования по каждой поправке можно открыть итоговое голосование второго чтения.</p>}
  {phase==='vote'?<p>Обсуждение завершено. Открыто связанное голосование по законопроекту.</p>:canManage&&next&&<button type="button" className="primary" disabled={busy||phase!=='amendments'&&!item.speech_ends_at} onClick={()=>void act(next)}>{busy?'Сохранение…':next==='vote'?'Завершить обсуждение и открыть голосование':next==='amendments'?'Завершить обсуждение и перейти к поправкам':'Завершить: '+labels[phase].toLocaleLowerCase('ru-RU')}</button>}
 </section>;
}
