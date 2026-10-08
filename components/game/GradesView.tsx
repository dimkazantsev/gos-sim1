'use client';
import {IconAction} from '../ui/IconAction';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useDialog} from '../ui/useDialog';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import StyledSelect from '../ui/StyledSelect';
import ScoreFormula from './ScoreFormula';
import {ChevronDown} from 'lucide-react';

type Assessment={
 id:string;game_id:string;stage_no:number;user_id:string;auto_score:number;final_score:number|null;
 status:'draft'|'final';criterion_law:boolean;criterion_strategy:boolean;criterion_debrief:boolean;
 public_rationale:string;last_run_type:string;last_auto_at:string|null;revision_count:number;
 teacher_note:string|null;finalized_at:string|null
};
type Evidence=Record<string,unknown[]|unknown>;
type Run={id:number;assessment_id:string;run_type:string;auto_score:number;criterion_law:boolean;criterion_strategy:boolean;criterion_debrief:boolean;created_at:string};
type Debrief={id:string;game_id:string;stage_no:number;user_id:string;body:string;updated_at:string};

const STAGES=Array.from({length:16},(_,i)=>i+1);
const shownScore=(a?:Assessment)=>a?(a.status==='final'?(a.final_score??a.auto_score):a.auto_score):null;
const level=(n:number)=>n===3?'Высокий':n===2?'Средний':n===1?'Низкий':n>0?'С учётом штрафа':'Нет участия';
const isFinalScore=(n:number|null):n is number=>n!==null&&Number.isInteger(n)&&n>=0&&n<=3;
const finalScoreChoice=(a?:Assessment)=>{const score=shownScore(a);return isFinalScore(score)?score:null;};
const when=(v?:string|null)=>v?new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';

