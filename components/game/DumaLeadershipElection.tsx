'use client';
import {userError} from '@/lib/userError';
import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {Landmark,ClipboardList,CheckCircle2,FileClock} from 'lucide-react';
import {isStageWorkOpen} from './stageWorkStatus';
import {GAME_DATA_REFRESH_EVENT,notifyGameDataRefresh,useGameTableSync} from './useGameTableSync';

type Election={id:string;game_id:string;office_key:'gd_chair'|'gd_deputy_1'|'gd_deputy_2';office_title:string;round_no:1|2;vote_mode:'open'|'secret';status:'nomination'|'open'|'closed'|'finished';ballot_mode?:'faction'|'personal';winner_candidate_id:string|null;parent_election_id:string|null;created_at:string};
type OfficeCandidate={id:string;election_id:string;user_id:string;party_id:string;created_at:string};
type OfficeBallot={id:string;election_id:string;party_id:string;candidate_id:string;votes:number;submitted_by:string;updated_at:string};
type ElectionState=Pick<Election,'id'|'status'|'vote_mode'|'ballot_mode'|'winner_candidate_id'>;

const offices=[
 ['gd_chair','Председатель ГД'],
 ['gd_deputy_1','Заместитель №1'],
 ['gd_deputy_2','Заместитель №2']
] as const;
function sameElectionState(left:ElectionState[],right:ElectionState[]){
 const previous=new Map(left.map(row=>[row.id,row]));
 return previous.size===right.length&&right.every(row=>{
  const old=previous.get(row.id);
  return !!old&&old.status===row.status&&old.vote_mode===row.vote_mode&&old.ballot_mode===row.ballot_mode&&old.winner_candidate_id===row.winner_candidate_id;
 });
}

