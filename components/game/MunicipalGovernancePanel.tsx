'use client';
import {IconAction} from '../ui/IconAction';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type Election={id:string;game_id:string;status:'nomination'|'open'|'finished'|'tie';winner_user_id:string|null;created_at:string;opened_at:string|null;closed_at:string|null};
type Candidate={id:string;election_id:string;user_id:string;created_at:string};
type District={id:string;game_id:string;district_key:string;title:string;head_user_id:string|null};
type DistrictMember={id:string;district_id:string;user_id:string;assignment_role:'head'|'member'};
type Result={status:string;winner_user_id?:string|null;turnout:number;results?:{candidate_id:string;user_id:string;votes:number}[]};

export default function MunicipalGovernancePanel({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,setError}=g;
 const [elections,setElections]=useState<Election[]>([]);
 const [candidates,setCandidates]=useState<Candidate[]>([]);
 const [districts,setDistricts]=useState<District[]>([]);
 const [districtMembers,setDistrictMembers]=useState<DistrictMember[]>([]);
 const [results,setResults]=useState<Record<string,Result>>({});
 const [voteCandidate,setVoteCandidate]=useState('');
 const [headPick,setHeadPick]=useState<Record<string,string>>({});
 const [memberPick,setMemberPick]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);

 async function load(){
  if(!game)return;
  await supabase.rpc('ensure_municipal_districts',{p_game_id:game.id});
  const [e,c,d,m]=await Promise.all([
   supabase.from('municipal_mayor_elections').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('municipal_mayor_candidates').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('municipal_districts').select('*').eq('game_id',game.id).order('title'),
   supabase.from('municipal_district_members').select('*').eq('game_id',game.id).order('created_at')
  ]);
  if(!e.error){
   const rows=(e.data||[]) as Election[];setElections(rows);
   const rr:Record<string,Result>={};
   await Promise.all(rows.slice(0,3).map(async x=>{
    const q=await supabase.rpc('get_municipal_mayor_results',{p_election_id:x.id});
    if(!q.error&&q.data)rr[x.id]=q.data as Result;
   }));
   setResults(rr);
  }
  if(!c.error)setCandidates((c.data||[]) as Candidate[]);
  if(!d.error)setDistricts((d.data||[]) as District[]);
  if(!m.error)setDistrictMembers((m.data||[]) as DistrictMember[]);
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('municipal-governance:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'municipal_mayor_elections',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'municipal_mayor_candidates',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'municipal_districts',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'municipal_district_members',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const activeGame=game;
 const latest=elections[0];
 const latestCandidates=latest?candidates.filter(x=>x.election_id===latest.id):[];
 const latestResult=latest?results[latest.id]:undefined;
 const mayor=latest?.status==='finished'?latest.winner_user_id:null;
 const isMayor=mayor===me.user_id;
 const name=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';
 const availableStudents=members.filter(m=>m.kind==='student');
 const assignedIds=new Set(districtMembers.map(x=>x.user_id));

 async function createElection(){
  setBusy(true);const r=await supabase.rpc('create_municipal_mayor_election',{p_game_id:activeGame.id});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function nominate(uid:string){
  if(!latest)return;setBusy(true);const r=await supabase.rpc('nominate_municipal_mayor',{p_election_id:latest.id,p_user_id:uid});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function openElection(){
  if(!latest)return;setBusy(true);const r=await supabase.rpc('open_municipal_mayor_election',{p_election_id:latest.id});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function cast(){
  if(!latest||!voteCandidate)return;setBusy(true);const r=await supabase.rpc('cast_municipal_mayor_ballot',{p_election_id:latest.id,p_candidate_id:voteCandidate});
  if(r.error)setError(r.error.message);else{setVoteCandidate('');await load()}setBusy(false);
 }
 async function closeElection(){
  if(!latest)return;setBusy(true);const r=await supabase.rpc('close_municipal_mayor_election',{p_election_id:latest.id});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function appointHead(districtId:string){
  const uid=headPick[districtId];if(!uid)return;setBusy(true);const r=await supabase.rpc('appoint_municipal_district_head',{p_district_id:districtId,p_user_id:uid});
  if(r.error)setError(r.error.message);else{setHeadPick(v=>({...v,[districtId]:''}));await load()}setBusy(false);
 }
 async function addMember(districtId:string){
  const uid=memberPick[districtId];if(!uid)return;setBusy(true);const r=await supabase.rpc('assign_municipal_district_member',{p_district_id:districtId,p_user_id:uid});
  if(r.error)setError(r.error.message);else{setMemberPick(v=>({...v,[districtId]:''}));await load()}setBusy(false);
 }
 async function removeMember(id:string){
  setBusy(true);const r=await supabase.rpc('remove_municipal_district_member',{p_assignment_id:id});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }

 return <section className="municipalGovernance">
  <header className="municipalGovernanceHead">
   <div><small>МУНИЦИПАЛЬНАЯ ВЛАСТЬ · ЭТАП 14</small><h2>Администрация города Барнаула</h2><p>Сначала избирается глава города тайным голосованием, затем он назначает пять глав районных администраций, после чего студенты распределяются по пяти районным командам.</p></div>
   <div className="municipalMayorStatus"><small>ГЛАВА ГОРОДА</small><strong>{mayor?name(mayor):latest?.status==='open'?'Выборы идут':'Не избран'}</strong><span>{latestResult?.turnout??0} голосов подано</span></div>
  </header>

  <section className="mayorElection">
   <div className="mayorElectionTitle"><div><small>14.1 · ТАЙНОЕ ГОЛОСОВАНИЕ</small><h3>Выборы главы Барнаула</h3></div><span>{latest?latest.status:'не запущены'}</span></div>
   {!latest&&teacher&&<button className="primary" disabled={busy} onClick={()=>void createElection()}>Создать выборы главы города</button>}
   {latest?.status==='nomination'&&<>
    <div className="mayorCandidates">{latestCandidates.map(x=><span key={x.id}>{name(x.user_id)}</span>)}</div>
    <div className="mayorNominationActions">
     {!latestCandidates.some(x=>x.user_id===me.user_id)&&<button className="secondary" disabled={busy||me.kind!=='student'} onClick={()=>void nominate(me.user_id)}>Выдвинуть свою кандидатуру</button>}
     {teacher&&<><select value={voteCandidate} onChange={e=>setVoteCandidate(e.target.value)}><option value="">Добавить кандидата преподавателем…</option>{availableStudents.filter(s=>!latestCandidates.some(c=>c.user_id===s.user_id)).map(s=><option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select><button className="secondary" disabled={busy||!voteCandidate} onClick={()=>void nominate(voteCandidate)}>Добавить</button><button className="primary" disabled={busy||latestCandidates.length===0} onClick={()=>void openElection()}>Открыть тайное голосование</button></>}
    </div>
   </>}
   {latest?.status==='open'&&<div className="mayorBallot"><b>Ваш тайный бюллетень</b><p>Текущий выбор других студентов не отображается. До закрытия голосования показывается только явка.</p><select value={voteCandidate} onChange={e=>setVoteCandidate(e.target.value)}><option value="">Выберите кандидата…</option>{latestCandidates.map(x=><option key={x.id} value={x.id}>{name(x.user_id)}</option>)}</select><button className="primary" disabled={busy||!voteCandidate||me.kind!=='student'} onClick={()=>void cast()}>Отдать голос</button>{teacher&&<button className="secondary" disabled={busy} onClick={()=>void closeElection()}>Закрыть и подсчитать</button>}<span>Явка: {latestResult?.turnout??0}</span></div>}
   {latest&&['finished','tie'].includes(latest.status)&&<div className="mayorResult"><b>{latest.status==='finished'?'Победитель: '+name(latest.winner_user_id):'Ничья: требуется повторное голосование'}</b>{latestResult?.results&&<div>{latestResult.results.map(x=><span key={x.candidate_id}>{name(x.user_id)} · <strong>{x.votes}</strong></span>)}</div>}{teacher&&latest.status==='tie'&&<button className="secondary" onClick={()=>void createElection()}>Создать повторное голосование</button>}</div>}
  </section>

  <section className="districtAdministrations">
   <div className="districtAdministrationsHead"><div><small>14.2–14.3 · ПЯТЬ РАЙОНОВ</small><h3>Главы и команды районных администраций</h3></div><span>{districtMembers.length}/{availableStudents.length} распределено</span></div>
   <div className="districtGrid">{districts.map(d=>{
    const team=districtMembers.filter(x=>x.district_id===d.id);
    const canManage=teacher||isMayor||d.head_user_id===me.user_id;
    return <article key={d.id} className={d.head_user_id?'staffed':''}>
     <header><div><small>РАЙОН</small><h4>{d.title}</h4></div><span>{team.length} чел.</span></header>
     <div className="districtHead"><small>ГЛАВА АДМИНИСТРАЦИИ</small><b>{name(d.head_user_id)}</b>{(teacher||isMayor)&&<div><select value={headPick[d.id]||''} onChange={e=>setHeadPick(v=>({...v,[d.id]:e.target.value}))}><option value="">Назначить главу…</option>{availableStudents.filter(s=>!districts.some(x=>x.head_user_id===s.user_id)||d.head_user_id===s.user_id).map(s=><option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select><button disabled={busy||!headPick[d.id]} onClick={()=>void appointHead(d.id)}>Назначить</button></div>}</div>
     <div className="districtMembers">{team.map(x=><div key={x.id}><b>{name(x.user_id)}</b><span>{x.assignment_role==='head'?'глава':'муниципальный служащий'}</span>{canManage&&x.assignment_role==='member'&&<IconAction variant="remove" onClick={()=>void removeMember(x.id)} label={'Исключить муниципального служащего '+name(x.user_id)}/>}</div>)}</div>
     {canManage&&d.head_user_id&&<div className="districtAdd"><select value={memberPick[d.id]||''} onChange={e=>setMemberPick(v=>({...v,[d.id]:e.target.value}))}><option value="">Добавить в команду…</option>{availableStudents.filter(s=>!assignedIds.has(s.user_id)).map(s=><option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select><button disabled={busy||!memberPick[d.id]} onClick={()=>void addMember(d.id)}>Добавить</button></div>}
    </article>
   })}</div>
  </section>
 </section>;
}
