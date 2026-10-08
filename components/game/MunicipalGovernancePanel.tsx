'use client';
import {IconAction} from '../ui/IconAction';
import StageModuleHeader from '../ui/StageModuleHeader';
import StyledSelect from '../ui/StyledSelect';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';
import styles from './MunicipalStages.module.css';

type Election={id:string;game_id:string;status:'nomination'|'open'|'finished'|'tie';winner_user_id:string|null;created_at:string;opened_at:string|null;closed_at:string|null};
type Candidate={id:string;election_id:string;user_id:string;created_at:string};
type District={id:string;game_id:string;district_key:string;title:string;head_user_id:string|null};
type DistrictMember={id:string;district_id:string;user_id:string;assignment_role:'head'|'member'};
type Result={status:string;winner_user_id?:string|null;turnout:number;results?:{candidate_id:string;user_id:string;votes:number}[]};
const electionStatus:Record<Election['status'],string>={nomination:'Выдвижение кандидатов',open:'Тайное голосование',finished:'Выборы завершены',tie:'Повторное голосование'};

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
 const scopeKey=[game?.id,me?.user_id,me?.kind,me?.role_title,me?.roster_archived_at,teacher].join('|');
 const scope=useRef(scopeKey),generation=useRef(0),request=useRef(0),busyRef=useRef(false);
 const [stateScope,setStateScope]=useState(scopeKey);
 scope.current=scopeKey;
 const renderGeneration=generation.current;
 useEffect(()=>{
  generation.current++;request.current++;busyRef.current=false;
  setStateScope(scopeKey);setElections([]);setCandidates([]);setDistricts([]);setDistrictMembers([]);setResults({});
  setVoteCandidate('');setHeadPick({});setMemberPick({});setBusy(false);
  return()=>{generation.current++;request.current++;};
 },[scopeKey]);

 async function load(){
  if(!game||!me||me.roster_archived_at)return;
  const key=scopeKey,epoch=generation.current,sequence=++request.current;
  const current=()=>scope.current===key&&generation.current===epoch&&request.current===sequence;
  try{
  const ensured=await supabase.rpc('ensure_municipal_districts',{p_game_id:game.id});
  if(!current())return;
  if(ensured.error){setError(ensured.error.message);return;}
  const [e,c,d,m]=await Promise.all([
   supabase.from('municipal_mayor_elections').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('municipal_mayor_candidates').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('municipal_districts').select('*').eq('game_id',game.id).order('title'),
   supabase.from('municipal_district_members').select('*').eq('game_id',game.id).order('created_at')
  ]);
  if(!current())return;
  const failure=[e,c,d,m].find(x=>x.error);if(failure?.error){setError(failure.error.message);return;}
   const rows=(e.data||[]) as Election[];
   const rr:Record<string,Result>={};
   await Promise.all(rows.slice(0,3).map(async x=>{
    const q=await supabase.rpc('get_municipal_mayor_results',{p_election_id:x.id});
    if(q.error)throw new Error(q.error.message);
    if(q.data)rr[x.id]=q.data as Result;
   }));
   if(!current())return;
   setElections(rows);setResults(rr);setCandidates((c.data||[]) as Candidate[]);
   setDistricts((d.data||[]) as District[]);setDistrictMembers((m.data||[]) as DistrictMember[]);
  }catch(error){if(current())setError(error instanceof Error?error.message:String(error));}
 }
 useGameTableSync(game?.id,['municipal_mayor_elections','municipal_mayor_candidates','municipal_mayor_ballots','municipal_districts','municipal_district_members'],load,scopeKey);
 const latest=elections[0];
 useEffect(()=>{setVoteCandidate('');},[latest?.id,latest?.status]);

 if(!game||!me||me.roster_archived_at||stateScope!==scopeKey)return null;
 const activeGame=game;
 const latestCandidates=latest?candidates.filter(x=>x.election_id===latest.id):[];
 const latestResult=latest?results[latest.id]:undefined;
 const mayor=latest?.status==='finished'?latest.winner_user_id:null;
 const isMayor=mayor===me.user_id;
 const name=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';
 const availableStudents=members.filter(m=>m.kind==='student'&&!m.roster_archived_at);
 const assignedIds=new Set(districtMembers.map(x=>x.user_id));

 async function act(name:string,args:Record<string,unknown>,after?:()=>void){
  if(busyRef.current||scope.current!==scopeKey||generation.current!==renderGeneration)return;
  const key=scopeKey,epoch=generation.current;
  const current=()=>scope.current===key&&generation.current===epoch;
  busyRef.current=true;setBusy(true);
  try{const r=await supabase.rpc(name,args);if(!current())return;if(r.error)setError(r.error.message);else{after?.();await load();}}
  catch(error){if(current())setError(error instanceof Error?error.message:String(error));}
  finally{if(current()){busyRef.current=false;setBusy(false);}}
 }
 async function createElection(){
  if(teacher)await act('create_municipal_mayor_election',{p_game_id:activeGame.id});
 }
 async function nominate(uid:string){
  if(latest?.status!=='nomination'||(!teacher&&me?.user_id!==uid))return;
  await act('nominate_municipal_mayor',{p_election_id:latest.id,p_user_id:uid},()=>setVoteCandidate(current=>current===uid?'':current));
 }
 async function openElection(){
  if(!teacher||latest?.status!=='nomination')return;
  await act('open_municipal_mayor_election',{p_election_id:latest.id});
 }
 async function cast(){
  if(latest?.status!=='open'||!voteCandidate||me?.kind!=='student')return;
  const choice=voteCandidate;
  await act('cast_municipal_mayor_ballot',{p_election_id:latest.id,p_candidate_id:choice},()=>setVoteCandidate(current=>current===choice?'':current));
 }
 async function closeElection(){
  if(!teacher||latest?.status!=='open')return;
  await act('close_municipal_mayor_election',{p_election_id:latest.id});
 }
 async function appointHead(districtId:string){
  const uid=headPick[districtId];if(!uid||(!teacher&&!isMayor))return;
  await act('appoint_municipal_district_head',{p_district_id:districtId,p_user_id:uid},()=>setHeadPick(v=>v[districtId]===uid?{...v,[districtId]:''}:v));
 }
 async function addMember(districtId:string){
  const uid=memberPick[districtId],district=districts.find(d=>d.id===districtId);
  if(!uid||!district||(!teacher&&!isMayor&&district.head_user_id!==me?.user_id))return;
  await act('assign_municipal_district_member',{p_district_id:districtId,p_user_id:uid},()=>setMemberPick(v=>v[districtId]===uid?{...v,[districtId]:''}:v));
 }
 async function removeMember(id:string){
  const assignment=districtMembers.find(m=>m.id===id),district=districts.find(d=>d.id===assignment?.district_id);
  if(!assignment||assignment.assignment_role!=='member'||(!teacher&&!isMayor&&district?.head_user_id!==me?.user_id))return;
  await act('remove_municipal_district_member',{p_assignment_id:id});
 }

 return <section className={'municipalGovernance '+styles.panel}>
  <StageModuleHeader eyebrow="Муниципальная власть · Этап 14" title="Администрация города Барнаула" description="Сначала избирается глава города тайным голосованием. Он назначает пять глав районных администраций, затем студенты входят в состав муниципальных администраций." stats={[{label:'Глава города',value:mayor?name(mayor):latest?.status==='open'?'Выборы идут':'Не избран',detail:(latestResult?.turnout??0)+' голосов подано'}]}/>

  <section className="mayorElection">
   <div className="mayorElectionTitle"><div><small>14.1 · ТАЙНОЕ ГОЛОСОВАНИЕ</small><h3>Выборы главы Барнаула</h3></div><span>{latest?electionStatus[latest.status]:'Выборы не созданы'}</span></div>
   {!latest&&teacher&&<button className="primary" disabled={busy} onClick={()=>void createElection()}>Создать выборы главы города</button>}
   {latest?.status==='nomination'&&<>
    <div className="mayorCandidates">{latestCandidates.map(x=><span key={x.id}>{name(x.user_id)}</span>)}</div>
    <div className="mayorNominationActions">
     {!latestCandidates.some(x=>x.user_id===me.user_id)&&<button className="secondary" disabled={busy||me.kind!=='student'} onClick={()=>void nominate(me.user_id)}>Выдвинуть свою кандидатуру</button>}
     {teacher&&<><StyledSelect wrap label="Кандидат в главы города" value={voteCandidate} onChange={setVoteCandidate} disabled={busy} options={[{value:'',label:'Добавить кандидата преподавателем…'},...availableStudents.filter(s=>!latestCandidates.some(c=>c.user_id===s.user_id)).map(s=>({value:s.user_id,label:s.full_name}))]}/><button className="secondary" disabled={busy||!voteCandidate} onClick={()=>void nominate(voteCandidate)}>Добавить</button><button className="primary" disabled={busy||latestCandidates.length===0} onClick={()=>void openElection()}>Открыть тайное голосование</button></>}
    </div>
   </>}
   {latest?.status==='open'&&<div className="mayorBallot"><b>Ваш тайный бюллетень</b><p>Текущий выбор других студентов не отображается. До закрытия голосования показывается только явка.</p><StyledSelect wrap label="Кандидат в тайном бюллетене" value={voteCandidate} onChange={setVoteCandidate} disabled={busy||me.kind!=='student'} options={[{value:'',label:'Выберите кандидата…'},...latestCandidates.map(x=>({value:x.id,label:name(x.user_id)}))]}/><button className="primary" disabled={busy||!voteCandidate||me.kind!=='student'} onClick={()=>void cast()}>Отдать голос</button>{teacher&&<button className="secondary" disabled={busy} onClick={()=>void closeElection()}>Закрыть и подсчитать</button>}<span>Явка: {latestResult?.turnout??0}</span></div>}
   {latest&&['finished','tie'].includes(latest.status)&&<div className="mayorResult"><b>{latest.status==='finished'?'Победитель: '+name(latest.winner_user_id):'Ничья: требуется повторное голосование'}</b>{latestResult?.results&&<div>{latestResult.results.map(x=><span key={x.candidate_id}>{name(x.user_id)} · <strong>{x.votes}</strong></span>)}</div>}{teacher&&latest.status==='tie'&&<button className="secondary" onClick={()=>void createElection()}>Создать повторное голосование</button>}</div>}
  </section>

  <section className="districtAdministrations">
   <div className="districtAdministrationsHead"><div><small>14.2–14.3 · ПЯТЬ РАЙОНОВ</small><h3>Главы и состав районных администраций</h3></div><span>{districtMembers.length}/{availableStudents.length} распределено</span></div>
   <div className="districtGrid">{districts.map(d=>{
    const staff=districtMembers.filter(x=>x.district_id===d.id);
    const canManage=teacher||isMayor||d.head_user_id===me.user_id;
    return <article key={d.id} className={d.head_user_id?'staffed':''}>
     <header><div><small>РАЙОН</small><h4>{d.title}</h4></div><span>{staff.length} чел.</span></header>
     <div className="districtHead"><small>ГЛАВА АДМИНИСТРАЦИИ</small><b>{name(d.head_user_id)}</b>{(teacher||isMayor)&&<div><StyledSelect wrap label={'Глава администрации · '+d.title} value={headPick[d.id]||''} onChange={value=>setHeadPick(v=>({...v,[d.id]:value}))} disabled={busy} options={[{value:'',label:'Назначить главу…'},...availableStudents.filter(s=>!districts.some(x=>x.head_user_id===s.user_id)||d.head_user_id===s.user_id).map(s=>({value:s.user_id,label:s.full_name}))]}/><button disabled={busy||!headPick[d.id]} onClick={()=>void appointHead(d.id)}>Назначить</button></div>}</div>
     <div className="districtMembers">{staff.map(x=><div key={x.id}><b>{name(x.user_id)}</b><span>{x.assignment_role==='head'?'глава':'муниципальный служащий'}</span>{canManage&&x.assignment_role==='member'&&<IconAction variant="remove" disabled={busy} onClick={()=>void removeMember(x.id)} label={'Исключить муниципального служащего '+name(x.user_id)}/>}</div>)}</div>
     {canManage&&d.head_user_id&&<div className="districtAdd"><StyledSelect wrap label={'Состав администрации · '+d.title} value={memberPick[d.id]||''} onChange={value=>setMemberPick(v=>({...v,[d.id]:value}))} disabled={busy} options={[{value:'',label:'Добавить муниципального служащего…'},...availableStudents.filter(s=>!assignedIds.has(s.user_id)).map(s=>({value:s.user_id,label:s.full_name}))]}/><button disabled={busy||!memberPick[d.id]} onClick={()=>void addMember(d.id)}>Добавить</button></div>}
    </article>
   })}</div>
  </section>
 </section>;
}