export default function DumaLeadershipElection({g,onOpenVotes}:{g:ReturnTypeRepublic;onOpenVotes?:(id?:string)=>void}){
 const {game,me,teacher,members,parties,setError,gdMandateCapacity,gdEffectivePresence}=g;
 const [elections,setElections]=useState<Election[]>([]);
 const [candidates,setCandidates]=useState<OfficeCandidate[]>([]);
 const [ballots,setBallots]=useState<OfficeBallot[]>([]);
 const [personalBallots,setPersonalBallots]=useState<{election_id:string;voter_id:string;party_id:string;candidate_id:string}[]>([]);
 const [personalMandates,setPersonalMandates]=useState<{user_id:string;party_id:string;base_mandates:number;effective_mandates:number}[]>([]);
 const [registrations,setRegistrations]=useState<{user_id:string;stage_no:number;institution_key:string;present_mandates:number|null}[]>([]);
 const [procedureVotes,setProcedureVotes]=useState<{id:string;status:string;result_code:string|null}[]>([]);
 const [canCoordinate,setCanCoordinate]=useState(false);
 const [office,setOffice]=useState<(typeof offices)[number][0]>('gd_chair');
 const [mode,setMode]=useState<'open'|'secret'>('open');
 const [nominee,setNominee]=useState<Record<string,string>>({});
 const [voteDraft,setVoteDraft]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const electionsRef=useRef(elections);electionsRef.current=elections;
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const stageActive=isStageWorkOpen(game,g.stages.find(st=>st.stage_no===4));
 const scope=JSON.stringify([game?.id,game?.status,stageActive,me?.user_id,me?.kind,me?.role_title,me?.team,me?.roster_archived_at,teacher]);
 const activeScope=useRef(scope),alive=useRef(true),mutationScope=useRef<string|null>(null);activeScope.current=scope;
 const [dataScope,setDataScope]=useState(scope);
 const reads=useRef({scope,promise:null as Promise<void>|null,queued:false,explicit:false,cancel:null as (()=>void)|null});
 if(reads.current.scope!==scope)reads.current={scope,promise:null,queued:false,explicit:false,cancel:null};
 const readState=reads.current;
 const invalidations=useRef({scope,full:true,tables:new Set<string>(),lastFull:0});
 if(invalidations.current.scope!==scope)invalidations.current={scope,full:true,tables:new Set<string>(),lastFull:0};
 const pending=invalidations.current;
 const scopeCurrent=()=>alive.current&&activeScope.current===scope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>{
  setElections([]);setCandidates([]);setBallots([]);setPersonalBallots([]);setPersonalMandates([]);setRegistrations([]);setProcedureVotes([]);setCanCoordinate(false);setNominee({});setVoteDraft({});setBusy(false);setDataScope(scope);
  return()=>{readState.cancel?.()};
 },[scope]);
 async function load(background=false){
  if(!game||!me||!scopeCurrent()||background&&document.visibilityState!=='visible')return;
  const state=reads.current;state.explicit=state.explicit||!background;
  if(state.promise){state.queued=true;return state.promise}
  state.promise=(async()=>{
   let reconciliationRetries=0;
   do{
    state.queued=false;const passive=!state.explicit;state.explicit=false;
    const ballotOnly=passive&&!pending.full&&pending.tables.size>0&&[...pending.tables].every(table=>table==='office_ballots'||table==='office_personal_ballots');
    if(passive&&!pending.full&&!pending.tables.size&&Date.now()-pending.lastFull<180000)continue;
    const ballotTables=new Set(pending.tables);pending.tables.clear();pending.full=false;
    let succeeded=false,escalating=false;
    const controller=new AbortController();
    const current=()=>scopeCurrent()&&!controller.signal.aborted&&(!passive||document.visibilityState==='visible');
    const reconcile=()=>{
     if(reconciliationRetries>=2){pending.full=true;state.queued=false;state.explicit=false;setError('Результаты выборов продолжают меняться. Повторите обновление через несколько секунд.');return}
     reconciliationRetries++;state.explicit=true;state.queued=true;escalating=true;
    };
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try{
     await Promise.race([(async()=>{
      // Read elections before full ballot snapshots so a closed secret vote is not paired with an older partial snapshot.
      const [e,c,fastB,fastP]=await Promise.all([
       (ballotOnly?supabase.from('office_elections').select('id,status,vote_mode,ballot_mode,winner_candidate_id'):supabase.from('office_elections').select('*')).eq('game_id',game.id).eq('stage_no',4).in('office_key',['gd_chair','gd_deputy_1','gd_deputy_2']).order('created_at',{ascending:true}).abortSignal(controller.signal),
       ballotOnly?null:supabase.from('office_candidates').select('*').eq('game_id',game.id).order('created_at').abortSignal(controller.signal),
       ballotOnly&&ballotTables.has('office_ballots')?supabase.from('office_ballots').select('*').eq('game_id',game.id).abortSignal(controller.signal):null,
       ballotOnly&&ballotTables.has('office_personal_ballots')?supabase.from('office_personal_ballots').select('election_id,voter_id,party_id,candidate_id').eq('game_id',game.id).abortSignal(controller.signal):null
      ]);
      if(!current())return;
      if(e.error){setError(userError(e.error));return}
      const next=(e.data||[]) as ElectionState[];
      // A transition may reveal all secret ballots, create a runoff or change meeting permissions.
      if(ballotOnly&&!sameElectionState(electionsRef.current,next)){reconcile();return}
      const [b,p,m,r]=await Promise.all([
       ballotOnly?fastB:supabase.from('office_ballots').select('*').eq('game_id',game.id).abortSignal(controller.signal),
       ballotOnly?fastP:supabase.from('office_personal_ballots').select('election_id,voter_id,party_id,candidate_id').eq('game_id',game.id).abortSignal(controller.signal),
       ballotOnly?null:supabase.from('party_member_mandates').select('user_id,party_id,base_mandates,effective_mandates').eq('game_id',game.id).abortSignal(controller.signal),
       ballotOnly?null:supabase.from('institution_session_registrations').select('user_id,stage_no,institution_key,present_mandates').eq('game_id',game.id).eq('stage_no',4).eq('institution_key','gd').abortSignal(controller.signal)
      ]);
      if(!current())return;
      const checkSecret=next.some(row=>row.vote_mode==='secret'&&row.status==='open');
      const [v,permissions,confirmation]=await Promise.all([
       ballotOnly?null:supabase.from('game_votes').select('id,status,result_code').eq('game_id',game.id).eq('stage_no',4).eq('procedure_key','gd_leadership_procedure').abortSignal(controller.signal),
       ballotOnly?null:supabase.rpc('get_my_institution_meeting_permissions',{p_game_id:game.id,p_stage_no:4,p_institution:'gd'}).abortSignal(controller.signal),
       checkSecret?supabase.from('office_elections').select('id,status,vote_mode,ballot_mode,winner_candidate_id').eq('game_id',game.id).eq('stage_no',4).in('office_key',['gd_chair','gd_deputy_1','gd_deputy_2']).order('created_at',{ascending:true}).abortSignal(controller.signal):null
      ]);
      if(!current())return;
      if(confirmation?.error){setError(userError(confirmation.error));return}
      if(confirmation&&!sameElectionState(next,(confirmation.data||[]) as ElectionState[])){reconcile();return}
      const error=[c,b,p,m,r,v,permissions].find(x=>x?.error)?.error;
      if(error)setError(userError(error));
      const changed=!sameElectionState(electionsRef.current,next);
      // Preserve the last coherent snapshot when either ballot read fails during a transition.
      const coherent=!changed||!(b?.error||p?.error);
      if(coherent){if(!ballotOnly){electionsRef.current=next as Election[];setElections(next as Election[])}if(b&&!b.error)setBallots((b.data||[]) as OfficeBallot[]);if(p&&!p.error)setPersonalBallots(p.data||[])}
      if(c&&!c.error)setCandidates((c.data||[]) as OfficeCandidate[]);
      if(m&&!m.error)setPersonalMandates(m.data||[]);
      if(r&&!r.error)setRegistrations(r.data||[]);
      if(v&&!v.error)setProcedureVotes(v.data||[]);
      if(permissions&&!permissions.error)setCanCoordinate(!!permissions.data?.can_coordinate);
      succeeded=!error;
     })(),new Promise<never>((_,reject)=>{
      state.cancel=()=>{clearTimeout(timeout);controller.abort();reject(new Error('Обновление выборов отменено.'))};
      timeout=setTimeout(()=>{controller.abort();reject(new Error('Не удалось обновить выборы: сервер не ответил вовремя.'))},12000);
     })]);
    }catch(error){if(scopeCurrent()&&(!passive||document.visibilityState==='visible'))setError(userError(error))}
    finally{
     clearTimeout(timeout);state.cancel=null;
     if(succeeded&&!ballotOnly)pending.lastFull=Date.now();
     else if(!succeeded&&!escalating){if(ballotOnly)for(const table of ballotTables)pending.tables.add(table);else pending.full=true}
    }
   }while(state.queued&&scopeCurrent());
  })().finally(()=>{state.promise=null});
  return state.promise;
 }
 useEffect(()=>{
  if(!game)return;
  const tables=['office_elections','office_candidates','office_ballots','office_personal_ballots','party_member_mandates','game_votes','institution_session_registrations'];
  const local=(event:Event)=>{
   const detail=(event as CustomEvent<{gameId?:string;table?:string}>).detail;
   if(!scopeCurrent()||detail?.gameId!==game.id)return;
   if(!detail.table)pending.full=true;
   else if(tables.includes(detail.table)){
    if(detail.table==='office_ballots'||detail.table==='office_personal_ballots')pending.tables.add(detail.table);
    else pending.full=true;
   }
  };
  const recover=()=>{pending.full=true};
  window.addEventListener(GAME_DATA_REFRESH_EVENT,local);window.addEventListener('focus',recover);window.addEventListener('online',recover);document.addEventListener('visibilitychange',recover);
  return()=>{window.removeEventListener(GAME_DATA_REFRESH_EVENT,local);window.removeEventListener('focus',recover);window.removeEventListener('online',recover);document.removeEventListener('visibilitychange',recover)};
 },[scope]);
 useGameTableSync(me?.user_id?game?.id:undefined,['office_elections','office_candidates','office_ballots','office_personal_ballots','party_member_mandates','game_votes','institution_session_registrations'],()=>load(true),scope,undefined,3000,180000);
 useEffect(()=>{
  if(!game||!me)return;
  const refresh=(table:string,payload:{eventType?:string;new?:Record<string,unknown>}|undefined)=>{
   if(!scopeCurrent())return;
   if(payload?.new?.game_id&&payload.new.game_id!==game.id)return;
   const row=payload?.new;
   const fields=table==='office_elections'?['id','office_key','status']:table==='office_candidates'?['id','election_id','user_id']:table==='office_ballots'?['id','election_id','party_id','candidate_id']:table==='office_personal_ballots'?['election_id','voter_id','party_id','candidate_id']:['party_id','user_id'];
   const complete=(payload?.eventType==='INSERT'||payload?.eventType==='UPDATE')&&row?.game_id===game.id&&fields.every(field=>typeof row[field]==='string');
   if(!complete)pending.full=true;
   notifyGameDataRefresh(game.id,table);
  };
  let recoveryTimer:ReturnType<typeof setTimeout>|undefined,lastRecovery=0;
  const recoveryJitter=[...me.user_id].reduce((hash,char)=>(Math.imul(hash,31)+char.charCodeAt(0))>>>0,0)%1500;
  // These five published tables are watched only while this election panel is mounted.
  const ch=supabase.channel('duma-leadership:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'office_elections',filter:'game_id=eq.'+game.id},payload=>refresh('office_elections',payload))
   .on('postgres_changes',{event:'*',schema:'public',table:'office_candidates',filter:'game_id=eq.'+game.id},payload=>refresh('office_candidates',payload))
   .on('postgres_changes',{event:'*',schema:'public',table:'office_ballots',filter:'game_id=eq.'+game.id},payload=>refresh('office_ballots',payload))
   .on('postgres_changes',{event:'*',schema:'public',table:'office_personal_ballots',filter:'game_id=eq.'+game.id},payload=>refresh('office_personal_ballots',payload))
   .on('postgres_changes',{event:'*',schema:'public',table:'party_member_mandates',filter:'game_id=eq.'+game.id},payload=>refresh('party_member_mandates',payload))
   .subscribe(status=>{
    if(status!=='SUBSCRIBED'||!scopeCurrent())return;
    pending.full=true;
    if(recoveryTimer!==undefined)return;
    recoveryTimer=setTimeout(()=>{recoveryTimer=undefined;lastRecovery=Date.now();if(scopeCurrent())void load(true)},Math.max(recoveryJitter,lastRecovery+3000-Date.now()));
   });
  return()=>{clearTimeout(recoveryTimer);void supabase.removeChannel(ch)}
 },[scope]);

 const sorted=useMemo(()=>[...elections].sort((a,b)=>a.office_key.localeCompare(b.office_key)||a.round_no-b.round_no),[elections]);
 if(!game||!me||dataScope!==scope)return null;
 const activeGame=game;
 const activeMe=me;
 const member=(id:string)=>members.find(m=>m.user_id===id);
 const party=(id:string)=>parties.find(p=>p.id===id);
 const activeMandates=(partyId:string)=>personalMandates.filter(x=>x.party_id===partyId).reduce((a,x)=>a+Number(x.effective_mandates||0),0);
 const myMandates=personalMandates.find(m=>m.user_id===activeMe.user_id);
 const myAttendance=registrations.find(r=>r.user_id===activeMe.user_id)?.present_mandates;
 const myPresent=registrations.some(r=>r.user_id===activeMe.user_id)?gdEffectivePresence(activeMe.user_id,myAttendance):0;
 const myRegistered=registrations.some(r=>r.user_id===activeMe.user_id&&r.stage_no===4&&r.institution_key==='gd');
 const canPropose=stageActive&&activeMe.kind==='student'&&myRegistered&&myPresent>0;
 const canManage=stageActive&&(teacher||(canPropose&&canCoordinate));
 const myFaction=parties.find(p=>p.name===activeMe.team&&p.registration_status==='registered');
 const canNominate=stageActive&&(teacher||!!(canPropose&&(ledParty||myFaction)));
 const procedureApproved=procedureVotes.some(v=>v.status==='closed'&&v.result_code==='passed');
 const procedureOpen=procedureVotes.some(v=>v.status==='open');
 const electionCandidates=(id:string)=>candidates.filter(c=>c.election_id===id);
 const electionBallots=(id:string)=>ballots.filter(b=>b.election_id===id);
 const totalFor=(eid:string,cid:string)=>{
  const election=elections.find(e=>e.id===eid);
  if(election?.ballot_mode==='personal')return personalBallots.filter(b=>b.election_id===eid&&b.candidate_id===cid)
    .reduce((total,b)=>total+gdEffectivePresence(b.voter_id,registrations.find(r=>r.user_id===b.voter_id)?.present_mandates),0);
  return electionBallots(eid).filter(b=>b.candidate_id===cid).reduce((a,b)=>a+Number(b.votes||0),0);
 };
 const usedByParty=(eid:string,pid:string)=>electionBallots(eid).filter(b=>b.party_id===pid).reduce((a,b)=>a+Number(b.votes||0),0);

 async function change(request:()=>PromiseLike<{error:unknown}>,table:string,after?:()=>void|Promise<void>){
  if(!scopeCurrent()||!stageActive||mutationScope.current===scope)return;
  mutationScope.current=scope;setBusy(true);
  try{
   const r=await request();if(!scopeCurrent())return;
   if(r.error)setError(userError(r.error));else{notifyGameDataRefresh(activeGame.id,table);await load();if(scopeCurrent())await after?.()}
  }catch(error){if(scopeCurrent())setError(userError(error))}
  finally{if(mutationScope.current===scope)mutationScope.current=null;if(scopeCurrent())setBusy(false)}
 }
 async function openProcedureVote(){await change(()=>supabase.rpc('open_duma_leadership_procedure_vote',{p_game_id:activeGame.id}),'game_votes',()=>g.refresh())}
 async function createElection(){
  if(!selectedOffice||electedKeys.has(selectedOffice)||activeKeys.has(selectedOffice))return;
  await change(()=>supabase.rpc('create_office_election',{p_game_id:activeGame.id,p_office_key:selectedOffice,p_vote_mode:mode}),'office_elections');
 }
 async function nominate(electionId:string){
  const userId=nominee[electionId];if(!userId)return;
  await change(()=>supabase.rpc('nominate_office_candidate',{p_election_id:electionId,p_user_id:userId}),'office_candidates',()=>setNominee(v=>({...v,[electionId]:''})));
 }
 async function open(electionId:string){await change(()=>supabase.rpc('open_office_election',{p_election_id:electionId}),'office_elections')}
 async function vote(electionId:string,candidateId:string){
  const value=Math.max(0,Number(voteDraft[electionId+'-'+candidateId])||0);
  await change(()=>supabase.rpc('set_office_ballot',{p_election_id:electionId,p_candidate_id:candidateId,p_votes:value}),'office_ballots');
 }
 async function personalVote(electionId:string,candidateId:string){await change(()=>supabase.rpc('cast_personal_office_ballot',{p_election_id:electionId,p_candidate_id:candidateId}),'office_personal_ballots')}
 async function close(electionId:string){await change(()=>supabase.rpc('close_office_election',{p_election_id:electionId}),'office_elections')}

 const electedKeys=new Set(elections.filter(e=>e.status==='finished'&&e.winner_candidate_id).map(e=>e.office_key));
 const activeKeys=new Set(elections.filter(e=>e.status==='nomination'||e.status==='open').map(e=>e.office_key));
 const availableOffices=offices.filter(([key])=>!electedKeys.has(key)&&!activeKeys.has(key));
 const selectedOffice=availableOffices.some(([key])=>key===office)?office:availableOffices[0]?.[0];
 const pendingSecondRounds=elections.filter(e=>e.round_no===2&&(e.status==='nomination'||e.status==='open'));
 const repeatNeeded=elections.filter(e=>e.status==='closed'&&!e.winner_candidate_id
  &&!electedKeys.has(e.office_key)&&!activeKeys.has(e.office_key)
  &&elections.filter(t=>t.office_key===e.office_key).every(t=>t.status==='closed'));
 const displayedElections=sorted.filter(e=>!(['nomination','closed'].includes(e.status)&&electionCandidates(e.id).length===0&&electedKeys.has(e.office_key)));


 return <section className="dumaElection">
  <header className="dumaElectionHead">
   <div className="dumaElectionIntro">
    <div className="dumaElectionEyebrow"><Landmark size={17} aria-hidden="true"/><span>Государственная Дума</span><span className="dumaElectionStage">Этап 4</span></div>
    <h2>Избрание руководства Государственной Думы</h2>
    <p>После регистрации депутаты утверждают порядок выборов. Фракции выдвигают кандидатов, затем проводится голосование. Депутат распоряжается своими действующими мандатами с учётом гоствойтинга.</p>
   </div>
   <div className="dumaThreshold" aria-label="Для избрания необходимо 226 голосов из 450">
    <span>Необходимое большинство</span><strong>226 <small>из 450</small></strong><em>голосов для избрания</em>
   </div>
  </header>

  <div className="dumaElectionProcedure" data-procedure-status={procedureApproved?'approved':procedureOpen?'in-progress':'pending'}>
   <span className="dumaElectionProcedureIcon" aria-hidden="true">{procedureApproved?<CheckCircle2 size={22}/>:<ClipboardList size={22}/>}</span>
   <div className="dumaElectionProcedureText"><b>Утверждение порядка выборов</b><p>{procedureApproved?'Порядок утверждён. Можно выдвигать кандидатов.':procedureOpen?'Голосование по порядку выборов открыто в разделе «Голосование».':'Сначала зарегистрированные депутаты должны проголосовать по порядку избрания руководства.'}</p></div>
   {(teacher||canPropose)&&!procedureApproved&&!procedureOpen&&<button type="button" className="primary" disabled={busy||!stageActive} onClick={()=>void openProcedureVote()}>{teacher?'Открыть голосование':'Предложить утверждение порядка'}</button>}
    {procedureOpen&&onOpenVotes&&<button type="button" className="secondary" onClick={()=>onOpenVotes(procedureVotes.find(v=>v.status==='open')?.id)}>Перейти к голосованию</button>}
  </div>
  {(pendingSecondRounds.length>0||repeatNeeded.length>0)&&<div className="officeRoundNotice" role="status" aria-live="polite">
    {pendingSecondRounds.length>0&&<span><b className="officeRoundCount">{pendingSecondRounds.length}</b> Второй тур назначен. Зарегистрированные депутаты должны проголосовать повторно.</span>}
    {repeatNeeded.length>0&&<span><b className="officeRoundCount">{repeatNeeded.length}</b> Требуются повторные выборы: ни один кандидат не получил большинства.</span>}
   </div>}
  {canManage&&availableOffices.length>0&&<div className="dumaElectionCreator"><label>Должность<select value={selectedOffice} onChange={e=>setOffice(e.target.value as typeof office)}>{availableOffices.map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Форма голосования<select value={mode} onChange={e=>setMode(e.target.value as 'open'|'secret')}><option value="open">Открытое</option><option value="secret">Тайное</option></select></label><button className="primary" disabled={busy||!procedureApproved||!stageActive||!selectedOffice} onClick={()=>void createElection()}>{repeatNeeded.some(e=>e.office_key===selectedOffice)?'Назначить повторные выборы':'Создать процедуру'}</button></div>}
  {canManage&&availableOffices.length===0&&<p className="dumaElectionWorkflowHint" role="status">Все должности уже замещены либо по ним проводится голосование. Повторное создание выборов недоступно.</p>}

  {!stageActive&&<p className="dumaElectionWorkflowHint" role="status">Работа по этапу приостановлена или завершена. Новые предложения станут доступны после открытия этапа преподавателем.</p>}
  {stageActive&&!teacher&&!myRegistered&&<p className="dumaElectionWorkflowHint" role="status">Сначала зарегистрируйтесь на заседание Государственной Думы в блоке регистрации выше.</p>}
  {canPropose&&!canCoordinate&&procedureApproved&&sorted.length===0&&<p className="dumaElectionWorkflowHint" role="status">Порядок выборов утверждён. Создание процедуры выполняет председатель партии либо руководство Государственной Думы; зарегистрированные депутаты смогут предложить кандидатуры.</p>}
  <div className="dumaElectionList">{displayedElections.length===0?<div className="dumaElectionEmpty" role="status"><FileClock size={23} aria-hidden="true"/><div><strong>Выборы руководства ещё не начались</strong><p>{procedureApproved?'После создания процедуры здесь появятся кандидаты и результаты голосования.':'После утверждения порядка выборов здесь появятся процедуры избрания руководства Государственной Думы.'}</p></div></div>:displayedElections.map(e=>{
   const ec=electionCandidates(e.id),eb=electionBallots(e.id),winner=ec.find(c=>c.id===e.winner_candidate_id);
   const myCapacity=ledParty?activeMandates(ledParty.id):0;
   const myUsed=ledParty?usedByParty(e.id,ledParty.id):0;
   const eligibleNominees=(ledParty?members.filter(m=>m.kind==='student'&&m.team===ledParty.name):myFaction&&!teacher?members.filter(m=>m.kind==='student'&&m.team===myFaction.name):members.filter(m=>m.kind==='student')).filter(m=>gdMandateCapacity(m.user_id)>0);
   return <article className={'dumaElectionCard '+e.status} key={e.id}>
    <header><div><small>{e.round_no===2?'ВТОРОЙ ТУР':'ПЕРВЫЙ ТУР'} · {e.vote_mode==='secret'?'ТАЙНОЕ':'ОТКРЫТОЕ'}</small><h3>{e.office_title}</h3></div><span>{e.status==='nomination'?'Выдвижение':e.status==='open'?'Голосование':e.status==='finished'?'Избран':'Завершено'}</span></header>

    {e.status==='nomination'&&<div className="dumaNomination">
     {canNominate&&<><select aria-label={'Кандидат: '+e.office_title} value={nominee[e.id]||''} onChange={x=>setNominee(v=>({...v,[e.id]:x.target.value}))}><option value="">Выберите кандидата…</option>{eligibleNominees.filter(m=>!ec.some(c=>c.user_id===m.user_id)).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select><button disabled={busy||!nominee[e.id]} onClick={()=>void nominate(e.id)}>Выдвинуть</button></>}
     {canManage&&<button className="primary" disabled={busy||ec.length===0} onClick={()=>void open(e.id)}>Открыть голосование</button>}
    </div>}

    <div className="dumaCandidates">{ec.map(c=>{
     const person=member(c.user_id),p=party(c.party_id),total=totalFor(e.id,c.id);
     const own=ledParty?eb.find(b=>b.party_id===ledParty.id&&b.candidate_id===c.id)?.votes:undefined;
     const myPersonalVote=personalBallots.some(b=>b.election_id===e.id&&b.voter_id===activeMe.user_id&&b.candidate_id===c.id);
     const visibleTotal=e.vote_mode==='open'||e.status==='closed'||e.status==='finished'||teacher;
     return <div className={'dumaCandidate '+(winner?.id===c.id?'winner':'')} key={c.id}>
      <div className="dumaCandidateIdentity"><span style={{background:p?.color||'#315efb'}}>{(person?.full_name||'?').split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()}</span><div><b>{person?.full_name||'Кандидат'}</b><small>{p?.name||'Фракция'}</small></div></div>
      <div className="dumaCandidateScore"><strong>{visibleTotal?total:e.ballot_mode==='personal'?(myPersonalVote?myPresent:'•'):(own??'•')}</strong><span>{visibleTotal?'голосов':myPersonalVote?'ваш голос учтён':'тайно'}</span></div>
      {e.status==='open'&&e.ballot_mode==='personal'&&me.kind==='student'&&<div className="dumaVoteAllocation"><button type="button" className={myPersonalVote?'primary':''} disabled={busy||!myRegistered||myPresent<=0} onClick={()=>void personalVote(e.id,c.id)}>{myPersonalVote?'Вы проголосовали':'Отдать '+myPresent+' голосов'}</button></div>}
      {e.status==='open'&&e.ballot_mode!=='personal'&&ledParty&&<div className="dumaVoteAllocation"><input aria-label={'Мандаты за '+(person?.full_name||'кандидата')+' на должность '+e.office_title} type="number" min="0" max={myCapacity} value={voteDraft[e.id+'-'+c.id]??String(own??0)} onChange={x=>setVoteDraft(v=>({...v,[e.id+'-'+c.id]:x.target.value}))}/><button disabled={busy} onClick={()=>void vote(e.id,c.id)}>Записать</button></div>}
     </div>
    })}</div>

    {e.status==='open'&&e.ballot_mode==='personal'&&me.kind==='student'&&<div className="dumaMandateBudget"><span>Присутствуют представляемые Вами депутаты</span><b>{myPresent}</b><em>{myRegistered?'Вы зарегистрированы на заседании':'Сначала зарегистрируйтесь на заседание ГД'}</em></div>}
    {e.status==='open'&&e.ballot_mode!=='personal'&&ledParty&&<div className="dumaMandateBudget"><span>{ledParty.name}</span><b>{myUsed} / {myCapacity}</b><em>мандатов распределено</em></div>}
    {e.status==='open'&&canManage&&<div className="dumaCloseRow"><span>Закрытие фиксирует итог; если кандидатов больше двух и 226 не набрано, создаётся второй тур.</span><button className="primary" disabled={busy} onClick={()=>void close(e.id)}>Закрыть голосование</button></div>}
    {e.status==='finished'&&winner&&<div className="dumaWinner"><b>Избран</b><strong>{member(winner.user_id)?.full_name}</strong><span>{totalFor(e.id,winner.id)} голосов</span></div>}
   </article>
  })}</div>
 </section>;
}
