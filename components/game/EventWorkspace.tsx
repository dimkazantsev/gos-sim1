'use client';
import {gameValueLabel} from '../../lib/gameLabels';
import {userError} from '@/lib/userError';
import {useEffect,useMemo,useRef,useState} from 'react';
import {CalendarDays,CheckCircle2,RefreshCw,Send,UsersRound} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';
import StyledSelect from '../ui/StyledSelect';
import DisclosureSummary from '../ui/DisclosureSummary';
import EventCollaboration,{type EventInvitation} from './EventCollaboration';
import {eventButtonSound} from './eventButtonSound';
import EventAutopilotPanel from './EventAutopilotPanel';
import EventComic from './EventComic';
import EventChoicePanel from './EventChoicePanel';

import EventCaseTile from './EventCaseTile';
import EventCaseModal from './EventCaseModal';
import type {EventComicScene} from './types';
type CaseRow={id:string;game_id:string;case_key:string;title:string;situation:string;category:string;seriousness:'serious'|'light';audience:'single'|'group'|'all';allowed_roles:string[];status:string;source_url:string|null;decision_options?:string[];effect_plan?:{best_option_key?:string;options?:{key:string;trust:number;description?:string;legal_basis?:string}[]};comic_scene?:EventComicScene};
type Assignment={id:string;case_id:string;game_id:string;recipient_id:string;status:string;created_at:string};
type Decision={id:string;case_id:string;actor_id:string;choice:string;role_snapshot?:string};
type Authority={decision_id:string;case_id:string;actor_id:string;authority_ok:boolean;lawful:boolean;strategy_point:boolean;role_snapshot:string;legal_basis:string};
type Outcome={case_id:string;winner:string;trust_delta:number;votes_count:number;assignments_count:number;media_post_id:string|null;requested_trust_delta?:number;resolution_kind?:string};
type EventCompact={titles:{id:string;title:string}[];positive:number|null;negative:number|null};
const EVENT_FEED_PAGE_SIZE=10;
type OptionDraft={label:string;trust:number;description:string;lawful:boolean|null;authorizedRoles:string;legalBasis:string;protectsRoleInterest:boolean};
const newOption=(trust=0):OptionDraft=>({label:'',trust,description:'',lawful:null,authorizedRoles:'',legalBasis:'',protectsRoleInterest:false});
const initialOptions=()=>[newOption(2),newOption(),newOption(-2)];
const authorizedRoles=(value:string)=>[...new Set(value.split(/[,;]/).map(role=>role.trim()).filter(Boolean))];
export default function EventWorkspace({g,readOnly=false,mode='feed'}:{g:ReturnTypeRepublic;readOnly?:boolean;mode?:'feed'|'manage'}){
 const {game,me,members,teacher}=g;
 const [invitations,setInvitations]=useState<EventInvitation[]>([]);
 const [authority,setAuthority]=useState<Authority[]>([]);
 const [expanded,setExpanded]=useState('');
 const [legalFilter,setLegalFilter]=useState('all');
 const [cases,setCases]=useState<CaseRow[]>([]);
 const [titles,setTitles]=useState<Record<string,string>|null>(null);
 const [effectCounts,setEffectCounts]=useState<{positive:number;negative:number}|null>(null);
 const [visibleLimit,setVisibleLimit]=useState(EVENT_FEED_PAGE_SIZE);
 const [caseLoading,setCaseLoading]=useState(false);
 const [caseError,setCaseError]=useState('');
 const [retryPage,setRetryPage]=useState(0);
 const inflightCases=useRef(new Set<string>()),failedCases=useRef(new Set<string>());
 const [caseRegions,setCaseRegions]=useState<Record<string,{name:string;party:string}>>({});
 const [readyCaseCount,setReadyCaseCount]=useState<number|null>(null);
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
 const [options,setOptions]=useState(initialOptions);
 const [seriousness,setSeriousness]=useState<'serious'|'light'>('serious');
 const [audience,setAudience]=useState<'single'|'group'|'all'>('single');
 const [selected,setSelected]=useState<string[]>([]);
 const [saving,setSaving]=useState(false);
 const [notice,setNotice]=useState('');
 const [busyId,setBusyId]=useState<string|null>(null);
 const feedScope=JSON.stringify([game?.id,me?.user_id,me?.kind,me?.role_title,teacher,readOnly]);
 const activeScope=useRef(feedScope),alive=useRef(true);activeScope.current=feedScope;
 const reads=useRef({scope:feedScope,promise:null as Promise<void>|null,queued:false,count:false,explicit:false});
 if(reads.current.scope!==feedScope)reads.current={scope:feedScope,promise:null,queued:false,count:false,explicit:false};
 const scopeCurrent=()=>alive.current&&activeScope.current===feedScope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>{inflightCases.current.clear();failedCases.current.clear();setVisibleLimit(EVENT_FEED_PAGE_SIZE);setTitles(null);setEffectCounts(null);setCaseLoading(false);setCaseError('');setCases([]);setAssignments([]);setDecisions([]);setOutcomes([]);setInvitations([]);setAuthority([]);setCaseRegions({});setReadyCaseCount(null);setExpanded('');setNotice('');setBusyId(null);setSaving(false)},[feedScope]);
 async function readFeed(includeCount:boolean,background:boolean){
  const current=()=>scopeCurrent()&&(!background||document.visibilityState==='visible');
  if(!game||!me||!current())return;
  // One SQL-statement read projection, under the RLS of every table.
  // The unassigned case bank is intentionally not included.
  let projection=await supabase.rpc('get_event_workspace_feed_bootstrap',{
   p_game_id:game.id,p_include_ready_count:includeCount
  });
  if(projection.error&&['PGRST202','42883'].includes(String(projection.error.code||''))){
   projection=await supabase.rpc('get_event_workspace_projection',{
    p_game_id:game.id,p_include_ready_count:includeCount
   });
  }
  if(!current())return;
  let snapshot:{
   assignments:Assignment[];decisions:Decision[];outcomes:Outcome[];
   invitations:EventInvitation[];authority:Authority[];ready_case_count:number|null;compact?:EventCompact;
  };
  if(projection.error){
   // Rolling schema deployment compatibility only. Never amplify overload.
   if(!['PGRST202','42883'].includes(String(projection.error.code||''))){
    setNotice(userError(projection.error));return;
   }
   const [b,c,d,e,f]=await Promise.all([
    supabase.from('event_assignments').select('id,case_id,game_id,recipient_id,status,created_at').eq('game_id',game.id),
    supabase.from('event_decisions').select('id,case_id,actor_id,choice,role_snapshot').eq('game_id',game.id),
    supabase.from('event_case_outcomes').select('case_id,winner,trust_delta,votes_count,assignments_count,media_post_id,requested_trust_delta,resolution_kind').eq('game_id',game.id),
    supabase.from('event_collaboration_invites').select('id,case_id,inviter_id,recipient_id,status').eq('game_id',game.id),
    supabase.from('event_authority_evidence').select('decision_id,case_id,actor_id,authority_ok,lawful,strategy_point,role_snapshot,legal_basis').eq('game_id',game.id)
   ]);
   if(!current())return;
   const error=[b,c,d,e,f].find(r=>r.error)?.error;
   if(error){setNotice(userError(error));return}
   snapshot={
    assignments:(b.data||[]) as Assignment[],decisions:(c.data||[]) as Decision[],
    outcomes:(d.data||[]) as Outcome[],invitations:(e.data||[]) as EventInvitation[],
    authority:(f.data||[]) as Authority[],ready_case_count:null
   };
  }else{
   const data=projection.data as typeof snapshot|null;
   if(!data||!Array.isArray(data.assignments)||!Array.isArray(data.decisions)||
      !Array.isArray(data.outcomes)||!Array.isArray(data.invitations)||
      !Array.isArray(data.authority)){
    setNotice('Не удалось получить состояние событий.');return;
   }
   snapshot=data;
  }
  const assignedRows=snapshot.assignments,invitedRows=snapshot.invitations;
  let compact=snapshot.compact;
  if(!compact){
   // Fallback for staged deployment; never download full case bodies here.
   const ids=[...new Set([...assignedRows.map(a=>a.case_id),...invitedRows.map(v=>v.case_id)])];
   const response=await supabase.rpc('event_feed_compact_summary',{p_game_id:game.id,p_case_ids:ids});
   if(!current())return;
   if(response.error){setNotice(userError(response.error));return}
   compact=response.data as EventCompact;
  }
  if(!compact||!Array.isArray(compact.titles)){setNotice('Не удалось загрузить список ситуаций.');return}
  setTitles(Object.fromEntries(compact.titles.map(item=>[item.id,item.title])));
  setEffectCounts(typeof compact.positive==='number'&&typeof compact.negative==='number'?{positive:compact.positive,negative:compact.negative}:null);
  setInvitations(invitedRows);setAuthority(snapshot.authority);
  setAssignments(assignedRows);setDecisions(snapshot.decisions);setOutcomes(snapshot.outcomes);
  if(includeCount){
   if(snapshot.ready_case_count!==null&&Number.isFinite(snapshot.ready_case_count)){
    setReadyCaseCount(snapshot.ready_case_count);
   }else if(projection.error){
    // The older schema has no server-projected count.
    const result=await supabase.from('event_cases').select('id',{head:true,count:'exact'}).eq('game_id',game.id).eq('status','ready');
    if(!current())return;
    if(!result.error)setReadyCaseCount(result.count??0);
   }
  }
 }
 async function reload(includeCount=false,background=false){
  if(!scopeCurrent()||background&&document.visibilityState!=='visible')return;
  const state=reads.current;
  state.count=state.count||includeCount;state.explicit=state.explicit||!background;
  if(state.promise){state.queued=true;return state.promise}
  state.promise=(async()=>{
   do{
    state.queued=false;const count=state.count,passive=!state.explicit;state.count=false;state.explicit=false;
    try{await readFeed(count,passive)}catch(error){if(scopeCurrent())setNotice(userError(error))}
   }while(state.queued&&scopeCurrent());
  })().finally(()=>{state.promise=null});
  return state.promise;
 }
 useGameTableSync(me?.user_id?game?.id:undefined,['event_cases','event_assignments','event_decisions','event_case_outcomes','event_collaboration_invites','event_authority_evidence','event_case_routing'],()=>reload(readyCaseCount===null,true),feedScope,undefined,750,180000);
 const students=members.filter(m=>m.kind==='student');
 const roles=[...new Set(students.map(m=>m.role_title?.trim()).filter((r):r is string=>!!r))].sort((a,b)=>a.localeCompare(b,'ru'));
 const recipients=roleFilter&&audience!=='all'?students.filter(m=>m.role_title===roleFilter):students;
 const mine=assignments.filter(a=>a.recipient_id===me?.user_id);
 const myPendingCases=new Set([...mine.filter(a=>a.status==='pending').map(a=>a.case_id),...invitations.filter(i=>i.recipient_id===me?.user_id&&i.status==='pending').map(i=>i.case_id)]).size;
 const eligible=audience==='all'?students.map(m=>m.user_id):selected;
 const canSend=title.trim().length>=6&&situation.trim().length>=20&&options.every(o=>{
  const roles=authorizedRoles(o.authorizedRoles);
  return o.label.trim().length>=2&&o.description.trim().length>=5&&Number.isFinite(o.trust)&&o.lawful!==null&&roles.length>=1&&roles.length<=20&&roles.every(role=>role.length>=2&&role.length<=120)&&o.legalBasis.trim().length>=5&&o.legalBasis.length<=2000;
 })&&new Set(options.map(o=>o.label.trim().toLowerCase())).size===options.length&&
  (audience==='all'?students.length>0:audience==='single'?selected.length===1:selected.length>=2&&selected.length<=3);
 async function create(){
  if(!game||!me||!teacher||saving||!canSend||readOnly)return;
  setSaving(true);setNotice('');
  const r=await supabase.rpc('create_assigned_event',{
   p_game_id:game.id,p_title:title.trim(),p_situation:situation.trim(),p_category:category,
   p_seriousness:seriousness,p_audience:audience,p_options:options.map(o=>({label:o.label,trust:o.trust,description:o.description,authorized_roles:authorizedRoles(o.authorizedRoles),lawful:o.lawful,legal_basis:o.legalBasis.trim(),protects_role_interest:o.protectsRoleInterest})),p_recipients:eligible,p_roles:roleFilter?[roleFilter]:[]
  });
  if(!scopeCurrent())return;
  if(r.error)setNotice(userError(r.error));
  else{setNotice('Событие направлено участникам: '+eligible.length);setTitle('');setSituation('');setSelected([]);setOptions(initialOptions());await reload()}
  if(scopeCurrent())setSaving(false);
 }
 async function answer(assignment:Assignment,choice:string){
  if(busyId||readOnly||me?.kind!=='student')return;
  eventButtonSound();setBusyId(assignment.id);setNotice('');
  const r=await supabase.rpc('submit_event_decision',{p_assignment_id:assignment.id,p_choice:choice,p_rationale:null});
  if(!scopeCurrent())return;
  if(r.error)setNotice(userError(r.error));else await Promise.all([reload(false),g.refreshEventEffects()]);
  if(scopeCurrent())setBusyId(null);
 }
 const assignedCaseIds=new Set(assignments.map(a=>a.case_id));
 function resolvedValue(d:Decision,c:CaseRow){
  const index=d.choice==='accept'?0:d.choice==='reject'?1:Number(d.choice.replace('option_',''))-1;
  return c.effect_plan?.options?.[index]?.trust??0;
 }
 // Только компактный индекс нужен для сортировки и фильтров.
 const orderedIds=useMemo(()=>{
  const byCase=new Map<string,Assignment[]>(),lastAt=new Map<string,number>();
  for(const row of assignments){
   byCase.set(row.case_id,[...(byCase.get(row.case_id)||[]),row]);
   lastAt.set(row.case_id,Math.max(lastAt.get(row.case_id)||0,Date.parse(row.created_at)||0));
  }
  const pendingInvites=new Set(invitations.filter(i=>i.recipient_id===me?.user_id&&i.status==='pending').map(i=>i.case_id));
  const outcomesSet=new Set(outcomes.map(o=>o.case_id)),rolesMap=new Map(members.map(m=>[m.user_id,m.role_title]));
  return [...new Set([...byCase.keys(),...invitations.map(i=>i.case_id)])].filter(id=>{
   if(titles&&!Object.prototype.hasOwnProperty.call(titles,id))return false;
   const assigned=byCase.get(id)||[];
   if(!teacher&&me?.kind!=='observer'&&!assigned.some(x=>x.recipient_id===me?.user_id)&&!pendingInvites.has(id))return false;
   if(feedPerson&&!assigned.some(x=>x.recipient_id===feedPerson))return false;
   if(feedRole&&!assigned.some(x=>rolesMap.get(x.recipient_id)===feedRole))return false;
   if(legalFilter!=='all'&&!authority.some(x=>x.case_id===id&&(!feedPerson||x.actor_id===feedPerson)&&(legalFilter==='valid'?(x.authority_ok&&x.lawful):(!x.authority_ok||!x.lawful))))return false;
   if(feedState==='resolved'&&!outcomesSet.has(id))return false;
   if(feedState==='pending'&&outcomesSet.has(id))return false;
   return true;
  }).sort((left,right)=>{
   if(feedSort==='name'){
    const comparison=(titles?.[left]||'').localeCompare(titles?.[right]||'','ru');
    if(comparison)return comparison;
   }
   const recent=(lastAt.get(right)||0)-(lastAt.get(left)||0);
   return (feedSort==='oldest'?-recent:recent)||left.localeCompare(right);
  });
 },[assignments,invitations,outcomes,members,me?.user_id,me?.kind,teacher,titles,authority,feedPerson,feedRole,feedState,feedSort,legalFilter]);
 useEffect(()=>{setVisibleLimit(EVENT_FEED_PAGE_SIZE);setExpanded('')},[feedPerson,feedRole,feedState,feedSort,legalFilter,feedScope]);
 const requestedIds=useMemo(()=>orderedIds.slice(0,visibleLimit),[orderedIds,visibleLimit]);
 const loadedMap=useMemo(()=>new Map(cases.map(c=>[c.id,c])),[cases]);
 const visibleCases=requestedIds.map(id=>loadedMap.get(id)).filter((c):c is CaseRow=>!!c);
 const hasMore=orderedIds.length>visibleLimit;
 useEffect(()=>{
  if(!game||!me||!titles)return;
  const missing=requestedIds.filter(id=>!loadedMap.has(id)&&!inflightCases.current.has(id)&&!failedCases.current.has(id)).slice(0,EVENT_FEED_PAGE_SIZE);
  if(!missing.length)return;
  for(const id of missing)inflightCases.current.add(id);
  setCaseLoading(true);setCaseError('');
  const scope=feedScope;
  void (async()=>{
   try{
    const response=await supabase.rpc('list_visible_event_cases',{p_game_id:game.id,p_case_ids:missing});
    if(response.error)throw response.error;
    if(!alive.current||activeScope.current!==scope)return;
    const rows=(response.data||[]) as CaseRow[],returned=new Set(rows.map(row=>row.id));
    for(const id of missing)if(!returned.has(id))failedCases.current.add(id);
    setCases(previous=>{
     const map=new Map(previous.map(c=>[c.id,c]));
     for(const row of rows)map.set(row.id,row);
     return [...map.values()];
    });
    if(!rows.length)return;
    const routing=await supabase.from('event_case_routing').select('case_id,region_code').eq('game_id',game.id).in('case_id',rows.map(row=>row.id)).not('region_code','is',null);
    if(!alive.current||activeScope.current!==scope||routing.error||!routing.data?.length)return;
    const codes=[...new Set(routing.data.map(row=>row.region_code))];
    const [reference,control]=await Promise.all([
     supabase.from('fiscal_region_reference').select('code,name').in('code',codes),
     supabase.from('game_region_party_control').select('region_code,party_id').eq('game_id',game.id).in('region_code',codes)
    ]);
    if(!alive.current||activeScope.current!==scope||reference.error||control.error)return;
    const names=new Map((reference.data||[]).map(r=>[r.code,r.name]));
    const parties=new Map((g.parties||[]).map(p=>[p.id,p.name]));
    const controllers=new Map((control.data||[]).map(r=>[r.region_code,parties.get(r.party_id)||'партия-победитель']));
    setCaseRegions(previous=>({...previous,...Object.fromEntries(routing.data.filter(r=>controllers.has(r.region_code)).map(row=>[
     row.case_id,{name:names.get(row.region_code)||row.region_code,party:controllers.get(row.region_code)||''}
    ]))}));
   }catch(error){
    if(alive.current&&activeScope.current===scope){
     for(const id of missing)failedCases.current.add(id);
     setCaseError(userError(error));
    }
   }finally{
    for(const id of missing)inflightCases.current.delete(id);
    if(alive.current&&activeScope.current===scope)setCaseLoading(inflightCases.current.size>0);
   }
  })();
 },[game?.id,me?.user_id,feedScope,requestedIds,loadedMap,titles,retryPage]);
 const seenAssignments=teacher?assignments:mine;
 const caseIds=new Set(seenAssignments.map(a=>a.case_id));
 const relevantDecisions=teacher?decisions:decisions.filter(d=>caseIds.has(d.case_id)&&d.actor_id===me?.user_id);
 const completedCount=relevantDecisions.length;
 const effect=(d:Decision)=>{const c=cases.find(c=>c.id===d.case_id);return c?resolvedValue(d,c):0};
 const yesCount=teacher?(effectCounts?.positive??0):relevantDecisions.filter(d=>effect(d)>0).length;
 const noCount=teacher?(effectCounts?.negative??0):relevantDecisions.filter(d=>effect(d)<0).length;
 const neutralCount=relevantDecisions.length-yesCount-noCount;
 const ratio=(n:number,d:number)=>d?Math.round(100*n/d):0;
 async function finalize(id:string){
  if(!teacher||busyId||!window.confirm('Подвести итог по текущим ответам и завершить голосование досрочно?'))return;
  setBusyId(id);const r=await supabase.rpc('finalize_event_case',{p_case_id:id});
  if(!scopeCurrent())return;
  setNotice(r.error?userError(r.error):r.data?.reason==='no_answers'?'Пока нет голосов.':'Итог зафиксирован.');
  if(!r.error)await Promise.all([reload(false),g.refreshEventEffects()]);if(scopeCurrent())setBusyId(null);
 }
 if(!game||!me)return null;
 return <section className="eventWorkspace" aria-label="События — ситуационные решения">
  <header className="eventWorkspaceHeader"><div className="eventWorkspaceHeading"><small>СОБЫТИЯ · ИГРОВЫЕ СИТУАЦИИ</small><div className="eventWorkspaceTitleRow"><h2>События и решения</h2></div><p>Индивидуальные задания, совместные решения 2–3 участников и общее голосование. После решения здесь видны голоса по каждому варианту, последствия и итоговое изменение доверия.</p></div><div className="eventWorkspaceHeaderActions"><button type="button" className="eventRefreshButton secondary" onClick={()=>void reload(true)} aria-label="Обновить список событий и результаты"><RefreshCw size={16} aria-hidden="true"/><span>Обновить</span></button><span className="eventWorkspaceStatus"><CalendarDays size={17} aria-hidden="true"/>{teacher?'Назначенные ситуации':me.kind==='observer'?'Гостевой просмотр':'Ваши задания'}{!teacher&&me.kind==='student'&&myPendingCases>0&&<b className="eventPendingBadge" aria-label={'Ожидают решения: '+myPendingCases}>{myPendingCases}</b>}</span></div></header>
  {mode==='manage'&&teacher&&<div className="eventDecisionOverview" aria-label="Статистика решений по игровым событиям">
   <article><small>Назначено заданий</small><strong>{seenAssignments.length}</strong><span>{teacher?'Всем участникам':'Вам'}</span></article>
   <article><small>Решено</small><strong>{completedCount}<em> / {seenAssignments.length}</em></strong><span>{ratio(completedCount,seenAssignments.length)}% заданий</span></article>
   <article><small>В интересах общества</small><strong>{effectCounts?yesCount:'—'}</strong><span>{effectCounts?ratio(yesCount,relevantDecisions.length)+'%':'—'} от ответов</span></article>
   <article><small>Негативные последствия</small><strong>{effectCounts?noCount:'—'}</strong><span>{effectCounts?ratio(noCount,relevantDecisions.length)+'%':'—'} от ответов</span></article>
   <article><small>Нейтральные решения</small><strong>{effectCounts?neutralCount:'—'}</strong><span>{effectCounts?ratio(neutralCount,relevantDecisions.length)+'%':'—'} от ответов</span></article>
  </div>}
  {mode==='manage'&&teacher&&<EventAutopilotPanel g={g} panelMode="settings" onChanged={()=>reload(true)} readyCaseCount={readyCaseCount} readOnly={readOnly}/>}
  {mode==='manage'&&teacher&&<details className="eventComposerPanel civicDisclosure projectDisclosure">
   <DisclosureSummary icon={Send} title="Создать событие" description="Ситуация, варианты решения и участники"/><div className="civicDisclosureBody">
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
    <div className="eventChoiceDescription"><StyledSelect label="Правомерность решения" value={o.lawful===null?'':String(o.lawful)} onChange={value=>setOptions(old=>old.map((v,j)=>j===i?{...v,lawful:value==='true'?true:value==='false'?false:null}:v))} options={[{value:'',label:'Выберите правовую оценку'},{value:'true',label:'Правомерно'},{value:'false',label:'Неправомерно'}]}/></div>
    <label className="eventChoiceDescription">Полномочные должности<input value={o.authorizedRoles} maxLength={2500} onChange={e=>setOptions(old=>old.map((v,j)=>j===i?{...v,authorizedRoles:e.target.value}:v))} placeholder="Министр финансов; Председатель правительства"/><small>Названия должностей через запятую или точку с запятой.</small></label>
    <label className="eventChoiceDescription">Правовое основание<textarea rows={2} value={o.legalBasis} maxLength={2000} onChange={e=>setOptions(old=>old.map((v,j)=>j===i?{...v,legalBasis:e.target.value}:v))} placeholder="Норма, которая разрешает или запрещает решение (от 5 символов)"/></label>
    <label className="eventChoiceDescription" style={{display:'flex',alignItems:'center'}}><input type="checkbox" style={{width:17,minHeight:17}} checked={o.protectsRoleInterest} onChange={e=>setOptions(old=>old.map((v,j)=>j===i?{...v,protectsRoleInterest:e.target.checked}:v))}/>Защищает интересы своей роли</label>
   </article>)}<button type="button" disabled={options.length>=6} onClick={()=>setOptions(old=>[...old,newOption()])}>Добавить вариант</button></div>
   {audience!=='all'&&<div className="eventRecipients"><strong>Получатели · {selected.length}/{audience==='single'?1:3}</strong><div>{recipients.map(m=><label key={m.user_id}><input type="checkbox" checked={selected.includes(m.user_id)} disabled={!selected.includes(m.user_id)&&selected.length>=(audience==='single'?1:3)} onChange={e=>setSelected(old=>e.target.checked?[...old,m.user_id]:old.filter(x=>x!==m.user_id))}/>{m.full_name}<small>{m.role_title||'Студент'}</small></label>)}</div></div>}
   <footer><span>{audience==='all'?'Получатели: вся аудитория':'Выбрано: '+selected.length}</span><button type="button" onClick={()=>void create()} disabled={!canSend||saving||readOnly}>{saving?'Отправка…':'Назначить событие'}</button></footer>
  </div></details>}
  {mode==='manage'&&teacher&&<EventAutopilotPanel g={g} panelMode="bank" onChanged={()=>reload(true)} readyCaseCount={readyCaseCount} readOnly={readOnly}/>}
  {<div className="eventList"><header className="eventFeedHeader"><div><small>ЛЕНТА НАЗНАЧЕННЫХ СИТУАЦИЙ</small><h3>{teacher||me.kind==='observer'?'Решения участников':'Мои события'}</h3></div><span>{orderedIds.length} событий</span></header>
   {<div className="eventFeedFilters">
    <StyledSelect label="Участник" value={feedPerson} onChange={setFeedPerson} options={[{value:'',label:'Все участники'},...students.map(m=>({value:m.user_id,label:m.full_name}))]}/>
    <StyledSelect label="Должность" value={feedRole} onChange={setFeedRole} options={[{value:'',label:'Все должности'},...roles.map(r=>({value:r,label:r}))]}/>
    <StyledSelect label="Состояние" value={feedState} onChange={setFeedState} options={[{value:'all',label:'Все события'},{value:'resolved',label:'Результат получен'},{value:'pending',label:'Ожидают решения'}]}/>
    <StyledSelect label="Сортировка" value={feedSort} onChange={setFeedSort} options={[{value:'recent',label:'Сначала новые назначения'},{value:'oldest',label:'Сначала старые назначения'},{value:'name',label:'По названию · А–Я'}]}/>
   </div>}
   {teacher&&<StyledSelect label="Правовая оценка" value={legalFilter} onChange={setLegalFilter} options={[{value:'all',label:'Все решения'},{value:'valid',label:'В пределах полномочий'},{value:'invalid',label:'Нарушения полномочий или права'}]}/>}
   {orderedIds.length===0?<div className="journalEmpty">Назначенных ситуаций пока нет.</div>:
   <div className="eventTileGrid" aria-label="Карточки ситуаций">{visibleCases.map(c=>{
    const assigned=assignments.filter(a=>a.case_id===c.id),responded=decisions.filter(d=>d.case_id===c.id);
    const closed=outcomes.some(o=>o.case_id===c.id),invited=invitations.some(i=>i.case_id===c.id&&i.recipient_id===me.user_id&&i.status==='pending');
    return <EventCaseTile key={c.id} item={c} meta={invited?'Приглашение к решению':closed?'Решено · '+responded.length+' ответов':assigned.length?'Ожидает решения · '+responded.length+'/'+assigned.length:'Можно назначить'} onClick={()=>setExpanded(c.id)}/>;
   })}</div>}
   {caseLoading&&<p className="eventFeedLoading" role="status">Загрузка ситуаций…</p>}
   {caseError&&<p className="eventFeedLoading" role="alert">{caseError} <button type="button" onClick={()=>{failedCases.current.clear();setRetryPage(n=>n+1)}}>Повторить</button></p>}
   {hasMore&&<div className="eventFeedMore"><span>Показано {visibleCases.length} из {orderedIds.length}</span><button type="button" className="eventBankShowMore" disabled={caseLoading||!!caseError} onClick={()=>setVisibleLimit(n=>n+EVENT_FEED_PAGE_SIZE)}>Показать ещё 10</button></div>}</div>}
  {expanded&&cases.filter(c=>c.id===expanded).map(c=>{
    const assigned=assignments.filter(a=>a.case_id===c.id),responded=decisions.filter(d=>d.case_id===c.id);
    const my=assigned.find(a=>a.recipient_id===me.user_id);
    const outcome=outcomes.find(o=>o.case_id===c.id);
    const mineAnswer=responded.find(d=>d.actor_id===me.user_id);
    const labels=Array.isArray(c.decision_options)&&c.decision_options.length>=2?c.decision_options:['Принять','Отклонить'];
    const pct=(n:number,d:number)=>d?Math.round(n*100/d):0;
    const winnerIndex=outcome?.winner==='accept'?0:outcome?.winner==='reject'?1:Number(outcome?.winner.replace('option_',''))-1;
    const chosenEffect=outcome&&winnerIndex>=0?c.effect_plan?.options?.[winnerIndex]:null;
    const bestIndex=outcome&&c.effect_plan?.best_option_key?Number(c.effect_plan.best_option_key.replace('option_',''))-1:null;
    const bestOption=bestIndex!==null&&Number.isInteger(bestIndex)&&bestIndex>=0?c.effect_plan?.options?.[bestIndex]:undefined;
    const kind=outcome?.resolution_kind||(outcome?(Number(chosenEffect?.trust)>0?'beneficial':Number(chosenEffect?.trust)<0?'harmful':'neutral'):'pending');
    const expandedCase=true;
    const invites=invitations.filter(i=>i.case_id===c.id);
    const pendingInvites=invites.some(i=>i.status==='pending');
    return <EventCaseModal key={c.id} title={c.title} onClose={()=>setExpanded('')}><div className="eventCaseBundle"><article className={'eventCaseCard eventStory '+(kind==='beneficial'?'eventStoryResolved ':kind==='harmful'?'eventStoryRejected ':outcome?'eventStoryNeutral ':'')}>
     <div className="eventStoryVisual"><EventComic silent title={c.title} category={gameValueLabel(c.category,'Ситуация')} caseKey={c.case_key} scene={c.comic_scene} compact/></div>
     <div className="eventStoryContent">
      {teacher&&<div className="eventCaseTop"><span>{gameValueLabel(c.category,'Ситуация')}</span><span>{c.seriousness==='serious'?'Серьёзная':'Повседневная'} · {invites.some(i=>i.status==='accepted')?'Совместно':c.audience==='all'?'Все':c.audience==='group'?'Совместно':'Личная'}</span></div>}
      <h4>{c.title}</h4>{caseRegions[c.id]&&<p className="eventRegionAssignmentNotice"><strong>Региональное отделение партии {caseRegions[c.id].party}</strong> · {caseRegions[c.id].name}. В данном субъекте победили губернатор и партия, получившая контроль над законодательным органом субъекта РФ. Поэтому вашей партийной команде необходимо решить эту ситуацию. При необходимости пригласите компетентных участников другого органа власти.</p>}{expandedCase&&<><p>{c.situation.replace(/\\n/g,'\n')}</p>
      <div className="eventStoryRecipients">{assigned.map(a=><span key={a.id}>{members.find(m=>m.user_id===a.recipient_id)?.full_name||'Участник'} · {members.find(m=>m.user_id===a.recipient_id)?.role_title||'Без должности'}</span>)}</div>
      <div className="eventCaseFooter"><span><UsersRound size={15} aria-hidden="true"/>{assigned.length} назначено</span><span><CheckCircle2 size={15} aria-hidden="true"/>{responded.length} ответили · {pct(responded.length,assigned.length)}%</span>
      </div>
      <EventChoicePanel labels={labels} decisions={responded} members={members} profiles={g.profiles} currentChoice={mineAnswer?.choice} canAnswer={!!my&&my.status==='pending'&&me.kind==='student'&&!outcome&&!busyId&&!readOnly&&!pendingInvites} onAnswer={choice=>{if(my)void answer(my,choice)}} revealResults={teacher||!!outcome||!!mineAnswer} showCorrectExplanation={!!mineAnswer&&!!outcome&&me.kind==='student'} correctIndex={bestIndex} bestDescription={bestOption?.description} bestLegalBasis={bestOption?.legal_basis} shuffleSeed={c.id+':'+me.user_id} notice={pendingInvites?'Ожидаем ответа на приглашения.':undefined}/>

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
    {expandedCase&&<EventCollaboration g={g} caseId={c.id} invitations={invites} assignedIds={assigned.map(a=>a.recipient_id)} closed={!!outcome} votingStarted={responded.length>0} onChanged={()=>reload(false)} readOnly={readOnly}/>}
    </div></EventCaseModal>;
   })}
  {notice&&<p className="eventNotice" role="status">{notice}</p>}
 </section>;
}
