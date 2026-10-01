'use client';
import {useEffect,useState} from 'react';
import {CalendarDays,CheckCircle2,Send,UsersRound} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import StyledSelect from '../ui/StyledSelect';
import DisclosureSummary from '../ui/DisclosureSummary';
import EventCollaboration,{type EventInvitation} from './EventCollaboration';
import {eventButtonSound} from './eventButtonSound';
import EventAutopilotPanel from './EventAutopilotPanel';
import EventComic from './EventComic';
import EventChoicePanel from './EventChoicePanel';
import EventDecisionFeedback from './EventDecisionFeedback';
import EventCaseTile from './EventCaseTile';
import EventCaseModal from './EventCaseModal';
import type {EventComicScene} from './types';
type CaseRow={id:string;game_id:string;case_key:string;title:string;situation:string;category:string;seriousness:'serious'|'light';audience:'single'|'group'|'all';allowed_roles:string[];status:string;source_url:string|null;decision_options?:string[];effect_plan?:{options?:{key:string;trust:number;description?:string}[]};comic_scene?:EventComicScene};
type Assignment={id:string;case_id:string;game_id:string;recipient_id:string;status:string;created_at:string};
type Decision={id:string;case_id:string;actor_id:string;choice:string;role_snapshot?:string};
type Authority={decision_id:string;case_id:string;actor_id:string;authority_ok:boolean;lawful:boolean;strategy_point:boolean;role_snapshot:string;legal_basis:string};
type Outcome={case_id:string;winner:string;trust_delta:number;votes_count:number;assignments_count:number;media_post_id:string|null;requested_trust_delta?:number;resolution_kind?:string};
export default function EventWorkspace({g,readOnly=false,mode='feed'}:{g:ReturnTypeRepublic;readOnly?:boolean;mode?:'feed'|'manage'}){
 const {game,me,members,teacher}=g;
 const [invitations,setInvitations]=useState<EventInvitation[]>([]);
 const [authority,setAuthority]=useState<Authority[]>([]);
 const [expanded,setExpanded]=useState('');
 const [legalFilter,setLegalFilter]=useState('all');
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
 const [options,setOptions]=useState([{label:'',trust:2,description:''},{label:'',trust:0,description:''},{label:'',trust:-2,description:''}]);
 const [seriousness,setSeriousness]=useState<'serious'|'light'>('serious');
 const [audience,setAudience]=useState<'single'|'group'|'all'>('single');
 const [selected,setSelected]=useState<string[]>([]);
 const [saving,setSaving]=useState(false);
 const [notice,setNotice]=useState('');
 const [busyId,setBusyId]=useState<string|null>(null);
 async function reload(){
  if(!game||!me)return;
  const [a,b,c,d,e,f]=await Promise.all([
   supabase.from('event_cases').select('*').eq('game_id',game.id).order('created_at',{ascending:false}).limit(1000),
   supabase.from('event_assignments').select('*').eq('game_id',game.id),
   supabase.from('event_decisions').select('*').eq('game_id',game.id),
   supabase.from('event_case_outcomes').select('*').eq('game_id',game.id),
   supabase.from('event_collaboration_invites').select('*').eq('game_id',game.id),
   supabase.from('event_authority_evidence').select('*').eq('game_id',game.id)
  ]);
  const error=[a,b,c,d,e,f].find(r=>r.error)?.error;
  if(error){setNotice(error.message);return}
  setInvitations((e.data||[]) as EventInvitation[]);setAuthority((f.data||[]) as Authority[]);
  setCases((a.data||[]) as CaseRow[]);
  if(!b.error)setAssignments((b.data||[]) as Assignment[]);
  if(!c.error)setDecisions((c.data||[]) as Decision[]);
  if(!d.error)setOutcomes((d.data||[]) as Outcome[]);
 }
 useEffect(()=>{
  if(!game?.id||!me?.user_id)return;
  void reload();
  const poll=setInterval(()=>void reload(),5000);
  const channel=supabase.channel('event-workspace:'+game.id+':'+me.user_id)
   .on('postgres_changes',{event:'*',schema:'public',table:'event_cases',filter:'game_id=eq.'+game.id},()=>void reload())
   .on('postgres_changes',{event:'*',schema:'public',table:'event_assignments',filter:'game_id=eq.'+game.id},()=>void reload())
   .on('postgres_changes',{event:'*',schema:'public',table:'event_decisions',filter:'game_id=eq.'+game.id},()=>void reload())
   .on('postgres_changes',{event:'*',schema:'public',table:'event_case_outcomes',filter:'game_id=eq.'+game.id},()=>void reload())
   .subscribe();
  return()=>{clearInterval(poll);void supabase.removeChannel(channel)};
 },[game?.id,me?.user_id]);
 const students=members.filter(m=>m.kind==='student');
 const roles=[...new Set(students.map(m=>m.role_title?.trim()).filter((r):r is string=>!!r))].sort((a,b)=>a.localeCompare(b,'ru'));
 const recipients=roleFilter&&audience!=='all'?students.filter(m=>m.role_title===roleFilter):students;
 const mine=assignments.filter(a=>a.recipient_id===me?.user_id);
 const readyCases=cases.filter(c=>c.status==='ready');
 const eligible=audience==='all'?students.map(m=>m.user_id):selected;
 const canSend=title.trim().length>=6&&situation.trim().length>=20&&options.every(o=>o.label.trim().length>=2&&o.description.trim().length>=5&&Number.isFinite(o.trust))&&new Set(options.map(o=>o.label.trim().toLowerCase())).size===options.length&&
  (audience==='all'?students.length>0:audience==='single'?selected.length===1:selected.length>=2&&selected.length<=3);
 async function create(){
  if(!game||!me||!teacher||saving||!canSend||readOnly)return;
  setSaving(true);setNotice('');
  const r=await supabase.rpc('create_assigned_event',{
   p_game_id:game.id,p_title:title.trim(),p_situation:situation.trim(),p_category:category,
   p_seriousness:seriousness,p_audience:audience,p_options:options,p_recipients:eligible,p_roles:roleFilter?[roleFilter]:[]
  });
  if(r.error)setNotice(r.error.message);
  else{setNotice('Событие направлено участникам: '+eligible.length);setTitle('');setSituation('');setSelected([]);setOptions([{label:'',trust:2,description:''},{label:'',trust:0,description:''},{label:'',trust:-2,description:''}]);await reload()}
  setSaving(false);
 }
 async function answer(assignment:Assignment,choice:string){
  if(busyId||readOnly||me?.kind!=='student')return;
  eventButtonSound();setBusyId(assignment.id);setNotice('');
  const r=await supabase.rpc('submit_event_decision',{p_assignment_id:assignment.id,p_choice:choice,p_rationale:null});
  if(r.error)setNotice(r.error.message);else await Promise.all([reload(),g.refresh()]);
  setBusyId(null);
 }
 const assignedCaseIds=new Set(assignments.map(a=>a.case_id));
 function resolvedValue(d:Decision,c:CaseRow){
  const index=d.choice==='accept'?0:d.choice==='reject'?1:Number(d.choice.replace('option_',''))-1;
  return c.effect_plan?.options?.[index]?.trust??0;
 }
 const filteredCases=cases.filter(c=>{
  const casesAssignments=assignments.filter(a=>a.case_id===c.id);
  if(!assignedCaseIds.has(c.id)&&!(teacher&&c.status==='ready'))return false;
  if(!teacher&&me?.kind!=='observer'&&!casesAssignments.some(a=>a.recipient_id===me?.user_id)&&!invitations.some(i=>i.case_id===c.id&&i.recipient_id===me?.user_id&&i.status==='pending'))return false;
  if(feedPerson&&!casesAssignments.some(a=>a.recipient_id===feedPerson))return false;
  if(feedRole&&!casesAssignments.some(a=>members.find(m=>m.user_id===a.recipient_id)?.role_title===feedRole))return false;
  if(legalFilter!=='all'&&!authority.some(a=>a.case_id===c.id&&(!feedPerson||a.actor_id===feedPerson)&&(legalFilter==='valid'?(a.authority_ok&&a.lawful):(!a.authority_ok||!a.lawful))))return false;
  const outcome=outcomes.find(o=>o.case_id===c.id);
  if(feedState==='resolved'&&!outcome)return false;
  if(feedState==='pending'&&outcome)return false;
  return true;
 }).sort((a,b)=>{
  if(feedSort==='name')return a.title.localeCompare(b.title,'ru');
  const assignedAt=(id:string)=>Math.max(0,...assignments.filter(x=>x.case_id===id).map(x=>Date.parse(x.created_at)||0));
  return feedSort==='oldest'?assignedAt(a.id)-assignedAt(b.id):assignedAt(b.id)-assignedAt(a.id);
 });

 const visibleCases=filteredCases;
 const seenAssignments=teacher?assignments:mine;
 const caseIds=new Set(seenAssignments.map(a=>a.case_id));
 const relevantDecisions=teacher?decisions:decisions.filter(d=>caseIds.has(d.case_id)&&d.actor_id===me?.user_id);
 const completedCount=relevantDecisions.length;
 const effect=(d:Decision)=>{const c=cases.find(c=>c.id===d.case_id);return c?resolvedValue(d,c):0};
 const yesCount=relevantDecisions.filter(d=>effect(d)>0).length;
 const noCount=relevantDecisions.filter(d=>effect(d)<0).length;
 const neutralCount=relevantDecisions.length-yesCount-noCount;
 const ratio=(n:number,d:number)=>d?Math.round(100*n/d):0;
 async function finalize(id:string){
  if(!teacher||busyId||!window.confirm('Подвести итог по текущим ответам и завершить голосование досрочно?'))return;
  setBusyId(id);const r=await supabase.rpc('finalize_event_case',{p_case_id:id});
  setNotice(r.error?r.error.message:r.data?.reason==='no_answers'?'Пока нет голосов.':'Итог зафиксирован.');
  if(!r.error)await Promise.all([reload(),g.refresh()]);setBusyId(null);
 }
 if(!game||!me)return null;
 return <section className="eventWorkspace" aria-label="Event — ситуационные решения">
  <header><div><small>EVENT · ИГРОВЫЕ СИТУАЦИИ</small><h2>События и решения</h2><p>Индивидуальные задания, совместные решения 2–3 участников и общее голосование. После решения здесь видны голоса по каждому варианту, последствия и итоговое изменение доверия.</p></div><span><CalendarDays size={17} aria-hidden="true"/>{teacher?'Назначенные ситуации':me.kind==='observer'?'Гостевой просмотр':'Ваши задания'}</span></header>
  {mode==='manage'&&teacher&&<div className="eventDecisionOverview" aria-label="Статистика решений по игровым событиям">
   <article><small>Назначено заданий</small><strong>{seenAssignments.length}</strong><span>{teacher?'Всем участникам':'Вам'}</span></article>
   <article><small>Решено</small><strong>{completedCount}<em> / {seenAssignments.length}</em></strong><span>{ratio(completedCount,seenAssignments.length)}% заданий</span></article>
   <article><small>В интересах общества</small><strong>{yesCount}</strong><span>{ratio(yesCount,relevantDecisions.length)}% от ответов</span></article>
   <article><small>Негативные последствия</small><strong>{noCount}</strong><span>{ratio(noCount,relevantDecisions.length)}% от ответов</span></article>
   <article><small>Нейтральные решения</small><strong>{neutralCount}</strong><span>{ratio(neutralCount,relevantDecisions.length)}% от ответов</span></article>
  </div>}
  {mode==='manage'&&teacher&&<EventAutopilotPanel g={g} onChanged={reload}/>}
  {mode==='manage'&&teacher&&<div className="eventCatalogTargets" aria-label="План будущей библиотеки ситуаций">
   <div><strong>{readyCases.length}</strong><small>Уникальных кейсов в текущей игре</small></div>
   <div><strong>{readyCases.filter(c=>c.seriousness==='serious').length}</strong><small>Серьёзные ситуации</small></div>
   <div><strong>{readyCases.filter(c=>c.seriousness==='light').length}</strong><small>Повседневные ситуации</small></div>
   <div><strong>{readyCases.filter(c=>c.case_key.startsWith('bank-curated-v2-')).length}<span>/50</span></strong><small>Новая авторская итерация</small></div>
  </div>}
  {mode==='manage'&&teacher&&<details className="eventComposerPanel civicDisclosure projectDisclosure">
   <DisclosureSummary icon={Send} title="Направить событие…" description="Ситуация, варианты решения и участники"/><div className="civicDisclosureBody">
   <div className="eventEditorGrid">
    <label>Название<input value={title} maxLength={180} onChange={e=>setTitle(e.target.value)} placeholder="Краткий заголовок ситуации"/></label>
    <StyledSelect label="Сфера" value={category} onChange={setCategory} options={['Государственное управление','Экономика','Международные отношения','Образование','Здравоохранение','Экология','Муниципальное управление','Культура и протокол','Социальная политика'].map(v=>({value:v,label:v}))}/>
    <StyledSelect label="Тип" value={seriousness} onChange={v=>setSeriousness(v as 'serious'|'light')} options={[{value:'serious',label:'Серьёзное'},{value:'light',label:'Повседневное / необычное'}]}/>
    <StyledSelect label="Роль получателя" value={roleFilter} onChange={v=>{setRoleFilter(v);setSelected([])}} options={[{value:'',label:'Любая должность'},...roles.map(v=>({value:v,label:v}))]}/>
    <StyledSelect label="Формат" value={audience} onChange={v=>{setAudience(v as 'single'|'group'|'all');setSelected([])}} options={[{value:'single',label:'Одному участнику'},{value:'group',label:'Совместно, 2–3 человека'},{value:'all',label:'Всем студентам'}]}/>
    <label className="eventWide">Описание ситуации<textarea rows={4} value={situation} maxLength={5000} onChange={e=>setSituation(e.target.value)} placeholder="Какое решение нужно принять или отклонить?"/></label>
   </div>
   <div className="eventChoiceEditor"><h4>Варианты и последствия · От 2 до 6</h4>{options.map((o,i)=><article key={i}>
    <label>Вариант {i+1}<input value={o.label} maxLength={500} onChange={e=>setOptions(old=>old.map((v,j)=>j===i?{...v,label:e.target.value}:v))} placeholder="Содержательное решение"/></label>
    <label>Доверие, п.п.<input type="number" min={-100} max={100} step="0.5" value={o.trust} onChange={e=>setOptions(old=>old.map((v,j)=>j===i?{...v,trust:e.target.valueAsNumber}:v))}/></label>
    <button type="button" disabled={options.length<=2} onClick={()=>setOptions(old=>old.filter((_,j)=>j!==i))}>Удалить вариант</button>
    <label className="eventChoiceDescription">Последствия решения<textarea rows={2} value={o.description} maxLength={2000} onChange={e=>setOptions(old=>old.map((v,j)=>j===i?{...v,description:e.target.value}:v))} placeholder="Что изменится после этого решения?"/></label>
   </article>)}<button type="button" disabled={options.length>=6} onClick={()=>setOptions(old=>[...old,{label:'',trust:0,description:''}])}>Добавить вариант</button></div>
   {audience!=='all'&&<div className="eventRecipients"><strong>Получатели · {selected.length}/{audience==='single'?1:3}</strong><div>{recipients.map(m=><label key={m.user_id}><input type="checkbox" checked={selected.includes(m.user_id)} disabled={!selected.includes(m.user_id)&&selected.length>=(audience==='single'?1:3)} onChange={e=>setSelected(old=>e.target.checked?[...old,m.user_id]:old.filter(x=>x!==m.user_id))}/>{m.full_name}<small>{m.role_title||'Студент'}</small></label>)}</div></div>}
   <footer><span>{audience==='all'?'Получатели: вся аудитория':'Выбрано: '+selected.length}</span><button type="button" onClick={()=>void create()} disabled={!canSend||saving||readOnly}>{saving?'Отправка…':'Назначить событие'}</button></footer>
  </div></details>}
  {<div className="eventList"><header className="eventFeedHeader"><div><small>ЛЕНТА НАЗНАЧЕННЫХ СИТУАЦИЙ</small><h3>{teacher||me.kind==='observer'?'Решения участников':'Мои события'}</h3></div><span>{visibleCases.length} событий</span></header>
   {<div className="eventFeedFilters">
    <StyledSelect label="Участник" value={feedPerson} onChange={setFeedPerson} options={[{value:'',label:'Все участники'},...students.map(m=>({value:m.user_id,label:m.full_name}))]}/>
    <StyledSelect label="Должность" value={feedRole} onChange={setFeedRole} options={[{value:'',label:'Все должности'},...roles.map(r=>({value:r,label:r}))]}/>
    <StyledSelect label="Состояние" value={feedState} onChange={setFeedState} options={[{value:'all',label:'Все события'},{value:'resolved',label:'Результат получен'},{value:'pending',label:'Ожидают решения'}]}/>
    <StyledSelect label="Сортировка" value={feedSort} onChange={setFeedSort} options={[{value:'recent',label:'Сначала новые назначения'},{value:'oldest',label:'Сначала старые назначения'},{value:'name',label:'По названию · А–Я'}]}/>
   </div>}
   {teacher&&<StyledSelect label="Правовая оценка" value={legalFilter} onChange={setLegalFilter} options={[{value:'all',label:'Все решения'},{value:'valid',label:'В пределах полномочий'},{value:'invalid',label:'Нарушения полномочий или права'}]}/>}
   {visibleCases.length===0?<div className="journalEmpty">Назначенных ситуаций пока нет.</div>:
   <div className="eventTileGrid" aria-label="Карточки ситуаций">{visibleCases.map(c=>{
    const assigned=assignments.filter(a=>a.case_id===c.id),responded=decisions.filter(d=>d.case_id===c.id);
    const closed=outcomes.some(o=>o.case_id===c.id),invited=invitations.some(i=>i.case_id===c.id&&i.recipient_id===me.user_id&&i.status==='pending');
    return <EventCaseTile key={c.id} item={c} meta={invited?'Приглашение к решению':closed?'Решено · '+responded.length+' ответов':assigned.length?'Ожидает решения · '+responded.length+'/'+assigned.length:'Можно назначить'} onClick={()=>setExpanded(c.id)}/>;
   })}</div>}</div>}
  {expanded&&cases.filter(c=>c.id===expanded).map(c=>{
    const assigned=assignments.filter(a=>a.case_id===c.id),responded=decisions.filter(d=>d.case_id===c.id);
    const my=assigned.find(a=>a.recipient_id===me.user_id);
    const outcome=outcomes.find(o=>o.case_id===c.id);
    const mineAnswer=responded.find(d=>d.actor_id===me.user_id);
    const labels=Array.isArray(c.decision_options)&&c.decision_options.length>=2?c.decision_options:['Принять','Отклонить'];
    const pct=(n:number,d:number)=>d?Math.round(n*100/d):0;
    const winnerIndex=outcome?.winner==='accept'?0:outcome?.winner==='reject'?1:Number(outcome?.winner.replace('option_',''))-1;
    const chosenEffect=outcome&&winnerIndex>=0?c.effect_plan?.options?.[winnerIndex]:null;
    const kind=outcome?.resolution_kind||(outcome?(Number(chosenEffect?.trust)>0?'beneficial':Number(chosenEffect?.trust)<0?'harmful':'neutral'):'pending');
    const expandedCase=true;
    const invites=invitations.filter(i=>i.case_id===c.id);
    const pendingInvites=invites.some(i=>i.status==='pending');
    return <EventCaseModal key={c.id} title={c.title} onClose={()=>setExpanded('')}><div className="eventCaseBundle"><article className={'eventCaseCard eventStory '+(kind==='beneficial'?'eventStoryResolved ':kind==='harmful'?'eventStoryRejected ':outcome?'eventStoryNeutral ':'')}>
     <div className="eventStoryVisual"><EventComic silent title={c.title} category={c.category} caseKey={c.case_key} scene={c.comic_scene} compact/></div>
     <div className="eventStoryContent">
      {teacher&&<div className="eventCaseTop"><span>{c.category}</span><span>{c.seriousness==='serious'?'Серьёзная':'Повседневная'} · {invites.some(i=>i.status==='accepted')?'Совместно':c.audience==='all'?'Все':c.audience==='group'?'Совместно':'Личная'}</span></div>}
      <h4>{c.title}</h4>{expandedCase&&<><p>{c.situation.replace(/\\n/g,'\n')}</p>
      <div className="eventStoryRecipients">{assigned.map(a=><span key={a.id}>{members.find(m=>m.user_id===a.recipient_id)?.full_name||'Участник'} · {members.find(m=>m.user_id===a.recipient_id)?.role_title||'Без должности'}</span>)}</div>
      <div className="eventCaseFooter"><span><UsersRound size={15} aria-hidden="true"/>{assigned.length} назначено</span><span><CheckCircle2 size={15} aria-hidden="true"/>{responded.length} ответили · {pct(responded.length,assigned.length)}%</span>
      </div>
      <EventChoicePanel labels={labels} decisions={responded} members={members} profiles={g.profiles} currentChoice={mineAnswer?.choice} canAnswer={!!my&&my.status==='pending'&&me.kind==='student'&&!outcome&&!busyId&&!readOnly&&!pendingInvites} onAnswer={choice=>{if(my)void answer(my,choice)}} notice={pendingInvites?'Ожидаем ответа на приглашения.':undefined}/>
      {mineAnswer&&me.kind==='student'&&<EventDecisionFeedback caseId={c.id}/>}
      {mineAnswer&&!teacher&&<div className="eventOutcomeNote">Ваш голос: {labels[mineAnswer.choice==='accept'?0:mineAnswer.choice==='reject'?1:Math.max(0,Number(mineAnswer.choice.replace('option_',''))-1)]||'Учтён'}</div>}
      {outcome&&<div className="eventOutcomeNote final"><strong>Итог голосования: {outcome.winner==='tie'?'Большинство участников не поддержало единый вариант — решение не принято':labels[winnerIndex]}</strong>
       {chosenEffect?.description&&<p>{chosenEffect.description}</p>}
       <span>Фактическое изменение доверия: {outcome.trust_delta>0?'+':''}{outcome.trust_delta} п.п. · Голосов: {outcome.votes_count}/{outcome.assignments_count}</span>
       {outcome.requested_trust_delta!==undefined&&outcome.requested_trust_delta!==outcome.trust_delta&&<span>Расчётный эффект: {outcome.requested_trust_delta>0?'+':''}{outcome.requested_trust_delta} п.п. · Достигнута граница показателя.</span>}
      </div>}
      {teacher&&responded.length>0&&!outcome&&<button type="button" disabled={!!busyId||readOnly} className="eventFinalize" onClick={()=>void finalize(c.id)}>Подвести итог по полученным голосам</button>}
      {teacher&&authority.some(a=>a.case_id===c.id)&&<div className="eventAuthorityTable"><h4>Полномочия и баллы</h4>{authority.filter(a=>a.case_id===c.id).map(a=><article key={a.decision_id}><b>{g.names[a.actor_id]||'Участник'}</b><span>{a.role_snapshot||'Без должности'}</span><strong>{a.authority_ok&&a.lawful?'Правовой критерий: 1 балл':'Правовой критерий: 0 баллов'}</strong><small>{a.legal_basis}</small>{a.strategy_point&&<span>Защита интересов своей роли: учитывается в стратегии</span>}</article>)}</div>}
      </>}
     </div>
    </article>
    {expandedCase&&<EventCollaboration g={g} caseId={c.id} invitations={invites} assignedIds={assigned.map(a=>a.recipient_id)} closed={!!outcome} votingStarted={responded.length>0} onChanged={reload} readOnly={readOnly}/>}
    </div></EventCaseModal>;
   })}
  {notice&&<p className="eventNotice" role="status">{notice}</p>}
 </section>;
}
