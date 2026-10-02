'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {GAME_PHASES} from './stageSystem';

type Reflection={id:string;game_id:string;user_id:string;phase_key:string;decision_memory:string;causal_analysis:string;effectiveness:string;improvement:string;status:'draft'|'submitted'|'reviewed';teacher_feedback:string|null;updated_at:string;submitted_at:string|null;reviewed_at:string|null};
type Draft={decision:string;causal:string;effectiveness:string;improvement:string};

const phasePrompt:Record<string,string>={
 foundation:'Вспомните создание партий, КСРФ, выбор избирательной и региональной архитектуры.',
 parliament:'Восстановите выборы руководства ГД, ghost voting, коалиции и парламентские процедуры.',
 executive:'Разберите президентские выборы, формирование Правительства и кадровую архитектуру.',
 policy:'Разберите послание, государственные программы, заседания Правительства, законы и бюджет.',
 territory:'Разберите муниципальный проект и кризис: компетенции, данные, ресурсы и последствия.',
 debrief:'Соберите общую модель государства: какие правила породили конечный результат и что нужно изменить в следующем запуске.'
};

export default function SystemDebriefLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,stages,parties,votes,formalDocuments,crises,metricHistory,partyAgreements,setError}=g;
 const [rows,setRows]=useState<Reflection[]>([]);
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [feedback,setFeedback]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);

 async function load(){
  if(!game)return;
  const r=await supabase.from('game_reflections').select('*').eq('game_id',game.id).order('updated_at',{ascending:false});
  if(!r.error){
   const data=(r.data||[]) as Reflection[];setRows(data);
   const mine=data.filter(x=>x.user_id===me?.user_id);
   const next:Record<string,Draft>={};
   for(const x of mine)next[x.phase_key]={decision:x.decision_memory,causal:x.causal_analysis,effectiveness:x.effectiveness,improvement:x.improvement};
   setDrafts(v=>({...v,...next}));
  }
 }
 useEffect(()=>{void load()},[game?.id,me?.user_id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('game-reflections:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'game_reflections',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const activeGame=game;
 const myRows=rows.filter(x=>x.user_id===me.user_id);
 const phaseRow=(key:string)=>myRows.find(x=>x.phase_key===key);
 const d=(key:string)=>drafts[key]||{decision:'',causal:'',effectiveness:'',improvement:''};
 const setD=(key:string,field:keyof Draft,value:string)=>setDrafts(v=>({...v,[key]:{...(v[key]||{decision:'',causal:'',effectiveness:'',improvement:''}),[field]:value}}));
 const completedStages=stages.filter(s=>s.status==='completed').length;
 const changedMetrics=metricHistory.filter(x=>x.source_type!=='baseline').length;
 const acceptedAgreements=partyAgreements.filter(x=>['accepted','fulfilled'].includes(x.status)).length;

 const studentProgress=useMemo(()=>members.filter(m=>m.kind==='student').map(m=>{
  const rr=rows.filter(x=>x.user_id===m.user_id);
  return {m,submitted:rr.filter(x=>x.status==='submitted'||x.status==='reviewed').length,reviewed:rr.filter(x=>x.status==='reviewed').length};
 }).sort((a,b)=>b.submitted-a.submitted||a.m.full_name.localeCompare(b.m.full_name)),[members,rows]);

 async function save(key:string,submit:boolean){
  const x=d(key);setBusy(true);
  const r=await supabase.rpc('save_game_reflection',{p_game_id:activeGame.id,p_phase_key:key,p_decision_memory:x.decision,p_causal_analysis:x.causal,p_effectiveness:x.effectiveness,p_improvement:x.improvement,p_submit:submit});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function review(id:string){
  setBusy(true);const r=await supabase.rpc('review_game_reflection',{p_reflection_id:id,p_feedback:(feedback[id]||'').trim()||null});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }

 return <section className="debriefLab">
  <header className="debriefHead">
   <div><small>ЭТАП 16 · РЕФЛЕКСИЯ</small><h2>Разбор построенного государства</h2><p>Финал не просит пересказать правила. Нужно восстановить собственные решения, причинную цепочку и институциональные последствия, а затем предложить конкретное изменение следующего запуска игры.</p></div>
   <div className="debriefState"><strong>{completedStages}/16</strong><span>этапов завершено</span><em>{myRows.filter(x=>x.status!=='draft').length}/6 рефлексий сдано</em></div>
  </header>

  <div className="debriefEvidence">
   <article><small>ПАРТИИ</small><strong>{parties.length}</strong><span>политических организаций</span></article>
   <article><small>ГОЛОСОВАНИЯ</small><strong>{votes.length}</strong><span>{votes.filter(v=>v.status==='closed').length} завершено</span></article>
   <article><small>НПА</small><strong>{formalDocuments.length}</strong><span>в формальном реестре</span></article>
   <article><small>КРИЗИСЫ</small><strong>{crises.length}</strong><span>{crises.filter(c=>c.status==='resolved').length} завершено</span></article>
   <article><small>ИЗМЕНЕНИЯ KPI</small><strong>{changedMetrics}</strong><span>после исходного состояния</span></article>
   <article><small>СОГЛАШЕНИЯ</small><strong>{acceptedAgreements}</strong><span>принято / исполнено</span></article>
  </div>

  {!teacher&&<div className="reflectionPhases">{GAME_PHASES.map(p=>{
   const row=phaseRow(p.id),x=d(p.id),locked=row?.status==='reviewed';
   return <article className={'reflectionCard '+(row?.status||'draft')} key={p.id}>
    <header><span style={{background:p.accent}}>{String(p.range[0]).padStart(2,'0')}{p.range[1]!==p.range[0]?'–'+String(p.range[1]).padStart(2,'0'):''}</span><div><small>{p.short}</small><h3>{p.title}</h3><p>{phasePrompt[p.id]}</p></div><em>{row?.status==='reviewed'?'Проверено':row?.status==='submitted'?'Сдано':'Черновик'}</em></header>
    <div className="reflectionGrid">
     <label>1 · Какие решения вы помните?<textarea rows={4} disabled={locked} value={x.decision} onChange={e=>setD(p.id,'decision',e.target.value)} placeholder="Назовите конкретные решения, переговоры, документы, голосования или действия."/></label>
     <label>2 · Какая была причинная цепочка?<textarea rows={4} disabled={locked} value={x.causal} onChange={e=>setD(p.id,'causal',e.target.value)} placeholder="Решение → реакция других акторов → изменение института/ресурса → результат."/></label>
     <label>3 · Что оказалось эффективным или ошибочным?<textarea rows={3} disabled={locked} value={x.effectiveness} onChange={e=>setD(p.id,'effectiveness',e.target.value)} placeholder="По каким наблюдаемым признакам вы это оцениваете?"/></label>
     <label>4 · Что изменить в следующей игре?<textarea rows={3} disabled={locked} value={x.improvement} onChange={e=>setD(p.id,'improvement',e.target.value)} placeholder="Конкретное изменение механики, правила, интерфейса или учебной процедуры."/></label>
    </div>
    {row?.teacher_feedback&&<div className="reflectionFeedback"><b>Комментарий преподавателя</b><p>{row.teacher_feedback}</p></div>}
    {!locked&&<footer><button className="secondary" disabled={busy} onClick={()=>void save(p.id,false)}>Сохранить черновик</button><button className="primary" disabled={busy||x.decision.trim().length<20||x.causal.trim().length<20||x.effectiveness.trim().length<10||x.improvement.trim().length<10} onClick={()=>void save(p.id,true)}>Сдать рефлексию</button></footer>}
   </article>
  })}</div>}

  {teacher&&<section className="debriefTeacher">
   <div className="debriefTeacherHead"><div><small>ПАНЕЛЬ ПРЕПОДАВАТЕЛЯ</small><h3>Готовность к итоговому обсуждению</h3></div><span>{studentProgress.filter(x=>x.submitted===6).length}/{studentProgress.length} завершили всё</span></div>
   <div className="reflectionStudentList">{studentProgress.map(({m,submitted,reviewed})=><article key={m.user_id}><header><div><b>{m.full_name}</b><span>{m.role_title||m.team||'Участник'}</span></div><strong>{submitted}/6</strong><em>{reviewed} проверено</em></header>{rows.filter(x=>x.user_id===m.user_id&&x.status!=='draft').sort((a,b)=>GAME_PHASES.findIndex(p=>p.id===a.phase_key)-GAME_PHASES.findIndex(p=>p.id===b.phase_key)).map(r=><details key={r.id}><summary><b>{GAME_PHASES.find(p=>p.id===r.phase_key)?.title||r.phase_key}</b><span>{r.status==='reviewed'?'✓ проверено':'ожидает разбора'}</span></summary><div className="reflectionReviewBody"><section><small>РЕШЕНИЯ</small><p>{r.decision_memory}</p></section><section><small>ПРИЧИННАЯ ЦЕПОЧКА</small><p>{r.causal_analysis}</p></section><section><small>ЭФФЕКТИВНОСТЬ</small><p>{r.effectiveness}</p></section><section><small>УЛУЧШЕНИЕ</small><p>{r.improvement}</p></section><textarea rows={2} value={feedback[r.id]??r.teacher_feedback??''} onChange={e=>setFeedback(v=>({...v,[r.id]:e.target.value}))} placeholder="Комментарий к рефлексии"/><button disabled={busy} onClick={()=>void review(r.id)}>Зафиксировать разбор</button></div></details>)}</article>)}</div>
  </section>}
 </section>;
}
