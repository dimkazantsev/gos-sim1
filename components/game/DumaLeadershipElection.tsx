'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import InstitutionRegistrationPanel from './InstitutionRegistrationPanel';

type Election={id:string;game_id:string;office_key:'gd_chair'|'gd_deputy_1'|'gd_deputy_2';office_title:string;round_no:1|2;vote_mode:'open'|'secret';status:'nomination'|'open'|'closed'|'finished';ballot_mode?:'faction'|'personal';winner_candidate_id:string|null;parent_election_id:string|null;created_at:string};
type OfficeCandidate={id:string;election_id:string;user_id:string;party_id:string;created_at:string};
type OfficeBallot={id:string;election_id:string;party_id:string;candidate_id:string;votes:number;submitted_by:string;updated_at:string};

const offices=[
 ['gd_chair','Председатель ГД'],
 ['gd_deputy_1','Заместитель №1'],
 ['gd_deputy_2','Заместитель №2']
] as const;

export default function DumaLeadershipElection({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,parties,setError}=g;
 const [elections,setElections]=useState<Election[]>([]);
 const [candidates,setCandidates]=useState<OfficeCandidate[]>([]);
 const [ballots,setBallots]=useState<OfficeBallot[]>([]);
 const [personalBallots,setPersonalBallots]=useState<{election_id:string;voter_id:string;party_id:string;candidate_id:string}[]>([]);
 const [personalMandates,setPersonalMandates]=useState<{user_id:string;party_id:string;base_mandates:number;effective_mandates:number}[]>([]);
 const [registrations,setRegistrations]=useState<{user_id:string;stage_no:number;institution_key:string}[]>([]);
 const [procedureVotes,setProcedureVotes]=useState<{id:string;status:string;result_code:string|null}[]>([]);
 const [office,setOffice]=useState<(typeof offices)[number][0]>('gd_chair');
 const [mode,setMode]=useState<'open'|'secret'>('open');
 const [nominee,setNominee]=useState<Record<string,string>>({});
 const [voteDraft,setVoteDraft]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);

 async function load(){
  if(!game)return;
  const [e,c,b,p,m,r,v]=await Promise.all([
   supabase.from('office_elections').select('*').eq('game_id',game.id).eq('stage_no',4).in('office_key',['gd_chair','gd_deputy_1','gd_deputy_2']).order('created_at',{ascending:true}),
   supabase.from('office_candidates').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('office_ballots').select('*').eq('game_id',game.id),
   supabase.from('office_personal_ballots').select('election_id,voter_id,party_id,candidate_id').eq('game_id',game.id),
   supabase.from('party_member_mandates').select('user_id,party_id,base_mandates,effective_mandates').eq('game_id',game.id),
   supabase.from('institution_session_registrations').select('user_id,stage_no,institution_key').eq('game_id',game.id).eq('stage_no',4).eq('institution_key','gd'),
   supabase.from('game_votes').select('id,status,result_code').eq('game_id',game.id).eq('stage_no',4).eq('procedure_key','gd_leadership_procedure')
  ]);
  if(!e.error)setElections((e.data||[]) as Election[]);
  if(!c.error)setCandidates((c.data||[]) as OfficeCandidate[]);
  if(!b.error)setBallots((b.data||[]) as OfficeBallot[]);
  if(!p.error)setPersonalBallots(p.data||[]);
  if(!m.error)setPersonalMandates(m.data||[]);
  if(!r.error)setRegistrations(r.data||[]);
  if(!v.error)setProcedureVotes(v.data||[]);
  const failure=[e,c,b,p,m,r,v].find(x=>x.error);if(failure?.error)setError(failure.error.message);
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('duma-leadership:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'office_elections',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'office_candidates',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'office_ballots',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'office_personal_ballots',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'party_member_mandates',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'game_votes',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'institution_session_registrations',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const activeGame=game;
 const activeMe=me;
 const member=(id:string)=>members.find(m=>m.user_id===id);
 const party=(id:string)=>parties.find(p=>p.id===id);
 const activeMandates=(partyId:string)=>personalMandates.filter(x=>x.party_id===partyId).reduce((a,x)=>a+Number(x.effective_mandates||0),0);
 const myMandates=personalMandates.find(m=>m.user_id===activeMe.user_id);
 const myRegistered=registrations.some(r=>r.user_id===activeMe.user_id&&r.stage_no===4&&r.institution_key==='gd');
 const procedureApproved=procedureVotes.some(v=>v.status==='closed'&&v.result_code==='passed');
 const procedureOpen=procedureVotes.some(v=>v.status==='open');
 const electionCandidates=(id:string)=>candidates.filter(c=>c.election_id===id);
 const electionBallots=(id:string)=>ballots.filter(b=>b.election_id===id);
 const totalFor=(eid:string,cid:string)=>{
  const election=elections.find(e=>e.id===eid);
  if(election?.ballot_mode==='personal')return personalBallots.filter(b=>b.election_id===eid&&b.candidate_id===cid)
    .reduce((total,b)=>total+Number(personalMandates.find(m=>m.user_id===b.voter_id&&m.party_id===b.party_id)?.effective_mandates||0),0);
  return electionBallots(eid).filter(b=>b.candidate_id===cid).reduce((a,b)=>a+Number(b.votes||0),0);
 };
 const usedByParty=(eid:string,pid:string)=>electionBallots(eid).filter(b=>b.party_id===pid).reduce((a,b)=>a+Number(b.votes||0),0);

 async function openProcedureVote(){setBusy(true);const r=await supabase.rpc('open_duma_leadership_procedure_vote',{p_game_id:activeGame.id});if(r.error)setError(r.error.message);else{await load();await g.refresh()}setBusy(false)}
 async function createElection(){
  setBusy(true);const r=await supabase.rpc('create_office_election',{p_game_id:activeGame.id,p_office_key:office,p_vote_mode:mode});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function nominate(electionId:string){
  const userId=nominee[electionId];if(!userId)return;setBusy(true);
  const r=await supabase.rpc('nominate_office_candidate',{p_election_id:electionId,p_user_id:userId});
  if(r.error)setError(r.error.message);else{setNominee(v=>({...v,[electionId]:''}));await load()}setBusy(false);
 }
 async function open(electionId:string){setBusy(true);const r=await supabase.rpc('open_office_election',{p_election_id:electionId});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function vote(electionId:string,candidateId:string){
  const value=Math.max(0,Number(voteDraft[electionId+'-'+candidateId])||0);setBusy(true);
  const r=await supabase.rpc('set_office_ballot',{p_election_id:electionId,p_candidate_id:candidateId,p_votes:value});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function personalVote(electionId:string,candidateId:string){setBusy(true);const r=await supabase.rpc('cast_personal_office_ballot',{p_election_id:electionId,p_candidate_id:candidateId});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function close(electionId:string){setBusy(true);const r=await supabase.rpc('close_office_election',{p_election_id:electionId});if(r.error)setError(r.error.message);else await load();setBusy(false)}

 const sorted=useMemo(()=>[...elections].sort((a,b)=>a.office_key.localeCompare(b.office_key)||a.round_no-b.round_no),[elections]);

 return <section className="dumaElection">
  <header className="dumaElectionHead"><div><small>ПАРЛАМЕНТСКАЯ ПРОЦЕДУРА · ЭТАП 4</small><h2>Руководство Государственной Думы</h2><p>Сначала депутаты регистрируются на заседание и утверждают процедуру голосованием. Затем фракции выдвигают кандидатов, проходит их обсуждение и персональное голосование депутатов. Каждый депутат голосует своими действующими мандатами с учётом GV; избрание требует 226 голосов из 450.</p></div><div className="dumaThreshold"><strong>226</strong><span>голосов для избрания</span><em>из 450</em></div></header>

  <InstitutionRegistrationPanel g={g} stageNo={4} initialBody="gd" allowedBodies={['gd']} defaultOpen/>
  <div className="dumaElectionProcedure"><b>Утверждение процедуры выборов депутатами</b><p>{procedureApproved?'Процедура утверждена: можно выдвигать кандидатов.':procedureOpen?'Голосование открыто в разделе «Голосование».':'До выдвижения кандидатур требуется голосование зарегистрированных депутатов.'}</p>
  {teacher&&!procedureApproved&&!procedureOpen&&<button type="button" className="primary" disabled={busy} onClick={()=>void openProcedureVote()}>Открыть голосование о процедуре</button>}</div>
  {teacher&&<div className="dumaElectionCreator"><label>Должность<select value={office} onChange={e=>setOffice(e.target.value as typeof office)}>{offices.map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Форма голосования<select value={mode} onChange={e=>setMode(e.target.value as 'open'|'secret')}><option value="open">Открытое</option><option value="secret">Тайное</option></select></label><button className="primary" disabled={busy} onClick={()=>void createElection()} disabled={busy||!procedureApproved}>Создать процедуру</button></div>}

  <div className="dumaElectionList">{sorted.length===0?<div className="emptyState">Процедуры выборов руководства ГД ещё не созданы.</div>:sorted.map(e=>{
   const ec=electionCandidates(e.id),eb=electionBallots(e.id),winner=ec.find(c=>c.id===e.winner_candidate_id);
   const myCapacity=ledParty?activeMandates(ledParty.id):0;
   const myUsed=ledParty?usedByParty(e.id,ledParty.id):0;
   const eligibleNominees=(ledParty?members.filter(m=>m.kind==='student'&&m.team===ledParty.name):members.filter(m=>m.kind==='student')).filter(m=>personalMandates.some(a=>a.user_id===m.user_id&&a.base_mandates>0));
   return <article className={'dumaElectionCard '+e.status} key={e.id}>
    <header><div><small>{e.round_no===2?'ВТОРОЙ ТУР':'ПЕРВЫЙ ТУР'} · {e.vote_mode==='secret'?'ТАЙНОЕ':'ОТКРЫТОЕ'}</small><h3>{e.office_title}</h3></div><span>{e.status==='nomination'?'Выдвижение':e.status==='open'?'Голосование':e.status==='finished'?'Избран':'Завершено'}</span></header>

    {e.status==='nomination'&&<div className="dumaNomination">
     {(teacher||ledParty)&&<><select aria-label={'Кандидат: '+e.office_title} value={nominee[e.id]||''} onChange={x=>setNominee(v=>({...v,[e.id]:x.target.value}))}><option value="">Выберите кандидата…</option>{eligibleNominees.filter(m=>!ec.some(c=>c.user_id===m.user_id)).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select><button disabled={busy||!nominee[e.id]} onClick={()=>void nominate(e.id)}>Выдвинуть</button></>}
     {teacher&&<button className="primary" disabled={busy||ec.length===0} onClick={()=>void open(e.id)}>Открыть голосование</button>}
    </div>}

    <div className="dumaCandidates">{ec.map(c=>{
     const person=member(c.user_id),p=party(c.party_id),total=totalFor(e.id,c.id);
     const own=ledParty?eb.find(b=>b.party_id===ledParty.id&&b.candidate_id===c.id)?.votes:undefined;
     const myPersonalVote=personalBallots.some(b=>b.election_id===e.id&&b.voter_id===activeMe.user_id&&b.candidate_id===c.id);
     const visibleTotal=e.vote_mode==='open'||e.status==='closed'||e.status==='finished'||teacher;
     return <div className={'dumaCandidate '+(winner?.id===c.id?'winner':'')} key={c.id}>
      <div className="dumaCandidateIdentity"><span style={{background:p?.color||'#315efb'}}>{(person?.full_name||'?').split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()}</span><div><b>{person?.full_name||'Кандидат'}</b><small>{p?.name||'Фракция'}</small></div></div>
      <div className="dumaCandidateScore"><strong>{visibleTotal?total:e.ballot_mode==='personal'?(myPersonalVote?Number(myMandates?.effective_mandates||0):'•'):(own??'•')}</strong><span>{visibleTotal?'голосов':myPersonalVote?'ваш голос учтён':'тайно'}</span></div>
      {e.status==='open'&&e.ballot_mode==='personal'&&me.kind==='student'&&<div className="dumaVoteAllocation"><button type="button" className={myPersonalVote?'primary':''} disabled={busy||!myRegistered||Number(myMandates?.effective_mandates||0)<=0} onClick={()=>void personalVote(e.id,c.id)}>{myPersonalVote?'Вы проголосовали':'Отдать '+Number(myMandates?.effective_mandates||0)+' голосов'}</button></div>}
      {e.status==='open'&&e.ballot_mode!=='personal'&&ledParty&&<div className="dumaVoteAllocation"><input aria-label={'Мандаты за '+(person?.full_name||'кандидата')+' на должность '+e.office_title} type="number" min="0" max={myCapacity} value={voteDraft[e.id+'-'+c.id]??String(own??0)} onChange={x=>setVoteDraft(v=>({...v,[e.id+'-'+c.id]:x.target.value}))}/><button disabled={busy} onClick={()=>void vote(e.id,c.id)}>Записать</button></div>}
     </div>
    })}</div>

    {e.status==='open'&&e.ballot_mode==='personal'&&me.kind==='student'&&<div className="dumaMandateBudget"><span>Ваши действующие мандаты</span><b>{Number(myMandates?.effective_mandates||0)}</b><em>{myRegistered?'Вы зарегистрированы на заседании':'Сначала зарегистрируйтесь на заседание ГД'}</em></div>}
    {e.status==='open'&&e.ballot_mode!=='personal'&&ledParty&&<div className="dumaMandateBudget"><span>{ledParty.name}</span><b>{myUsed} / {myCapacity}</b><em>мандатов распределено</em></div>}
    {e.status==='open'&&teacher&&<div className="dumaCloseRow"><span>Закрытие фиксирует итог; если кандидатов больше двух и 226 не набрано, создаётся второй тур.</span><button className="primary" disabled={busy} onClick={()=>void close(e.id)}>Закрыть голосование</button></div>}
    {e.status==='finished'&&winner&&<div className="dumaWinner"><b>Избран</b><strong>{member(winner.user_id)?.full_name}</strong><span>{totalFor(e.id,winner.id)} голосов</span></div>}
   </article>
  })}</div>
 </section>;
}
