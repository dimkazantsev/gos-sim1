'use client';
import {userError} from '@/lib/userError';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Download,Search} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import StyledSelect from '../ui/StyledSelect';
import type {ReturnTypeRepublic} from './viewTypes';
import {useGameTableSync} from './useGameTableSync';
type Assessment={user_id:string;stage_no:number;auto_score:number;final_score:number|null;status:'draft'|'final'};
type Sort='surname'|'name'|'score'|'average'|'approved'|'activity'|'posts'|'votes';
const score=(a:Assessment)=>a.status==='final'?(a.final_score??a.auto_score):a.auto_score;
export default function ParticipantsAnalytics({g}:{g:ReturnTypeRepublic}){
 const {game,members,activities,politicalPosts,formalDocuments,ballots,teacher}=g;
 const [storedAssessments,setAssessments]=useState<Assessment[]>([]);
 const [storedActivityTotals,setActivityTotals]=useState<Record<string,number>|null>(null);
 const scope=[game?.id,g.me?.user_id,teacher].join(':');
 const activeScope=useRef(scope),assessmentScope=useRef(''),activityScope=useRef(''),loadRequest=useRef(0);activeScope.current=scope;
 const assessments=assessmentScope.current===scope?storedAssessments:[];
 const activityTotals=activityScope.current===scope?storedActivityTotals:null;
 const [sort,setSort]=useState<Sort>('score');
 const [asc,setAsc]=useState(false);
 const [search,setSearch]=useState('');
 const [team,setTeam]=useState('');
 const [stage,setStage]=useState(0);
 const [onlyAssessed,setOnlyAssessed]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>()=>{loadRequest.current++},[scope]);
 useGameTableSync(teacher?game?.id:undefined,['stage_assessments','game_activity'],async()=>{
  if(!game||!teacher)return;
  const requestedScope=scope,request=++loadRequest.current,controller=new AbortController(),signal=controller.signal;
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
   const [r,t]=await Promise.race([Promise.all([
    supabase.from('stage_assessments').select('user_id,stage_no,auto_score,final_score,status').eq('game_id',game.id).abortSignal(signal),
    supabase.rpc('teacher_game_activity_counts',{p_game_id:game.id}).abortSignal(signal)
   ]),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('Не удалось обновить аналитику: сервер не ответил вовремя.'))},12000)})]);
   if(activeScope.current!==requestedScope||loadRequest.current!==request||signal.aborted)return;
   if(r.error)setError(userError(r.error));else{assessmentScope.current=requestedScope;setAssessments((r.data||[]) as Assessment[])}
   if(t.error){activityScope.current=requestedScope;setActivityTotals(null);setError(userError(t.error))}
   else{activityScope.current=requestedScope;setActivityTotals(Object.fromEntries(((t.data||[]) as {user_id:string;activity_count:number|string}[]).map(item=>[item.user_id,Number(item.activity_count)])))}
   if(!r.error&&!t.error)setError('')
  }catch(error){if(activeScope.current===requestedScope&&loadRequest.current===request)setError(userError(error))}
  finally{clearTimeout(timeout)}
 },scope,undefined,3000,180000);
 const students=members.filter(m=>m.kind==='student');
 const rows=useMemo(()=>{
  function counts<T>(items:T[],id:(item:T)=>string){const result=new Map<string,number>();for(const item of items){const key=id(item);result.set(key,(result.get(key)||0)+1)}return result}
  const grades=new Map<string,{sum:number;assessed:number;approved:number}>();
  for(const a of assessments){
   if(stage!==0&&a.stage_no!==stage)continue;
   const item=grades.get(a.user_id)||{sum:0,assessed:0,approved:0};
   item.sum+=score(a);item.assessed++;if(a.status==='final')item.approved++;grades.set(a.user_id,item);
  }
  const posts=counts(politicalPosts,p=>p.author_id),documents=counts(formalDocuments,d=>d.author_id);
  const votes=counts(ballots,b=>b.voter_id),activity=activityTotals===null?counts(activities,a=>a.actor_id):null;
  return members.filter(m=>m.kind==='student').map(m=>{
   const grade=grades.get(m.user_id)||{sum:0,assessed:0,approved:0};
   return {m,...grade,average:grade.assessed?grade.sum/grade.assessed:null,
    posts:posts.get(m.user_id)||0,documents:documents.get(m.user_id)||0,votes:votes.get(m.user_id)||0,
    activity:activityTotals===null?activity?.get(m.user_id)||0:activityTotals[m.user_id]||0};
  });
 },[members,assessments,stage,politicalPosts,formalDocuments,ballots,activities,activityTotals]);
 const filtered=rows.filter(r=>(!team||(r.m.team||r.m.group_name||'')===team)&&(!onlyAssessed||r.assessed>0)&&
  (!search||[r.m.full_name,r.m.team||'',r.m.group_name||'',r.m.role_title||''].some(s=>s.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))))).sort((a,b)=>{
   const part=(n:string,index:number)=>n.trim().split(/\s+/)[index]||'';
   let n=sort==='surname'?part(a.m.full_name,0).localeCompare(part(b.m.full_name,0),'ru'):
    sort==='name'?part(a.m.full_name,1).localeCompare(part(b.m.full_name,1),'ru'):
    sort==='score'?a.sum-b.sum:sort==='average'?(a.average??-1)-(b.average??-1):
    sort==='approved'?a.approved-b.approved:sort==='posts'?a.posts-b.posts:sort==='votes'?a.votes-b.votes:a.activity-b.activity;
   if(sort==='surname'||sort==='name')n=asc?n:-n;else n=asc?n:-n;
   return n||a.m.full_name.localeCompare(b.m.full_name,'ru');
 });
 const teams=[...new Set(students.map(m=>m.team||m.group_name||'').filter(Boolean))].sort();
 const totalApproved=filtered.reduce((x,r)=>x+r.approved,0);
 const totalAssessed=filtered.reduce((x,r)=>x+r.assessed,0);
 function csv(){
  const values=[['Фамилия и имя','Партия или группа','Балл всего','Средний балл','Оценено этапов','Утверждено','Посты','НПА','Голоса','Активность'],...filtered.map(r=>[
   r.m.full_name,r.m.team||r.m.group_name||'',r.sum.toString(),r.average===null?'':r.average.toFixed(2),
   String(r.assessed),String(r.approved),String(r.posts),String(r.documents),String(r.votes),String(r.activity)])];
  const contents=values.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
  const blob=new Blob(['\ufeff'+contents],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='gos-id-participants.csv';a.click();URL.revokeObjectURL(url);
 }
 if(!teacher)return null;
 return <section className="participantsAnalytics">
  <div className="participantsHeader"><div><small>АНАЛИТИКА УЧАСТНИКОВ</small><h2>Действия и результаты студентов</h2>
   <p>Баллы рассчитаны по единому журналу ВСН. Среднее — только по этапам, для которых существует оценка; отсутствие оценки не считается нулём.</p></div>
   <button type="button" onClick={csv}><Download size={16} aria-hidden="true"/> Экспорт CSV</button>
  </div>
  <div className="participantsSummary">
   <span><b>{filtered.length}</b> участников</span><span><b>{totalAssessed}</b> оценённых этапов</span><span><b>{totalApproved}</b> утверждённых оценок</span>
  </div>
  <div className="participantsToolbar">
   <label className="participantsSearch"><Search size={17} aria-hidden="true"/><input type="search" placeholder="Поиск по студентам" value={search} onChange={e=>setSearch(e.target.value)} aria-label="Поиск по студентам"/></label>
   <StyledSelect label="Партия" value={team} onChange={setTeam} options={[{value:'',label:'Все'},...teams.map(t=>({value:t,label:t}))]}/>
   <StyledSelect label="Этап" value={String(stage)} onChange={v=>setStage(Number(v))}
    options={[{value:'0',label:'Все 16'},...Array.from({length:16},(_,i)=>({value:String(i+1),label:String(i+1)}))]}/>
   <StyledSelect label="Сортировать" value={sort} onChange={v=>setSort(v as Sort)}
    options={[{value:'score',label:'Сумма баллов'},{value:'average',label:'Средний балл'},{value:'surname',label:'Фамилия'},
     {value:'name',label:'Имя'},{value:'approved',label:'Утверждено'},{value:'activity',label:'Активность'},
     {value:'posts',label:'Посты'},{value:'votes',label:'Голоса'}]}/>
   <button type="button" onClick={()=>setAsc(!asc)} aria-label={asc?'По убыванию':'По возрастанию'}>{asc?'↑ Возрастание':'↓ Убывание'}</button>
   <label className="participantsCheck"><input type="checkbox" checked={onlyAssessed} onChange={e=>setOnlyAssessed(e.target.checked)}/> Только оценённые</label>
  </div>
  {error&&<p role="alert">{error}</p>}
  <div className="participantsTableScroll" role="region" aria-label="Таблица аналитики участников" tabIndex={0}>
   <table className="participantsTable"><thead><tr><th>Участник</th><th>Сумма</th><th>Среднее</th><th>Этапы</th><th>Итоговых</th><th>Посты</th><th>НПА</th><th>Голоса</th><th>Активность</th></tr></thead>
    <tbody>{filtered.map(r=><tr key={r.m.user_id}><th scope="row"><strong>{r.m.full_name}</strong><small>{r.m.team||r.m.group_name||'Без группы'} · {r.m.role_title||'Роль не назначена'}</small></th>
     <td><b>{r.assessed?r.sum:'—'}</b></td><td>{r.average===null?'—':r.average.toFixed(2)}</td><td>{r.assessed}/16</td><td>{r.approved}</td><td>{r.posts}</td><td>{r.documents}</td><td>{r.votes}</td><td>{r.activity}</td></tr>)}</tbody>
   </table>
   {!filtered.length&&<div className="journalEmpty">Нет участников по выбранным условиям.</div>}
  </div>
  <p className="journalNote">Источник баллов: журнал оценивания. {activityTotals===null?'Активность: последние 250 загруженных событий до получения полного итога.':'Активность: все зафиксированные события игры, подсчитанные сервером.'}</p>
 </section>;
}
