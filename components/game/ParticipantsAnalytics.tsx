'use client';
import {useEffect,useMemo,useState} from 'react';
import {Download,Search} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import StyledSelect from '../ui/StyledSelect';
import type {ReturnTypeRepublic} from './viewTypes';
type Assessment={user_id:string;stage_no:number;auto_score:number;final_score:number|null;status:'draft'|'final'};
type Sort='surname'|'name'|'score'|'average'|'approved'|'activity'|'posts'|'votes';
const score=(a:Assessment)=>a.status==='final'?(a.final_score??a.auto_score):a.auto_score;
export default function ParticipantsAnalytics({g}:{g:ReturnTypeRepublic}){
 const {game,members,activities,politicalPosts,formalDocuments,ballots,teacher}=g;
 const [assessments,setAssessments]=useState<Assessment[]>([]);
 const [activityTotals,setActivityTotals]=useState<Record<string,number>|null>(null);
 const [sort,setSort]=useState<Sort>('score');
 const [asc,setAsc]=useState(false);
 const [search,setSearch]=useState('');
 const [team,setTeam]=useState('');
 const [stage,setStage]=useState(0);
 const [onlyAssessed,setOnlyAssessed]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!game||!teacher)return;
  let alive=true;
  const load=async()=>{
   const [r,t]=await Promise.all([
    supabase.from('stage_assessments').select('user_id,stage_no,auto_score,final_score,status').eq('game_id',game.id),
    supabase.rpc('teacher_game_activity_counts',{p_game_id:game.id})
   ]);
   if(!alive)return;
   if(r.error)setError(r.error.message);else setAssessments((r.data||[]) as Assessment[]);
   if(t.error){setActivityTotals(null);setError(t.error.message)}
   else setActivityTotals(Object.fromEntries(((t.data||[]) as {user_id:string;activity_count:number|string}[]).map(item=>[item.user_id,Number(item.activity_count)])));
   if(!r.error&&!t.error)setError('')
  };
  void load();
  const channel=supabase.channel('analytics-assessments:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'stage_assessments',filter:'game_id=eq.'+game.id},()=>void load()).subscribe();
  return()=>{alive=false;void supabase.removeChannel(channel)};
 },[game?.id,teacher]);
 const students=members.filter(m=>m.kind==='student');
 const rows=useMemo(()=>students.map(m=>{
  const gradeRows=assessments.filter(a=>a.user_id===m.user_id&&(stage===0||a.stage_no===stage));
  const sum=gradeRows.reduce((total,a)=>total+score(a),0);
  const approved=gradeRows.filter(a=>a.status==='final').length;
  const posts=politicalPosts.filter(p=>p.author_id===m.user_id);
  return {m,sum,average:gradeRows.length?sum/gradeRows.length:null,assessed:gradeRows.length,approved,
   posts:posts.length,
   documents:formalDocuments.filter(d=>d.author_id===m.user_id).length,
   votes:ballots.filter(b=>b.voter_id===m.user_id).length,
   activity:activityTotals===null?activities.filter(a=>a.actor_id===m.user_id).length:activityTotals[m.user_id]||0};
 }),[members,assessments,stage,politicalPosts,formalDocuments,ballots,activities,activityTotals]);
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
  const a=document.createElement('a');a.href=url;a.download='gos-sims-participants.csv';a.click();URL.revokeObjectURL(url);
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
  <p className="journalNote">Источник баллов: stage_assessments. {activityTotals===null?'Активность: последние 250 загруженных событий до получения полного итога.':'Активность: все зафиксированные события игры, подсчитанные сервером.'}</p>
 </section>;
}
