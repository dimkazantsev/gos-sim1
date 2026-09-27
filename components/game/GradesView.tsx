'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type Assessment={
 id:string;game_id:string;stage_no:number;user_id:string;auto_score:number;final_score:number|null;
 status:'draft'|'final';criterion_law:boolean;criterion_strategy:boolean;criterion_debrief:boolean;
 public_rationale:string;last_run_type:string;last_auto_at:string|null;revision_count:number;
 teacher_note:string|null;finalized_at:string|null
};
type Evidence=Record<string,unknown[]|unknown>;

const STAGES=Array.from({length:16},(_,i)=>i+1);
const shownScore=(a?:Assessment)=>a?(a.status==='final'?(a.final_score??a.auto_score):a.auto_score):null;
const level=(n:number)=>n===3?'Высокий':n===2?'Средний':n===1?'Низкий':'Нет участия';
const when=(v?:string|null)=>v?new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';

export default function GradesView({g,compact=false}:{g:ReturnTypeRepublic;compact?:boolean}){
 const {game,me,members,stages,teacher}=g;
 const [rows,setRows]=useState<Assessment[]>([]);
 const [selected,setSelected]=useState<{userId:string;stageNo:number}|null>(null);
 const [evidence,setEvidence]=useState<Evidence|null>(null);
 const [loadingEvidence,setLoadingEvidence]=useState(false);
 const [editScore,setEditScore]=useState(0);
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [debrief,setDebrief]=useState('');
 const [authId,setAuthId]=useState('');
 const students=members.filter(m=>m.kind==='student');

 async function load(){
  if(!game)return;
  const r=await supabase.from('stage_assessments').select('*').eq('game_id',game.id).order('stage_no');
  if(!r.error)setRows((r.data||[]) as Assessment[]);
 }
 useEffect(()=>{void load();void supabase.auth.getUser().then(x=>setAuthId(x.data.user?.id||''))},[game?.id,me?.user_id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('grades-view:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'stage_assessments',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 const currentStage=stages.find(s=>s.status==='open');
 const canWriteDebrief=!!me&&me.kind==='student'&&authId===me.user_id&&!!currentStage;
 const myRows=rows.filter(r=>r.user_id===me?.user_id);
 const myAverage=useMemo(()=>{
  const vals=myRows.map(shownScore).filter((x):x is number=>x!==null);
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
 },[myRows]);

 async function open(userId:string,stageNo:number){
  const a=rows.find(x=>x.user_id===userId&&x.stage_no===stageNo);
  setSelected({userId,stageNo});
  setEditScore(shownScore(a)??0);
  setNote(a?.teacher_note||'');
  setEvidence(null);
  if(!game||(!teacher&&userId!==me?.user_id))return;
  setLoadingEvidence(true);
  const r=await supabase.rpc('get_stage_assessment_evidence',{p_game_id:game.id,p_user_id:userId,p_stage_no:stageNo});
  if(!r.error)setEvidence((r.data||{}) as Evidence);
  setLoadingEvidence(false);
 }
 const assessment=selected?rows.find(x=>x.user_id===selected.userId&&x.stage_no===selected.stageNo):undefined;
 const selectedStudent=selected?members.find(m=>m.user_id===selected.userId):undefined;

 async function ensureDraft(){
  if(!game||!selected||!teacher)return;
  setBusy(true);
  const r=await supabase.rpc('recalculate_student_stage',{p_game_id:game.id,p_user_id:selected.userId,p_stage_no:selected.stageNo});
  if(r.error)g.setError(r.error.message);else await load();
  setBusy(false);
 }
 async function recalc(){
  if(!assessment)return;
  setBusy(true);
  const r=await supabase.rpc('recalculate_stage_assessment',{p_assessment_id:assessment.id});
  if(r.error)g.setError(r.error.message);else await load();
  setBusy(false);
 }
 async function finalize(){
  if(!assessment)return;
  setBusy(true);
  const r=await supabase.rpc('finalize_stage_assessment',{p_assessment_id:assessment.id,p_score:editScore,p_teacher_note:note||null});
  if(r.error)g.setError(r.error.message);else await load();
  setBusy(false);
 }
 async function reopen(){
  if(!assessment)return;
  setBusy(true);
  const r=await supabase.rpc('reopen_stage_assessment',{p_assessment_id:assessment.id});
  if(r.error)g.setError(r.error.message);else await load();
  setBusy(false);
 }
 async function submitDebrief(){
  if(!game||!currentStage||debrief.trim().length<40)return;
  setBusy(true);
  const r=await supabase.rpc('submit_stage_debrief',{p_game_id:game.id,p_stage_no:currentStage.stage_no,p_body:debrief.trim()});
  if(r.error)g.setError(r.error.message);else{setDebrief('');await load()}
  setBusy(false);
 }

 if(!game||!me)return null;
 if(compact){
  return <section className="surface vsnCompact">
   <div className="surfaceHead"><div><small>ЖУРНАЛ ВСН</small><h2>Динамика по 16 этапам</h2></div><strong>{myAverage?myAverage.toFixed(2):'—'}</strong></div>
   <div className="vsnMiniTrend">{STAGES.map(n=>{const a=myRows.find(x=>x.stage_no===n),v=shownScore(a);return <button key={n} className={a?.status||'empty'} onClick={()=>void open(me.user_id,n)} aria-label={'Этап '+n+', оценка '+(v??'нет')}><small>{n}</small><b>{v??'—'}</b></button>})}</div>
   <p className="vsnCompactHint">Нажмите на этап, чтобы увидеть критерии и обоснование оценки.</p>
   {selected&&<AssessmentModal g={g} assessment={assessment} selected={selected} student={selectedStudent} evidence={evidence} loading={loadingEvidence} teacher={false} editScore={editScore} setEditScore={setEditScore} note={note} setNote={setNote} busy={busy} close={()=>setSelected(null)} ensureDraft={ensureDraft} recalc={recalc} finalize={finalize} reopen={reopen}/>}
  </section>;
 }

 return <div className="gradesPage">
  <section className="gradesHero">
   <div><small>ВСН · 0–3 БАЛЛА</small><h1>Журнал оценок</h1><p>Все 16 этапов игры. Черновые оценки пересчитываются автоматически каждый час и дополнительно в 03:00; окончательную оценку утверждает только преподаватель.</p></div>
   <div className="gradesHeroLegend"><span className="draft">Черновик</span><span className="final">Итоговая</span><span className="empty">Нет оценки</span></div>
  </section>

  <section className="surface gradesRules">
   <div><b>1 балл</b><span>Право и правила</span><p>Знание норм, полномочий, процедур и корректное применение их в игровой ситуации.</p></div>
   <div><b>+1 балл</b><span>Стратегия и интересы</span><p>Осмысленные решения с учётом целей своей стороны, ресурсов, выгод, рисков и последствий.</p></div>
   <div><b>+1 балл</b><span>Анализ этапа</span><p>Причины, интересы, институты, результат и политические последствия произошедшего.</p></div>
   <div><b>0 баллов</b><span>Нет участия</span><p>На этапе не зафиксировано содержательных действий студента.</p></div>
  </section>

  <section className="surface gradesMatrixWrap">
   <div className="surfaceHead"><div><small>ГРУППА × ЭТАПЫ</small><h2>Оценки всех участников</h2></div><span>{students.length} студентов</span></div>
   <div className="gradesMatrix" role="table" aria-label="Матрица оценок по этапам">
    <div className="gradesMatrixHead" role="row"><b>Студент</b>{STAGES.map(n=><span key={n} title={stages.find(s=>s.stage_no===n)?.title||''}>{n}</span>)}</div>
    {students.length===0?<div className="emptyState">Студенты ещё не подключились.</div>:students.map(s=><div className="gradesMatrixRow" role="row" key={s.user_id}>
     <div><b>{s.full_name}</b><small>{s.team||'Без партии'} · {s.role_title||'роль не назначена'}</small></div>
     {STAGES.map(n=>{const a=rows.find(x=>x.user_id===s.user_id&&x.stage_no===n),v=shownScore(a);return <button key={n} className={a?.status||'empty'} onClick={()=>void open(s.user_id,n)} aria-label={s.full_name+', этап '+n+', '+(v??'нет оценки')}><b>{v??'—'}</b><small>{a?.status==='final'?'итог':a?'авто':''}</small></button>})}
    </div>)}
   </div>
  </section>

  {canWriteDebrief&&<section className="surface gradesDebrief">
   <div><small>ИТОГОВЫЙ РАЗБОР · КРИТЕРИЙ 3</small><h2>{currentStage!.stage_no}. {currentStage!.title}</h2><p>Опишите, что произошло, почему участники действовали именно так, какие интересы преследовали, какие нормы и институты повлияли на результат и какие последствия возникли.</p></div>
   <textarea rows={6} value={debrief} onChange={e=>setDebrief(e.target.value)} placeholder="Содержательный анализ текущего этапа…"/>
   <div><span>{debrief.trim().length} знаков</span><button className="primary" disabled={busy||debrief.trim().length<40} onClick={()=>void submitDebrief()}>Сдать разбор этапа</button></div>
  </section>}

  {selected&&<AssessmentModal g={g} assessment={assessment} selected={selected} student={selectedStudent} evidence={evidence} loading={loadingEvidence} teacher={teacher} editScore={editScore} setEditScore={setEditScore} note={note} setNote={setNote} busy={busy} close={()=>setSelected(null)} ensureDraft={ensureDraft} recalc={recalc} finalize={finalize} reopen={reopen}/>}
 </div>;
}

function AssessmentModal(p:any){
 const {g,assessment:a,selected,student,evidence,loading,teacher,editScore,setEditScore,note,setNote,busy,close,ensureDraft,recalc,finalize,reopen}=p;
 const v=shownScore(a);
 const canSeeEvidence=teacher||selected.userId===g.me?.user_id;
 return <div className="gradeModalBack" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><article className="gradeModal">
  <header><div><small>ЭТАП {selected.stageNo}</small><h2>{student?.full_name||g.me?.full_name}</h2><p>{g.stages.find((s:any)=>s.stage_no===selected.stageNo)?.title}</p></div><button onClick={close} aria-label="Закрыть">×</button></header>
  {!a?<div className="emptyState gradeEmpty">Черновик ещё не создан.{teacher&&<><br/><button className="primary" disabled={busy} onClick={()=>void ensureDraft()}>Рассчитать сейчас</button></>}</div>:<>
   <div className={'gradeScoreHero '+a.status}><strong>{v}</strong><div><b>{level(v??0)}</b><span>{a.status==='final'?'Итоговая оценка преподавателя':'Автоматический черновик'}</span></div></div>
   <div className="gradeCriteria"><span className={a.criterion_law?'ok':'miss'}><b>{a.criterion_law?'✓':'○'}</b> Право и правила</span><span className={a.criterion_strategy?'ok':'miss'}><b>{a.criterion_strategy?'✓':'○'}</b> Стратегия и интересы</span><span className={a.criterion_debrief?'ok':'miss'}><b>{a.criterion_debrief?'✓':'○'}</b> Анализ этапа</span></div>
   <section className="gradeRationale"><small>ИНТЕРПРЕТАЦИЯ ДЕЙСТВИЙ</small><p>{a.public_rationale}</p><footer><span>Пересчёт: {when(a.last_auto_at)}</span><span>{a.last_run_type}</span><span>версия {a.revision_count}</span></footer></section>
   {a.teacher_note&&<section className="gradeTeacherNote"><small>КОММЕНТАРИЙ ПРЕПОДАВАТЕЛЯ</small><p>{a.teacher_note}</p></section>}
   {teacher&&<section className="gradeApproval"><label>Итоговый балл<select value={editScore} onChange={e=>setEditScore(Number(e.target.value))}>{[0,1,2,3].map(n=><option value={n} key={n}>{n} · {level(n)}</option>)}</select></label><label>Комментарий<textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="Почему вы подтверждаете или меняете автооценку"/></label><div>{a.status==='final'?<button onClick={()=>void reopen()} disabled={busy}>Переоткрыть оценку</button>:<><button onClick={()=>void recalc()} disabled={busy}>Пересчитать сейчас</button><button className="primary" onClick={()=>void finalize()} disabled={busy}>Утвердить как итоговую</button></>}</div></section>}
  </>}
  {canSeeEvidence&&<section className="gradeEvidence"><div className="gradeEvidenceHead"><div><small>ДОКАЗАТЕЛЬСТВА</small><h3>Все зафиксированные действия на этапе</h3></div></div>{loading?<div className="emptyState">Собираю данные…</div>:evidence?<Evidence evidence={evidence}/>:<div className="emptyState">Доказательства ещё не загружены.</div>}</section>}
  {!canSeeEvidence&&<div className="gradePrivacy">Подробные тексты и действия доступны только самому студенту и преподавателю.</div>}
 </article></div>;
}

function Evidence({evidence}:{evidence:Evidence}){
 const defs:[string,string,string][]=[['Чат','chat','text'],['Политические процессы','political_posts','body'],['Голосования','ballots','choice'],['НПА','formal_documents','body_text'],['Действия с НПА','formal_actions','note'],['Решения и действия','actions','body'],['Партийные действия','party_actions','status'],['Итоговый разбор','debrief','body'],['Активность','activity','label']];
 return <div className="gradeEvidenceGroups">{defs.map(([title,key,textKey])=>{const arr=(evidence[key]||[]) as any[];if(!arr.length)return null;return <details key={key} open={key==='debrief'||key==='formal_documents'}><summary>{title}<span>{arr.length}</span></summary><div>{arr.map((x,i)=><article key={x.id||i}><small>{when(x.created_at||x.submitted_at||x.updated_at)}</small><b>{x.title||x.channel||x.action||x.action_type||x.event_type||title}</b><p>{String(x[textKey]||x.text||x.label||'').slice(0,3000)}</p>{x.weight!=null&&<em>Вес голоса: {x.weight}</em>}</article>)}</div></details>})}</div>;
}