export default function GradesView({g,compact=false,onOpenProfile}:{g:ReturnTypeRepublic;compact?:boolean;onOpenProfile?:(id:string)=>void}){
 const {game,me,members,stages,teacher}=g;
 const [rows,setRows]=useState<Assessment[]>([]);
 const [runs,setRuns]=useState<Run[]>([]);
 const [debriefRows,setDebriefRows]=useState<Debrief[]>([]);
 const [selected,setSelected]=useState<{userId:string;stageNo:number}|null>(null);
 const evidenceRequest=useRef(0);
 const [evidence,setEvidence]=useState<Evidence|null>(null);
 const [loadingEvidence,setLoadingEvidence]=useState(false);
 const [editScore,setEditScore]=useState<number|null>(null);
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [debrief,setDebrief]=useState('');
 const [debriefStage,setDebriefStage]=useState<number|null>(null);
 const [authId,setAuthId]=useState('');
 const [gradeSearch,setGradeSearch]=useState('');
 const [gradeTeam,setGradeTeam]=useState('');
 const [gradeSort,setGradeSort]=useState<'surname'|'name'|'sum'|'average'|'final'|'graded'>('surname');
 const [gradeAsc,setGradeAsc]=useState(true);
 const [gradeOnlyPending,setGradeOnlyPending]=useState(false);
 const students=members.filter(m=>m.kind==='student');
 const gradeByStudent=useMemo(()=>{
  const map=new Map<string,{sum:number;average:number|null;final:number;graded:number}>();
  for(const student of students){
   const selected=rows.filter(a=>a.user_id===student.user_id),sum=selected.reduce((v,a)=>v+(shownScore(a)??0),0);
   map.set(student.user_id,{sum,average:selected.length?sum/selected.length:null,final:selected.filter(a=>a.status==='final').length,graded:selected.length});
  }
  return map;
 },[rows,members]);
 const teams=[...new Set(students.map(s=>s.team||s.group_name||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
 const sortedStudents=students.filter(s=>{
  const stats=gradeByStudent.get(s.user_id);
  return (!gradeTeam||(s.team||s.group_name||'')===gradeTeam)&&
   (!gradeOnlyPending||!!stats&&stats.final<stats.graded)&&
   (!gradeSearch||[s.full_name,s.team||'',s.group_name||'',s.role_title||''].some(v=>v.toLocaleLowerCase('ru').includes(gradeSearch.trim().toLocaleLowerCase('ru'))));
 }).sort((a,b)=>{
  const av=gradeByStudent.get(a.user_id),bv=gradeByStudent.get(b.user_id);
  const part=(s:string,i:number)=>s.trim().split(/\s+/)[i]||'';
  const cmp=gradeSort==='surname'?part(a.full_name,0).localeCompare(part(b.full_name,0),'ru'):
   gradeSort==='name'?part(a.full_name,1).localeCompare(part(b.full_name,1),'ru'):
   gradeSort==='sum'?(av?.sum||0)-(bv?.sum||0):
   gradeSort==='average'?(av?.average??-1)-(bv?.average??-1):
   gradeSort==='final'?(av?.final||0)-(bv?.final||0):(av?.graded||0)-(bv?.graded||0);
  return (gradeAsc?cmp:-cmp)||a.full_name.localeCompare(b.full_name,'ru');
 });


 async function load(){
  if(!game)return;
  if(teacher){
   const r=await supabase.from('stage_assessments').select('*').eq('game_id',game.id).order('stage_no');
   if(!r.error)setRows((r.data||[]) as Assessment[]);
  }else{
   // Everyone sees numerical scores; details belong only to the actual account owner.
   const publicResult=await supabase.rpc('get_public_stage_scores',{p_game_id:game.id});
   const safeRows:Assessment[]=((publicResult.data||[]) as Pick<Assessment,'user_id'|'stage_no'|'auto_score'|'final_score'|'status'>[])
    .map(a=>({...a,id:'public-'+a.user_id+'-'+a.stage_no,game_id:game.id,
      criterion_law:false,criterion_strategy:false,criterion_debrief:false,
      public_rationale:'',last_run_type:'',last_auto_at:null,revision_count:0,
      teacher_note:null,finalized_at:null}));
   if(me&&authId===me.user_id){
    const own=await supabase.from('stage_assessments').select('*').eq('game_id',game.id).eq('user_id',me.user_id).order('stage_no');
    if(!own.error){
     const map=new Map(safeRows.map(a=>[a.user_id+':'+a.stage_no,a]));
     for(const a of (own.data||[]) as Assessment[])map.set(a.user_id+':'+a.stage_no,a);
     setRows([...map.values()]);
    }else setRows(safeRows);
   }else setRows(safeRows);
  }
  if(me?.kind==='student'&&authId===me.user_id){
   const d=await supabase.from('stage_debriefs').select('*').eq('game_id',game.id).eq('user_id',me.user_id).order('stage_no');
   if(!d.error)setDebriefRows((d.data||[]) as Debrief[]);
  }
 }
 useEffect(()=>{void supabase.auth.getUser().then(x=>setAuthId(x.data.user?.id||''))},[game?.id,me?.user_id]);
 useEffect(()=>{void load()},[game?.id,me?.user_id,authId,teacher]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('grades-view:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'stage_assessments',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'stage_debriefs',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 const currentStage=stages.find(s=>s.status==='open');
 const eligibleDebriefStages=stages.filter(s=>s.status==='open'||s.status==='completed');
 const targetDebriefStage=debriefStage??currentStage?.stage_no??eligibleDebriefStages.at(-1)?.stage_no??null;
 const targetDebrief=targetDebriefStage?stages.find(s=>s.stage_no===targetDebriefStage):undefined;
 const targetAssessment=targetDebriefStage?rows.find(r=>r.user_id===me?.user_id&&r.stage_no===targetDebriefStage):undefined;
 const canWriteDebrief=!!me&&me.kind==='student'&&authId===me.user_id&&!!targetDebrief&&targetAssessment?.status!=='final';
 const savedDebrief=targetDebriefStage==null?undefined:debriefRows.find(d=>d.stage_no===targetDebriefStage);
 useEffect(()=>{if(me?.kind!=='student'||targetDebriefStage==null)return;setDebrief(savedDebrief?.body||'')},[targetDebriefStage,savedDebrief?.body,me?.user_id]);
 const myRows=rows.filter(r=>r.user_id===me?.user_id);
 const myAverage=useMemo(()=>{
  const vals=myRows.map(shownScore).filter((x):x is number=>x!==null);
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
 },[myRows]);

 async function open(userId:string,stageNo:number){
  const request=++evidenceRequest.current;
  const a=rows.find(x=>x.user_id===userId&&x.stage_no===stageNo);
  setSelected({userId,stageNo});
  setEditScore(finalScoreChoice(a));
  setNote(a?.teacher_note||'');
  setEvidence(null);setRuns([]);
  if(!game||(!teacher&&(userId!==me?.user_id||authId!==me.user_id)))return;
  setLoadingEvidence(true);
  const requests:any[]=[supabase.rpc('get_stage_assessment_evidence',{p_game_id:game.id,p_user_id:userId,p_stage_no:stageNo})];
  if(a)requests.push(supabase.from('stage_assessment_runs').select('id,assessment_id,run_type,auto_score,criterion_law,criterion_strategy,criterion_debrief,created_at').eq('assessment_id',a.id).order('created_at',{ascending:false}).limit(50));
  const rr=await Promise.all(requests);
  if(request!==evidenceRequest.current)return;
  if(!rr[0].error)setEvidence((rr[0].data||{}) as Evidence);
  if(rr[1]&&!rr[1].error)setRuns((rr[1].data||[]) as Run[]);
  setLoadingEvidence(false);
 }
 const assessment=selected?rows.find(x=>x.user_id===selected.userId&&x.stage_no===selected.stageNo):undefined;
 const selectedStudent=selected?members.find(m=>m.user_id===selected.userId):undefined;
 useEffect(()=>{
  if(teacher&&assessment?.status==='draft'&&!Number.isInteger(assessment.auto_score))setEditScore(null);
 },[assessment?.id,assessment?.auto_score,assessment?.status,teacher]);

 async function syncTeacherDraft(assessmentId:string){
  const fresh=await supabase.from('stage_assessments').select('*').eq('id',assessmentId).single();
  if(!fresh.error&&fresh.data){
   const a=fresh.data as Assessment;
   setEditScore(finalScoreChoice(a));
   setNote(a.teacher_note||'');
  }
  await load();
 }
 async function ensureDraft(){
  if(!game||!selected||!teacher)return;
  setBusy(true);
  const r=await supabase.rpc('recalculate_student_stage',{p_game_id:game.id,p_user_id:selected.userId,p_stage_no:selected.stageNo});
  if(r.error)g.setError(r.error.message);else if(r.data)await syncTeacherDraft(String(r.data));else await load();
  setBusy(false);
 }
 async function recalc(){
  if(!assessment)return;
  setBusy(true);
  const r=await supabase.rpc('recalculate_stage_assessment',{p_assessment_id:assessment.id});
  if(r.error)g.setError(r.error.message);else await syncTeacherDraft(assessment.id);
  setBusy(false);
 }
 async function finalize(){
  if(!assessment||!teacher)return;
  if(!isFinalScore(editScore)){g.setError('Выберите итоговый целый балл от 0 до 3.');return;}
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
  if(!game||!targetDebrief||debrief.trim().length<40)return;
  setBusy(true);
  const r=await supabase.rpc('submit_stage_debrief',{p_game_id:game.id,p_stage_no:targetDebrief.stage_no,p_body:debrief.trim()});
  if(r.error)g.setError(r.error.message);else await load()
  setBusy(false);
 }

 if(!game||!me)return null;
 if(compact){
  return <section className="surface vsnCompact">
   <div className="surfaceHead"><div><small>ЖУРНАЛ ВСН</small><h2>Динамика по 16 этапам</h2></div><strong>{myAverage!==null?myAverage.toFixed(2):'—'}</strong></div>
   <div className="vsnMiniTrend">{STAGES.map(n=>{const a=myRows.find(x=>x.stage_no===n),v=shownScore(a);return <button key={n} className={a?.status||'empty'} onClick={()=>void open(me.user_id,n)} aria-label={'Этап '+n+', оценка '+(v??'нет')}><small>{n}</small><b>{v??'—'}</b></button>})}</div>
   <p className="vsnCompactHint">Нажмите на этап, чтобы увидеть критерии и обоснование оценки.</p>
   {selected&&<AssessmentModal g={g} assessment={assessment} selected={selected} student={selectedStudent} evidence={evidence} runs={runs} loading={loadingEvidence} teacher={false} editScore={editScore} setEditScore={setEditScore} note={note} setNote={setNote} busy={busy} close={()=>{evidenceRequest.current++;setSelected(null)}} ensureDraft={ensureDraft} recalc={recalc} finalize={finalize} reopen={reopen}/>}
  </section>;
 }

 return <div className="gradesPage">
  <section className="gradesHero">
   <div><small>ВСН · 0–3 БАЛЛА</small><h1>Журнал оценок</h1><p>Все 16 этапов игры. Черновые оценки пересчитываются автоматически каждый час и дополнительно в 03:00; окончательную оценку утверждает только преподаватель.</p></div>
   <div className="gradesHeroLegend"><span className="draft">Черновик</span><span className="final">Итоговая</span><span className="empty">Нет оценки</span></div>
  </section>

  <details className="surface gradesRulesCompact vsnGuide"><summary><div className="vsnGuideHeading"><strong>Критерии и формула ВСН</strong><span>Как рассчитывается оценка за этап</span></div><span className="vsnGuideRange">0–3 балла</span><ChevronDown className="vsnGuideChevron" size={20} aria-hidden="true"/></summary><div className="gradesRuleItems vsnCriteria">
   <article><b>1 балл</b><h3>Право и правила</h3><p>Знание норм, полномочий и процедур. Корректное применение их в игровой ситуации.</p></article>
   <article><b>1 балл</b><h3>Стратегия и интересы</h3><p>Осмысленные решения с учётом целей своей стороны, ресурсов, выгод, рисков и последствий.</p></article>
   <article><b>1 балл</b><h3>Анализ этапа</h3><p>Разбор причин, интересов, институтов, результата и политических последствий.</p></article>
   <article><b>0 баллов</b><h3>Нет участия</h3><p>На этапе не зафиксировано содержательных действий студента.</p></article>
  </div>{teacher&&<ScoreFormula embedded/>}</details>
  <section className="surface gradesMatrixWrap">
   <div className="surfaceHead"><div><small>ГРУППА × ЭТАПЫ</small><h2>Оценки всех участников</h2></div><span>{sortedStudents.length} из {students.length}</span></div>
   <div className="gradesToolbar">
    <label><span>Поиск</span><input type="search" value={gradeSearch} onChange={e=>setGradeSearch(e.target.value)} placeholder="Фамилия, имя, роль" aria-label="Поиск студентов"/></label>
    <StyledSelect label="Партия или группа" value={gradeTeam} onChange={setGradeTeam} options={[{value:'',label:'Все'},...teams.map(t=>({value:t,label:t}))]}/>
    <StyledSelect label="Сортировка" value={gradeSort} onChange={v=>setGradeSort(v as typeof gradeSort)} options={[
     {value:'surname',label:'По фамилии'},{value:'name',label:'По имени'},{value:'sum',label:'По сумме баллов'},
     {value:'average',label:'По среднему баллу'},{value:'final',label:'По утверждённым'},{value:'graded',label:'По количеству оценок'}]}/>
    <button type="button" className="gradesSortDir" onClick={()=>setGradeAsc(!gradeAsc)} aria-label={gradeAsc?'Сортировать по убыванию':'Сортировать по возрастанию'}>{gradeAsc?'↑':'↓'}</button>
    <label className="gradesPending"><input type="checkbox" checked={gradeOnlyPending} onChange={e=>setGradeOnlyPending(e.target.checked)}/> Есть неутверждённые</label>
   </div>
   <div className="gradesMatrix" role="table" aria-label="Матрица оценок по этапам">
    <div className="gradesMatrixHead" role="row"><b>Студент</b><span className="gradeTotalHead">Σ</span><span className="gradeTotalHead">Ср.</span>{STAGES.map(n=><span key={n} title={stages.find(s=>s.stage_no===n)?.title||''}>{n}</span>)}</div>
    {sortedStudents.length===0?<div className="emptyState">Нет студентов по выбранным фильтрам.</div>:sortedStudents.map(s=><div className="gradesMatrixRow" role="row" key={s.user_id}>
     <div>{onOpenProfile?<button type="button" className="gradesProfileLink" onClick={()=>onOpenProfile(s.user_id)}>{s.full_name}</button>:<b>{s.full_name}</b>}<small>{s.team||'Без партии'} · {s.role_title||'Роль не назначена'}</small></div>
     <span className="gradeTotal">{gradeByStudent.get(s.user_id)?.graded?gradeByStudent.get(s.user_id)?.sum:'—'}</span>
     <span className="gradeTotal">{gradeByStudent.get(s.user_id)?.average?.toFixed(2)??'—'}</span>
     {STAGES.map(n=>{const a=rows.find(x=>x.user_id===s.user_id&&x.stage_no===n),v=shownScore(a);return <button key={n} className={a?.status||'empty'} onClick={()=>void open(s.user_id,n)} aria-label={s.full_name+', этап '+n+', '+(v??'нет оценки')}><b>{v??'—'}</b><small>{a?.status==='final'?'итог':a?'авто':''}</small></button>})}
    </div>)}
   </div>
  </section>

  {!!me&&me.kind==='student'&&authId===me.user_id&&eligibleDebriefStages.length>0&&<section className="surface gradesDebrief">
   <div><small>ИТОГОВЫЙ РАЗБОР · КРИТЕРИЙ 3</small><StyledSelect label="Этап для итогового разбора" value={String(targetDebriefStage??'')} onChange={v=>setDebriefStage(Number(v))} options={eligibleDebriefStages.map(stage=>({value:String(stage.stage_no),label:stage.stage_no+'. '+stage.title}))}/><p>Опишите причины, интересы участников, правила и институты, результат и политические последствия. До утверждения итоговой оценки разбор можно обновлять.</p></div>
   <textarea rows={6} value={debrief} disabled={!canWriteDebrief} onChange={e=>setDebrief(e.target.value)} placeholder={targetAssessment?.status==='final'?'Оценка уже утверждена преподавателем':'Содержательный анализ выбранного этапа…'}/>
   <div><span>{targetAssessment?.status==='final'?'Итоговая оценка зафиксирована':debrief.trim().length+' знаков'}</span><button className="primary" disabled={!canWriteDebrief||busy||debrief.trim().length<40} onClick={()=>void submitDebrief()}>Сдать / обновить разбор</button></div>
  </section>}

  {selected&&<AssessmentModal g={g} assessment={assessment} selected={selected} student={selectedStudent} evidence={evidence} runs={runs} loading={loadingEvidence} teacher={teacher} editScore={editScore} setEditScore={setEditScore} note={note} setNote={setNote} busy={busy} close={()=>{evidenceRequest.current++;setSelected(null)}} ensureDraft={ensureDraft} recalc={recalc} finalize={finalize} reopen={reopen}/>}
 </div>;
}

function AssessmentModal(p:any){
 const {g,assessment:a,selected,student,evidence,runs,loading,teacher,editScore,setEditScore,note,setNote,busy,close,ensureDraft,recalc,finalize,reopen}=p;
 const dialogRef=useDialog(true,close);
 const v=shownScore(a);
 const canSeeEvidence=teacher||(selected.userId===g.me?.user_id&&a?.id?.startsWith('public-')===false);
 return <div className="gradeModalBack" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><article ref={dialogRef} tabIndex={-1} className="gradeModal" role="dialog" aria-modal="true" aria-labelledby="assessment-title">
  <header><div><small>ЭТАП {selected.stageNo}</small><h2 id="assessment-title">{student?.full_name||g.me?.full_name}</h2><p>{g.stages.find((s:any)=>s.stage_no===selected.stageNo)?.title}</p></div><IconAction onClick={close} label="Закрыть оценку"/></header>
  {!a?<div className="emptyState gradeEmpty">Черновик ещё не создан.{teacher&&<><br/><button className="primary" disabled={busy} onClick={()=>void ensureDraft()}>Рассчитать сейчас</button></>}</div>:<>
   <div className={'gradeScoreHero '+a.status}><strong>{v}</strong><div><b>{level(v??0)}</b><span>{a.status==='final'?'Итоговая оценка преподавателя':'Автоматический черновик'}</span></div></div>
{canSeeEvidence&&<>
   <div className="gradeCriteria"><span className={a.criterion_law?'ok':'miss'}><b>{a.criterion_law?'✓':'○'}</b> Право и правила</span><span className={a.criterion_strategy?'ok':'miss'}><b>{a.criterion_strategy?'✓':'○'}</b> Стратегия и интересы</span><span className={a.criterion_debrief?'ok':'miss'}><b>{a.criterion_debrief?'✓':'○'}</b> Анализ этапа</span></div>
   <section className="gradeRationale"><small>ИНТЕРПРЕТАЦИЯ ДЕЙСТВИЙ</small><p>{a.public_rationale}</p><footer><span>Пересчёт: {when(a.last_auto_at)}</span><span>{a.last_run_type}</span><span>версия {a.revision_count}</span></footer></section>
   {a.teacher_note&&<section className="gradeTeacherNote"><small>КОММЕНТАРИЙ ПРЕПОДАВАТЕЛЯ</small><p>{a.teacher_note}</p></section>}
</>}
   {teacher&&<section className="gradeApproval"><StyledSelect label="Итоговый балл" value={editScore===null?'':String(editScore)} onChange={v=>setEditScore(v===''?null:Number(v))} options={[{value:'',label:'Выберите итоговый балл'},...[0,1,2,3].map(n=>({value:String(n),label:n+' · '+level(n)}))]}/><label>Комментарий<textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="Почему вы подтверждаете или меняете автооценку"/></label><div>{a.status==='final'?<button onClick={()=>void reopen()} disabled={busy}>Переоткрыть оценку</button>:<><button onClick={()=>void recalc()} disabled={busy}>Пересчитать сейчас</button><button className="primary" onClick={()=>void finalize()} disabled={busy||!isFinalScore(editScore)}>Утвердить как итоговую</button></>}</div></section>}
  </>}
  {a&&runs?.length>0&&<details className="gradeRunHistory"><summary>История автоматических пересчётов <span>{runs.length}</span></summary><div>{runs.map((r:Run)=><article key={r.id}><time>{when(r.created_at)}</time><b>{r.auto_score}/3 · {level(r.auto_score)}</b><span>{r.run_type}</span><em>{r.criterion_law?'Право ✓':'Право ○'} · {r.criterion_strategy?'Стратегия ✓':'Стратегия ○'} · {r.criterion_debrief?'Анализ ✓':'Анализ ○'}</em></article>)}</div></details>}
  {canSeeEvidence&&<section className="gradeEvidence"><div className="gradeEvidenceHead"><div><small>ДОКАЗАТЕЛЬСТВА</small><h3>Все зафиксированные действия на этапе</h3></div></div>{loading?<div className="emptyState">Собираю данные…</div>:evidence?<Evidence evidence={evidence}/>:<div className="emptyState">Доказательства ещё не загружены.</div>}</section>}
  {!canSeeEvidence&&<div className="gradePrivacy">Подробные тексты и действия доступны только самому студенту и преподавателю.</div>}
 </article></div>;
}

function Evidence({evidence}:{evidence:Evidence}){
 const defs:[string,string,string][]=[['Чат и медиа','chat','text'],['Политический процесс','political_posts','body'],['Голосования','ballots','choice'],['НПА','formal_documents','body_text'],['Действия с НПА','formal_actions','note'],['Игровые документы','game_documents','body'],['Партийные документы','party_documents','note'],['Партийные действия','party_actions','status'],['Итоговый разбор','debrief','body'],['Активность','activity','label']];
 return <div className="gradeEvidenceGroups">{defs.map(([title,key,textKey])=>{const arr=(evidence[key]||[]) as any[];if(!arr.length)return null;return <details key={key} open={key==='debrief'||key==='formal_documents'}><summary>{title}<span>{arr.length}</span></summary><div>{arr.map((x,i)=><article key={x.id||i}><small>{when(x.created_at||x.submitted_at||x.updated_at)}</small><b>{x.title||x.channel||x.action||x.action_type||x.event_type||title}</b><p>{String(x[textKey]||x.text||x.label||x.file_name||x.kind||'').slice(0,3000)}</p>{x.weight!=null&&<em>Вес голоса: {x.weight}</em>}</article>)}</div></details>})}</div>;
}
