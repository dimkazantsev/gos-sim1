'use client';
import {useEffect,useState} from 'react';
import {CalendarDays,CheckCircle2,UsersRound,Vote as VoteIcon} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import StyledSelect from '../ui/StyledSelect';
import EventAutopilotPanel from './EventAutopilotPanel';
import EventComic from './EventComic';
type CaseRow={id:string;game_id:string;case_key:string;title:string;situation:string;category:string;seriousness:'serious'|'light';audience:'single'|'group'|'all';allowed_roles:string[];status:string;source_url:string|null;decision_options?:string[];effect_plan?:{options?:{key:string;trust:number;description?:string}[]};comic_scene?:Record<string,unknown>};
type Assignment={id:string;case_id:string;game_id:string;recipient_id:string;status:string};
type Decision={id:string;case_id:string;actor_id:string;choice:string};
type Outcome={case_id:string;winner:string;trust_delta:number;votes_count:number;assignments_count:number;media_post_id:string|null};
export default function EventWorkspace({g,readOnly=false,mode='feed'}:{g:ReturnTypeRepublic;readOnly?:boolean;mode?:'feed'|'manage'}){
 const {game,me,members,teacher}=g;
 const [cases,setCases]=useState<CaseRow[]>([]);
 const [assignments,setAssignments]=useState<Assignment[]>([]);
 const [decisions,setDecisions]=useState<Decision[]>([]);
 const [outcomes,setOutcomes]=useState<Outcome[]>([]);
 const [feedPerson,setFeedPerson]=useState('');
 const [feedRole,setFeedRole]=useState('');
 const [feedState,setFeedState]=useState('all');
 const [feedSort,setFeedSort]=useState('recent');
 const [title,setTitle]=useState('');
 const [situation,setSituation]=useState('');
 const [category,setCategory]=useState('Государственное управление');
 const [roleFilter,setRoleFilter]=useState('');
 const [decisionLabels,setDecisionLabels]=useState<'accept'|'yes'>('accept');
 const [seriousness,setSeriousness]=useState<'serious'|'light'>('serious');
 const [audience,setAudience]=useState<'single'|'group'|'all'>('single');
 const [selected,setSelected]=useState<string[]>([]);
 const [saving,setSaving]=useState(false);
 const [notice,setNotice]=useState('');
 const [busyId,setBusyId]=useState<string|null>(null);
 async function reload(){
  if(!game||!me)return;
  const [a,b,c,d]=await Promise.all([
   supabase.from('event_cases').select('*').eq('game_id',game.id).eq('status','ready').order('created_at',{ascending:false}).limit(300),
   supabase.from('event_assignments').select('*').eq('game_id',game.id),
   supabase.from('event_decisions').select('*').eq('game_id',game.id),
   supabase.from('event_case_outcomes').select('*').eq('game_id',game.id)
  ]);
  if(a.error){setNotice(a.error.message);return}
  setCases((a.data||[]) as CaseRow[]);
  if(!b.error)setAssignments((b.data||[]) as Assignment[]);
  if(!c.error)setDecisions((c.data||[]) as Decision[]);
  if(!d.error)setOutcomes((d.data||[]) as Outcome[]);
 }
 useEffect(()=>{
  if(!game?.id||!me?.user_id)return;
  void reload();
  const channel=supabase.channel('event-workspace:'+game.id+':'+me.user_id)
   .on('postgres_changes',{event:'*',schema:'public',table:'event_assignments',filter:'game_id=eq.'+game.id},()=>void reload())
   .on('postgres_changes',{event:'*',schema:'public',table:'event_decisions',filter:'game_id=eq.'+game.id},()=>void reload())
   .on('postgres_changes',{event:'*',schema:'public',table:'event_case_outcomes',filter:'game_id=eq.'+game.id},()=>void reload())
   .subscribe();
  return()=>{void supabase.removeChannel(channel)};
 },[game?.id,me?.user_id]);
 const students=members.filter(m=>m.kind==='student');
 const roles=[...new Set(students.map(m=>m.role_title?.trim()).filter((r):r is string=>!!r))].sort((a,b)=>a.localeCompare(b,'ru'));
 const recipients=roleFilter&&audience!=='all'?students.filter(m=>m.role_title===roleFilter):students;
 const mine=assignments.filter(a=>a.recipient_id===me?.user_id);
 const pending=mine.filter(a=>a.status==='pending');
 const eligible=audience==='all'?students.map(m=>m.user_id):selected;
 const canSend=title.trim().length>=6&&situation.trim().length>=20&&
  (audience==='all'?students.length>0:audience==='single'?selected.length===1:selected.length>=2&&selected.length<=3);
 async function create(){
  if(!game||!me||!teacher||saving||!canSend||readOnly)return;
  setSaving(true);setNotice('');
  const key='manual-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  const r=await supabase.from('event_cases').insert({
   game_id:game.id,case_key:key,title:title.trim(),situation:situation.trim(),category,
   seriousness,audience,allowed_roles:roleFilter?[roleFilter]:[],decision_options:decisionLabels==='yes'?['Да','Нет']:['Принять','Отклонить'],status:'ready',created_by:me.user_id
  }).select('id').single();
  if(r.error||!r.data){setNotice(r.error?.message||'Не удалось создать событие.');setSaving(false);return}
  const a=await supabase.from('event_assignments').insert(eligible.map(recipient_id=>({
   game_id:game.id,case_id:r.data.id,recipient_id,created_by:me.user_id
  })));
  if(a.error){await supabase.from('event_cases').delete().eq('id',r.data.id);setNotice(a.error.message)}
  else{setNotice('Событие направлено участникам: '+eligible.length);setTitle('');setSituation('');setSelected([]);await reload()}
  setSaving(false);
 }
 async function answer(assignment:Assignment,choice:string){
  if(busyId||readOnly)return;
  setBusyId(assignment.id);setNotice('');
  const r=await supabase.rpc('submit_event_decision',{p_assignment_id:assignment.id,p_choice:choice,p_rationale:null});
  if(r.error)setNotice(r.error.message);else await reload();
  setBusyId(null);
 }
 const assignedCaseIds=new Set(assignments.map(a=>a.case_id));
 function resolvedValue(d:Decision,c:CaseRow){
  const index=d.choice==='accept'?0:d.choice==='reject'?1:Number(d.choice.replace('option_',''))-1;
  return c.effect_plan?.options?.[index]?.trust??0;
 }
 const filteredCases=cases.filter(c=>{
  const casesAssignments=assignments.filter(a=>a.case_id===c.id);
  if(!assignedCaseIds.has(c.id))return false;
  if(!teacher&&!casesAssignments.some(a=>a.recipient_id===me?.user_id))return false;
  if(feedPerson&&!casesAssignments.some(a=>a.recipient_id===feedPerson))return false;
  if(feedRole&&!casesAssignments.some(a=>members.find(m=>m.user_id===a.recipient_id)?.role_title===feedRole))return false;
  const outcome=outcomes.find(o=>o.case_id===c.id);
  if(feedState==='resolved'&&!outcome)return false;
  if(feedState==='pending'&&outcome)return false;
  return true;
 }).sort((a,b)=>feedSort==='oldest'?a.title.localeCompare(b.title,'ru'):feedSort==='name'?a.title.localeCompare(b.title,'ru'):b.title.localeCompare(a.title,'ru'));

 const visibleCases=filteredCases;
 const seenAssignments=teacher?assignments:mine;
 const caseIds=new Set(seenAssignments.map(a=>a.case_id));
 const relevantDecisions=teacher?decisions:decisions.filter(d=>caseIds.has(d.case_id)&&d.actor_id===me?.user_id);
 const completedCount=seenAssignments.filter(a=>a.status!=='pending').length;
 const yesCount=relevantDecisions.filter(d=>d.choice==='accept').length;
 const noCount=relevantDecisions.filter(d=>d.choice==='reject').length;
 const ratio=(n:number,d:number)=>d?Math.round(100*n/d):0;
 const trust=g.metrics.find(m=>m.metric_key==='public_trust');
 if(!game||!me)return null;
 return <section className="eventWorkspace" aria-label="Event — ситуационные решения">
  <header><div><small>EVENT · ИГРОВЫЕ СИТУАЦИИ</small><h2>События и решения</h2><p>Индивидуальные задания, совместные решения 2–3 участников и общее голосование. Банк учебных ситуаций, автоматическое назначение, статистика ответов и влияние обработанных задач на доверие граждан.</p></div><span><CalendarDays size={17} aria-hidden="true"/>{teacher?visibleCases.length+' назначенных ситуаций':pending.length+' ожидают решения'}</span></header>
  <div className="eventDecisionOverview" aria-label="Статистика решений по игровым событиям">
   <article><small>Назначено заданий</small><strong>{seenAssignments.length}</strong><span>{teacher?'Всем участникам':'Вам'}</span></article>
   <article><small>Решено</small><strong>{completedCount}<em> / {seenAssignments.length}</em></strong><span>{ratio(completedCount,seenAssignments.length)}% заданий</span></article>
   <article><small>Да</small><strong>{yesCount}</strong><span>{ratio(yesCount,relevantDecisions.length)}% от ответов</span></article>
   <article><small>Нет</small><strong>{noCount}</strong><span>{ratio(noCount,relevantDecisions.length)}% от ответов</span></article>
   <article><small>Доверие граждан</small><strong>{trust?Number(trust.value).toFixed(1):'—'}<em> {trust?.unit||''}</em></strong><span>Текущий игровой показатель</span></article>
  </div>
  {mode==='manage'&&teacher&&<EventAutopilotPanel g={g} onChanged={reload}/>}
  {mode==='manage'&&teacher&&<div className="eventCatalogTargets" aria-label="План будущей библиотеки ситуаций">
   <div><strong>{cases.length}<span>/100</span></strong><small>Уникальных кейсов в текущей игре</small></div>
   <div><strong>{cases.filter(c=>c.seriousness==='serious').length}<span>/60</span></strong><small>Серьёзные · 60%</small></div>
   <div><strong>{cases.filter(c=>c.seriousness==='light').length}<span>/40</span></strong><small>Повседневные · 40%</small></div>
   <div><strong>{cases.filter(c=>c.audience==='all').length}<span>/5–6</span></strong><small>Для всей аудитории · 5%</small></div>
  </div>}
  {mode==='manage'&&teacher&&<div className="eventComposerPanel">
   <h3>Направить новое событие</h3>
   <div className="eventEditorGrid">
    <label>Название<input value={title} maxLength={180} onChange={e=>setTitle(e.target.value)} placeholder="Краткий заголовок ситуации"/></label>
    <StyledSelect label="Сфера" value={category} onChange={setCategory} options={['Государственное управление','Экономика','Международные отношения','Образование','Здравоохранение','Экология','Муниципальное управление','Культура и протокол','Социальная политика'].map(v=>({value:v,label:v}))}/>
    <StyledSelect label="Тип" value={seriousness} onChange={v=>setSeriousness(v as 'serious'|'light')} options={[{value:'serious',label:'Серьёзное'},{value:'light',label:'Повседневное / необычное'}]}/>
    <StyledSelect label="Роль получателя" value={roleFilter} onChange={v=>{setRoleFilter(v);setSelected([])}} options={[{value:'',label:'Любая должность'},...roles.map(v=>({value:v,label:v}))]}/>
    <StyledSelect label="Формат" value={audience} onChange={v=>{setAudience(v as 'single'|'group'|'all');setSelected([])}} options={[{value:'single',label:'Одному участнику'},{value:'group',label:'Совместно, 2–3 человека'},{value:'all',label:'Всем студентам'}]}/>
    <StyledSelect label="Варианты ответа" value={decisionLabels} onChange={v=>setDecisionLabels(v as typeof decisionLabels)}
      options={[{value:'accept',label:'Принять / Отклонить'},{value:'yes',label:'Да / Нет'}]}/>
    <label className="eventWide">Описание ситуации<textarea rows={4} value={situation} maxLength={5000} onChange={e=>setSituation(e.target.value)} placeholder="Какое решение нужно принять или отклонить?"/></label>
   </div>
   {audience!=='all'&&<div className="eventRecipients"><strong>Получатели · {selected.length}/{audience==='single'?1:3}</strong><div>{recipients.map(m=><label key={m.user_id}><input type="checkbox" checked={selected.includes(m.user_id)} disabled={!selected.includes(m.user_id)&&selected.length>=(audience==='single'?1:3)} onChange={e=>setSelected(old=>e.target.checked?[...old,m.user_id]:old.filter(x=>x!==m.user_id))}/>{m.full_name}<small>{m.role_title||'Студент'}</small></label>)}</div></div>}
   <footer><span>{audience==='all'?'Получатели: вся аудитория':'Выбрано: '+selected.length}</span><button type="button" onClick={()=>void create()} disabled={!canSend||saving||readOnly}>{saving?'Отправка…':'Назначить событие'}</button></footer>
  </div>}
  {mode==='feed'&&<div className="eventList"><header className="eventFeedHeader"><div><small>ЛЕНТА НАЗНАЧЕННЫХ СИТУАЦИЙ</small><h3>{teacher?'Решения участников':'Мои события'}</h3></div><span>{visibleCases.length} событий</span></header>
   {teacher&&<div className="eventFeedFilters">
    <StyledSelect label="Участник" value={feedPerson} onChange={setFeedPerson} options={[{value:'',label:'Все участники'},...students.map(m=>({value:m.user_id,label:m.full_name}))]}/>
    <StyledSelect label="Должность" value={feedRole} onChange={setFeedRole} options={[{value:'',label:'Все должности'},...roles.map(r=>({value:r,label:r}))]}/>
    <StyledSelect label="Состояние" value={feedState} onChange={setFeedState} options={[{value:'all',label:'Все события'},{value:'resolved',label:'Результат получен'},{value:'pending',label:'Ожидают решения'}]}/>
    <StyledSelect label="Сортировка" value={feedSort} onChange={setFeedSort} options={[{value:'recent',label:'По названию · Я–А'},{value:'name',label:'По названию · А–Я'}]}/>
   </div>}
   {visibleCases.length===0?<div className="journalEmpty">Назначенных ситуаций пока нет.</div>:
   visibleCases.map(c=>{
    const assigned=assignments.filter(a=>a.case_id===c.id),responded=decisions.filter(d=>d.case_id===c.id);
    const my=assigned.find(a=>a.recipient_id===me.user_id);
    const outcome=outcomes.find(o=>o.case_id===c.id);
    const mineAnswer=responded.find(d=>d.actor_id===me.user_id);
    const yes=responded.filter(d=>resolvedValue(d,c)>0||d.choice==='accept').length;
    const no=responded.filter(d=>resolvedValue(d,c)<0||d.choice==='reject').length;
    const labels=Array.isArray(c.decision_options)&&c.decision_options.length>=2?c.decision_options:['Принять','Отклонить'];
    const pct=(n:number,d:number)=>d?Math.round(n*100/d):0;
    const rejected=!!mineAnswer&&(resolvedValue(mineAnswer,c)<0||mineAnswer.choice==='reject');
    return <article key={c.id} className={'eventCaseCard eventStory '+(outcome?'eventStoryResolved ':'')+(rejected?'eventStoryRejected':'')}>
     <div className="eventStoryVisual"><EventComic title={c.title} category={c.category} caseKey={c.case_key} compact/></div>
     <div className="eventStoryContent">
      <div className="eventCaseTop"><span>{c.category}</span><span>{c.seriousness==='serious'?'Серьёзная':'Повседневная'} · {c.audience==='all'?'Все':c.audience==='group'?'Совместно':'Личная'}</span></div>
      <h4>{c.title}</h4><p>{c.situation.replace(/\\n/g,'\n')}</p>
      <div className="eventStoryRecipients">{assigned.map(a=><span key={a.id}>{members.find(m=>m.user_id===a.recipient_id)?.full_name||'Участник'} · {members.find(m=>m.user_id===a.recipient_id)?.role_title||'Без должности'}</span>)}</div>
      <div className="eventCaseFooter"><span><UsersRound size={15} aria-hidden="true"/>{assigned.length} назначено</span><span><CheckCircle2 size={15} aria-hidden="true"/>{responded.length} ответили · {pct(responded.length,assigned.length)}%</span>
        <span className="eventCaseTally">Да: {yes} ({pct(yes,responded.length)}%) · Нет: {no} ({pct(no,responded.length)}%){responded.length-yes-no>0?' · Иные: '+(responded.length-yes-no):''}</span>
      </div>
      {my?.status==='pending'&&!teacher&&<div className="eventOptionButtons" role="group" aria-label={'Решение по событию '+c.title}>
       {labels.map((label,i)=><button type="button" key={i} disabled={!!busyId||readOnly}
        onClick={()=>void answer(my,'option_'+(i+1))}><b>{String(i+1).padStart(2,'0')}</b>{label}</button>)}
      </div>}
      {mineAnswer&&!teacher&&<div className="eventOutcomeNote">Ваш голос: {labels[mineAnswer.choice==='accept'?0:mineAnswer.choice==='reject'?1:Math.max(0,Number(mineAnswer.choice.replace('option_',''))-1)]||'Учтён'}</div>}
      {outcome&&<div className="eventOutcomeNote final"><strong>Итог голосования: {outcome.winner==='tie'?'Равное число голосов':labels[outcome.winner==='accept'?0:outcome.winner==='reject'?1:Math.max(0,Number(outcome.winner.replace('option_',''))-1)]}</strong><span>Изменение доверия: {outcome.trust_delta>0?'+':''}{outcome.trust_delta} п.п. · Голосов: {outcome.votes_count}/{outcome.assignments_count}</span></div>}
      {teacher&&responded.length>0&&!outcome&&<button type="button" className="eventFinalize" onClick={async()=>{if(!window.confirm('Подвести итог по текущим ответам и завершить голосование досрочно?'))return;const r=await supabase.rpc('finalize_event_case',{p_case_id:c.id});setNotice(r.error?r.error.message:'Итог зафиксирован.');await reload()}}>Подвести итог по полученным голосам</button>}
     </div>
    </article>;
   })}</div>}
  {notice&&<p className="eventNotice" role="status">{notice}</p>}
 </section>;
}
