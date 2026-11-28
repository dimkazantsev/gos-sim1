'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import StageModuleHeader from '../ui/StageModuleHeader';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';
import {SURVEY_BLOCKS,SCALE,EXTRA_QUESTIONS,TIME_OPTIONS,MECHANIC_OPTIONS,DIFFICULTY_OPTIONS,QUESTION_TEXTS,emptyDraft,countWords,restoreDraft,validAnswer,toggleAnswer,describe,blockStats,type SurveyDraft,type SurveyRow,type Answer} from './finalSurveyModel';
import styles from './FinalSurvey.module.css';

const format=(v:number|null,d=2)=>v===null?'—':v.toLocaleString('ru-RU',{maximumFractionDigits:d});
const csvCell=(v:unknown)=>{let s=String(v??'');if(/^[\s]*[=+\-@]/u.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
const xml=(v:unknown)=>String(v??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function download(filename:string,mime:string,content:string){const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

function TeacherSurvey({g,rows,onRefresh,busy}:{g:ReturnTypeRepublic;rows:SurveyRow[];onRefresh:()=>void;busy:boolean}){
 const [role,setRole]=useState(''),[party,setParty]=useState(''),[group,setGroup]=useState('');
 const active=g.members.filter(m=>m.kind==='student'&&!m.roster_archived_at);
 const names=useMemo(()=>new Map(g.members.map(m=>[m.user_id,m.full_name])),[g.members]);
 const options=(key:'role_title'|'team'|'group_name')=>[...new Set(rows.map(r=>r[key]).filter((v):v is string=>!!v))].sort((a,b)=>a.localeCompare(b,'ru'));
 const filtered=useMemo(()=>rows.filter(r=>(!role||r.role_title===role)&&(!party||r.team===party)&&(!group||r.group_name===group)),[rows,role,party,group]);
 const submitted=new Set(rows.map(r=>r.user_id));
 const complete=active.filter(m=>submitted.has(m.user_id)).length;
 const indices=useMemo(()=>SURVEY_BLOCKS.map((_,i)=>blockStats(filtered,i)),[filtered]);
 const overall=describe(filtered.map(r=>r.answers[39]).filter((v):v is number=>typeof v==='number'&&v>=1&&v<=10));
 const stageLabels=g.stages.map(s=>({value:s.stage_no,label:s.stage_no+'. '+s.title}));
 const extraLabels=(i:number):{value:number;label:string}[]=>i===35?TIME_OPTIONS.map((label,value)=>({label:label||'Нет ответа (прежняя анкета)',value})):i===36?[{value:0,label:'Нет ответа (прежняя анкета)'},...stageLabels]:i===37?MECHANIC_OPTIONS.map((label,value)=>({label,value})):i===38?DIFFICULTY_OPTIONS.map((label,value)=>({label,value})):Array.from({length:10},(_,j)=>({value:j+1,label:String(j+1)}));
 function exportRows(kind:'csv'|'xml'){
  const headers=['Участник','Должность','Партия','Группа','Дата отправки',...QUESTION_TEXTS.map((q,i)=>(i+1)+'. '+q),'Количество слов','Предложения'];
  const data=filtered.map(r=>[names.get(r.user_id)||r.user_id,r.role_title||'',r.team||'',r.group_name||'',r.submitted_at,...r.answers.map((v,i)=>i<35?v===0?'':v:Array.isArray(v)?v.map(x=>extraLabels(i).find(o=>o.value===x)?.label??String(x)).join(' | '):extraLabels(i).find(o=>o.value===v)?.label??String(v??'')),r.word_count,r.proposal]);
  const all=[headers,...data];
  if(kind==='csv')download('ГОС.ID-анкеты.csv','text/csv;charset=utf-8','\ufeff'+all.map(row=>row.map(csvCell).join(';')).join('\r\n'));
  else download('ГОС.ID-анкеты.xml','application/vnd.ms-excel;charset=utf-8','<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Анкеты"><Table>'+all.map(row=>'<Row>'+row.map(v=>'<Cell><Data ss:Type="'+(typeof v==='number'?'Number':'String')+'">'+xml(v)+'</Data></Cell>').join('')+'</Row>').join('')+'</Table></Worksheet></Workbook>');
 }
 return <section className="debriefTeacher">
  <div className="debriefTeacherHead"><div><small>ПАНЕЛЬ ПРЕПОДАВАТЕЛЯ</small><h3>Результаты анкетирования</h3></div><span>{complete}/{active.length} сдали</span></div>
  <div className={styles.toolbar}><label>Должность<select value={role} onChange={e=>setRole(e.target.value)}><option value="">Все</option>{options('role_title').map(v=><option key={v}>{v}</option>)}</select></label><label>Партия<select value={party} onChange={e=>setParty(e.target.value)}><option value="">Все</option>{options('team').map(v=><option key={v}>{v}</option>)}</select></label><label>Учебная группа<select value={group} onChange={e=>setGroup(e.target.value)}><option value="">Все</option>{options('group_name').map(v=><option key={v}>{v}</option>)}</select></label><button type="button" className="secondary" disabled={busy} onClick={onRefresh}>Обновить</button></div>
  <div className="debriefEvidence"><article><small>ОТВЕТОВ В ВЫБОРКЕ</small><strong>{filtered.length}</strong></article><article><small>ОБЩАЯ ОЦЕНКА / 10</small><strong>{format(overall.mean)}</strong></article><article><small>СЛОВ В ПРЕДЛОЖЕНИЯХ</small><strong>{filtered.reduce((s,r)=>s+r.word_count,0)}</strong></article></div>
  <p>Индексы рассчитываются при наличии не менее трёх содержательных ответов из пяти. Пропущенные ответы прежней анкеты исключены. Альфа Кронбаха рассчитывается по полным ответам; малые выборки дают нестабильные оценки.</p>
  <div className={styles.tableWrap}><table><thead><tr><th>Индекс</th><th>n</th><th>Среднее / 5</th><th>Медиана</th><th>Ст. откл.</th><th>Альфа (n)</th></tr></thead><tbody>{indices.map((v,i)=><tr key={i}><th>{SURVEY_BLOCKS[i].title}</th><td>{v.n}</td><td>{format(v.mean)}</td><td>{format(v.median)}</td><td>{format(v.sd)}</td><td>{format(v.alpha)} ({v.alphaN})</td></tr>)}</tbody></table></div>
  <details><summary>Распределения ответов по вопросам</summary><div className={styles.tableWrap}><table><thead><tr><th>Утверждение</th>{[1,2,3,4,5,0].map(n=><th key={n}>{n||'—'}</th>)}</tr></thead><tbody>{QUESTION_TEXTS.slice(0,35).map((q,i)=><tr key={i}><th>{i+1}. {q}</th>{[1,2,3,4,5,0].map(n=><td key={n}>{filtered.filter(r=>r.answers[i]===n).length}</td>)}</tr>)}</tbody></table></div></details>
  <details><summary>Дополнительные исследовательские вопросы</summary>{EXTRA_QUESTIONS.map((q,j)=><section key={q} className={styles.extraResults}><h4>{j+36}. {q}</h4>{extraLabels(j+35).map(o=><div key={o.value}><span>{o.label}</span><strong>{filtered.filter(r=>{const a=r.answers[j+35];return Array.isArray(a)?a.includes(o.value):a===o.value}).length}</strong></div>)}</section>)}</details>
  <div className={styles.toolbar}><button type="button" className="secondary" disabled={!filtered.length} onClick={()=>exportRows('csv')}>Выгрузить CSV</button><button type="button" className="secondary" disabled={!filtered.length} onClick={()=>exportRows('xml')}>Выгрузить Excel (XML)</button></div>
  <h3>Предложения участников</h3><div className="reflectionStudentList">{filtered.map(r=><details key={r.user_id}><summary>{names.get(r.user_id)||'Участник'} · {r.word_count} слов</summary><p className={styles.proposal}>{r.proposal}</p></details>)}</div>
  <details><summary>Состояние заполнения анкеты</summary><div className="reflectionStudentList">{active.map(m=><article key={m.user_id}><header><div><b>{m.full_name}</b><span>{m.role_title||m.team||'Участник'}</span></div><strong>{submitted.has(m.user_id)?'Сдано':'Не сдано'}</strong></header></article>)}</div></details>
 </section>;
}

function Survey({g,readOnly}:{g:ReturnTypeRepublic;readOnly:boolean}){
 const gameId=g.game?.id||'',uid=g.me?.user_id||'',teacher=g.teacher,stage=g.stages.find(s=>s.stage_no===16);
 const key='gos-id:final-survey:1:'+gameId+':'+uid;
 const [draft,setDraft]=useState<SurveyDraft>(emptyDraft),[rows,setRows]=useState<SurveyRow[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false),[storageError,setStorageError]=useState(false);
 const request=useRef(0),saving=useRef(false);
 const allowed=teacher||g.me?.kind==='student';
 async function load(){
  if(!gameId||!uid||!allowed)return;
  const seq=++request.current;setBusy(true);setError('');
  let query=supabase.from('game_final_surveys').select('user_id,answers,proposal,word_count,role_title,team,group_name,submitted_at').eq('game_id',gameId);
  if(!teacher)query=query.eq('user_id',uid);
  const r=await query;
  if(seq!==request.current)return;
  setBusy(false);
  if(r.error){setError(userError(r.error));return}
  const data=(r.data||[]) as SurveyRow[];setRows(data);
  if(!teacher){setSent(data.length>0);if(data.length){try{localStorage.removeItem(key)}catch{}}}
  setLoaded(true);
 }
 useEffect(()=>{if(!teacher&&allowed){try{setDraft(restoreDraft(localStorage.getItem(key)))}catch{setStorageError(true)}}void load();return()=>{request.current++}},[gameId,uid,teacher]);
 function change(next:SurveyDraft){setDraft(next);if(!readOnly){try{localStorage.setItem(key,JSON.stringify(next))}catch{setStorageError(true)}}}
 function choose(i:number,a:Answer){const answers=[...draft.answers];answers[i]=a;change({...draft,answers})}
 const section=draft.section,words=countWords(draft.proposal),answered=draft.answers.filter((a,i)=>validAnswer(i,a)).length;
 const isComplete=answered===40&&words>=300;
 const sectionReady=section<7?draft.answers.slice(section*5,section*5+5).every((a,i)=>validAnswer(section*5+i,a)):section===7?draft.answers.slice(35).every((a,i)=>validAnswer(35+i,a)):isComplete;
 const writable=loaded&&!busy&&!readOnly&&!sent&&stage?.status==='open';
 async function submit(){
  if(!writable||!isComplete||saving.current)return;
  saving.current=true;setBusy(true);setError('');
  try{const r=await supabase.rpc('submit_game_final_survey',{p_game_id:gameId,p_answers:draft.answers,p_proposal:draft.proposal});if(r.error){setError(userError(r.error));return}setSent(true);try{localStorage.removeItem(key)}catch{}}
  finally{saving.current=false;setBusy(false)}
 }
 function options(i:number,labels:{value:number;label:string}[],multi=false){
  return <div className={styles.options} role={multi?'group':'radiogroup'} aria-labelledby={'survey-question-'+i}>{labels.map(o=><label key={o.value} className={'civicBallotMode '+styles.option}><input type={multi?'checkbox':'radio'} name={'survey-'+i} checked={multi?Array.isArray(draft.answers[i])&&(draft.answers[i] as number[]).includes(o.value):draft.answers[i]===o.value} disabled={!writable} onChange={()=>choose(i,multi?toggleAnswer(draft.answers[i],o.value):o.value)}/><span><strong>{o.label}</strong></span></label>)}</div>;
 }
 function rating(i:number){
  const chosen=validAnswer(i,draft.answers[i]),value=chosen?Number(draft.answers[i]):3;
  return <div className={styles.rating} data-answered={chosen}>
   <div className={styles.ratingHeader}><span>{chosen?SCALE[value]:'Выберите оценку'}</span><strong aria-live="polite">{chosen?value+' / 5':'— / 5'}</strong></div>
   <div className={styles.ratingControl}>
    <input className={styles.ratingInput} type="range" min={1} max={5} step={1} value={value} disabled={!writable} aria-labelledby={'survey-question-'+i} aria-valuetext={chosen?value+' — '+SCALE[value]:'Оценка не выбрана. Выберите значение от 1 до 5.'} onChange={e=>choose(i,e.currentTarget.valueAsNumber)} onPointerUp={e=>{if(writable&&e.pointerType!=='touch'&&e.button!==0)return;if(writable&&!chosen)choose(i,e.currentTarget.valueAsNumber)}} onKeyDown={e=>{if(writable&&(e.key==='Enter'||e.key===' ')){e.preventDefault();choose(i,value)}}}/>
    <div className={styles.ratingTicks}>{[1,2,3,4,5].map(n=><button type="button" key={n} aria-label={n+' — '+SCALE[n]} aria-pressed={chosen&&value===n} disabled={!writable} onClick={()=>choose(i,n)}>{n}</button>)}</div>
   </div>
   <div className={styles.ratingEnds}><span>Полностью не согласен</span><span>Полностью согласен</span></div>
  </div>;
 }
 const labels=(a:string[])=>a.map((label,value)=>({value,label})).filter(o=>o.label);
 if(!allowed)return null;
 return <section className="debriefLab"><StageModuleHeader eyebrow="Этап 16 · Итоговое анкетирование" title="Оценка игры и обратная связь" description="Оцените образовательный опыт участия в ГОС.ID. Содержание ответов не влияет на начисленные баллы. Ответы доступны преподавателю и самому участнику." stats={[{label:teacher?'Анкет получено':'Ответы на вопросы',value:teacher?rows.length:sent?'40 / 40':answered+' / 40'}]}/>
 {error&&<p role="alert" className="reflectionFeedback">{error} <button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>Обновить</button></p>}
 {!loaded&&!error&&<p role="status">Загрузка анкеты…</p>}
 {loaded&&teacher&&<TeacherSurvey g={g} rows={rows} busy={busy} onRefresh={()=>void load()}/>}
 {loaded&&!teacher&&(sent?<article className={'civicBallotModern '+styles.form}><h3>Анкета отправлена</h3><p>Благодарим за участие. Ответы и предложения сохранены.</p></article>:<article className={'civicBallotModern '+styles.form}>
  <div className={styles.progress}><span>Раздел {section+1} из 9</span><strong>{answered} / 40</strong></div><progress className={styles.progressBar} max={40} value={answered} aria-label="Количество заполненных вопросов"/>
  {storageError&&<p role="status">Локальное сохранение недоступно. Не закрывайте страницу до отправки.</p>}
  {!writable&&<p>Заполнение доступно участникам на открытом этапе 16.</p>}
  {section<7&&<><h3>{SURVEY_BLOCKS[section].title}</h3>{SURVEY_BLOCKS[section].questions.map((q,j)=>{const i=section*5+j;return <section className={styles.question} key={i} aria-labelledby={'survey-question-'+i}><h4 id={'survey-question-'+i} className={styles.questionHeading}><span className={styles.questionNumber}>{i+1}</span><span>{q}</span></h4>{rating(i)}</section>})}</>}
  {section===7&&<><h3>Дополнительные исследовательские вопросы</h3>{EXTRA_QUESTIONS.map((q,j)=>{const i=j+35;const choices=j===0?labels(TIME_OPTIONS):j===1?g.stages.map(s=>({value:s.stage_no,label:s.stage_no+'. '+s.title})):j===2?labels(MECHANIC_OPTIONS):j===3?labels(DIFFICULTY_OPTIONS):Array.from({length:10},(_,k)=>({value:k+1,label:String(k+1)}));return <section className={styles.question} key={i} aria-labelledby={'survey-question-'+i}><h4 id={'survey-question-'+i} className={styles.questionHeading}><span className={styles.questionNumber}>{i+1}</span><span>{q}</span></h4>{j===4&&<p>1 — крайне низкая оценка; 10 — максимально высокая.</p>}{options(i,choices,j>=1&&j<=3)}</section>})}</>}
  {section===8&&<><h3>Предложения по совершенствованию ГОС.ID</h3><p>На основании собственного опыта участия в деловой игре сформулируйте аргументированные предложения по совершенствованию её организационной модели, институционального устройства, игровых механик, системы оценивания и цифровой платформы.</p><p>Обозначьте выявленные проблемы, предложите способы их решения, обоснуйте целесообразность предлагаемых изменений и охарактеризуйте ожидаемый образовательный эффект.</p><label className={styles.essay}>Минимальный объём — 300 слов<textarea rows={10} maxLength={40000} disabled={!writable} value={draft.proposal} onChange={e=>change({...draft,proposal:e.target.value})} placeholder="Ваши предложения по совершенствованию игры…"/></label><div className={styles.progress}><strong role="status">Количество слов: {words}</strong><span>{words>=300?'Минимальный объём достигнут':'Осталось '+(300-words)+' слов'}</span></div><progress className={styles.progressBar} max={300} value={Math.min(300,words)} aria-label="Объём предложения"/></>}
  <footer className={styles.toolbar}><button type="button" className="secondary" disabled={section===0||busy} onClick={()=>change({...draft,section:section-1})}>Назад</button>{section<8?<button type="button" className="primary" disabled={!sectionReady||busy} onClick={()=>change({...draft,section:section+1})}>Далее</button>:<button type="button" className="primary" disabled={!writable||!isComplete} onClick={()=>void submit()}>Отправить анкету</button>}</footer>
 </article>)}
 </section>;
}
export default function SystemDebriefLab({g,readOnly=false}:{g:ReturnTypeRepublic;readOnly?:boolean}){
 if(!g.game||!g.me||g.me.kind==='observer')return null;
 return <Survey key={g.game.id+':'+g.me.user_id+':'+g.teacher} g={g} readOnly={readOnly}/>;
}
