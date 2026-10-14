'use client';
import {useEffect,useMemo,useState} from 'react';
import {CheckCircle2,Clock3,LockKeyhole,UsersRound,Vote} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {GAME_DATA_REFRESH_EVENT} from './useGameTableSync';
import {isStageWorkOpen} from './stageWorkStatus';
import ProfileAvatar from './ProfileAvatar';
import type {Party} from './types';
import type {ReturnTypeRepublic} from './viewTypes';
type Ballot={voter_id:string;candidate_id:string};
export default function PartyChairElection({g,party}:{g:ReturnTypeRepublic;party:Party}){
 const [votes,setVotes]=useState<Ballot[]>([]);
 const [candidate,setCandidate]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const members=useMemo(()=>g.members.filter(m=>m.kind==='student'&&m.team===party.name&&!m.roster_archived_at),[g.members,party.name]);
 const pending=g.partyInvitations.filter(i=>i.party_id===party.id&&i.status==='pending');
 const me=g.me;
 const eligible=me?.kind==='student'&&!me.roster_archived_at&&me.team===party.name;
 const stageOne=g.stages.find(s=>s.stage_no===1);
 const votingOpen=isStageWorkOpen(g.game,stageOne);
 const ready=members.length>=2&&pending.length===0;
 const canVote=!party.leader_user_id&&eligible&&votingOpen&&ready;
 useEffect(()=>{
  let active=true;
  async function load(){
   const r=await supabase.from('party_chair_ballots').select('voter_id,candidate_id').eq('party_id',party.id).eq('game_id',party.game_id);
   if(active&&!r.error)setVotes((r.data||[]) as Ballot[]);
  }
  const update=(e:Event)=>{if((e as CustomEvent<{gameId:string}>).detail?.gameId===party.game_id)void load()};
  const channel=supabase.channel('chair-election:'+party.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'party_chair_ballots',filter:'party_id=eq.'+party.id},()=>void load()).subscribe();
  void load();window.addEventListener(GAME_DATA_REFRESH_EVENT,update);
  return()=>{active=false;window.removeEventListener(GAME_DATA_REFRESH_EVENT,update);void supabase.removeChannel(channel)};
 },[party.id,party.game_id]);
 const totals=new Map<string,number>();
 for(const vote of votes)if(members.some(m=>m.user_id===vote.voter_id)&&members.some(m=>m.user_id===vote.candidate_id))
  totals.set(vote.candidate_id,(totals.get(vote.candidate_id)||0)+1);
 const votesCast=votes.filter(v=>members.some(m=>m.user_id===v.voter_id&&members.some(c=>c.user_id===v.candidate_id))).length;
 const current=votes.find(v=>v.voter_id===me?.user_id)?.candidate_id;
 const status=party.leader_user_id?'Председатель избран':!votingOpen?'Этап не открыт':members.length<2?'Набор участников':pending.length?'Ожидаются ответы':'Идёт голосование';
 async function cast(){
  if(!candidate||busy||!canVote)return;
  setBusy(true);setNotice('');
  try{
   const success=await g.voteForPartyChair(party.id,candidate);
   setNotice(success?'Голос учтён. После голосования всех действующих членов определяется председатель.':'Голос не сохранён. Проверьте сообщение об ошибке.');
   if(success){
    const r=await supabase.from('party_chair_ballots').select('voter_id,candidate_id').eq('party_id',party.id);
    if(!r.error)setVotes((r.data||[]) as Ballot[]);
   }
  }finally{setBusy(false)}
 }
 return <section className="gosPartyElection" aria-label={'Выборы председателя партии '+party.name}>
  <header className="gosPartyElectionHead">
   <span className="gosPartyElectionIcon" aria-hidden="true"><Vote size={22}/></span>
   <div><small>ПАРТИЙНОЕ САМОУПРАВЛЕНИЕ</small><h3>Выборы председателя</h3><p>Право голоса имеют только вступившие участники партии.</p></div>
   <span className={'gosPartyElectionStatus '+(party.leader_user_id?'isDone':canVote?'isActive':'isWaiting')}>{party.leader_user_id?<CheckCircle2 size={15}/>:canVote?<Vote size={15}/>:<Clock3 size={15}/>} {status}</span>
  </header>
  <div className="gosPartyElectionSteps">
   <div className="gosPartyElectionStep"><UsersRound size={18}/><span>Члены партии</span><b>{members.length}</b></div>
   <div className="gosPartyElectionStep"><Clock3 size={18}/><span>Ожидают вступления</span><b>{pending.length}</b></div>
   <div className="gosPartyElectionStep"><Vote size={18}/><span>Подано голосов</span><b>{votesCast} / {members.length}</b></div>
  </div>
  {party.leader_user_id?<div className="gosPartyElectionResult"><CheckCircle2 size={21}/><div><strong>Председатель избран</strong><p>{members.find(m=>m.user_id===party.leader_user_id)?.full_name||'Участник партии'}. Голосование завершено; можно готовить регистрационные документы.</p></div></div>:
   !votingOpen?<p className="gosPartyElectionNotice"><LockKeyhole size={18}/> Выборы недоступны до открытия первого этапа преподавателем.</p>:
   !ready?<p className="gosPartyElectionNotice"><Clock3 size={18}/> Сначала пригласите других студентов и дождитесь их согласия. Для выборов нужны минимум два вступивших участника и отсутствие приглашений без ответа.</p>:
   <p className="gosPartyElectionHint">Каждый участник голосует один раз; до подведения итогов выбор можно изменить. При равенстве голосов допускается переголосование.</p>}
  {members.length>0&&<div className="gosPartyElectionCandidates" aria-label="Кандидаты и голоса">
   {members.map(member=><div className="gosPartyElectionCandidate" key={member.user_id}>
    <span className="gosPartyElectionAvatar"><ProfileAvatar name={member.full_name} src={g.profiles.find(p=>p.user_id===member.user_id)?.avatar_url}/></span>
    <span className="gosPartyElectionCandidateName">{member.full_name}{member.user_id===me?.user_id&&<small>Вы</small>}</span>
    <span className="gosPartyElectionVotes">{totals.get(member.user_id)||0} голосов</span>
   </div>)}
  </div>}
  {canVote&&<div className="gosPartyElectionBallot">
   <label>Выберите кандидата
    <select value={candidate} onChange={e=>setCandidate(e.target.value)}>
     <option value="">Кандидат на должность председателя</option>
     {members.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
    </select>
   </label>
   <button type="button" className="primary" disabled={busy||!candidate} onClick={()=>void cast()}>{busy?'Сохранение…':current?'Изменить голос':'Проголосовать'}</button>
  </div>}
  {notice&&<p className="gosPartyElectionFeedback" role="status">{notice}</p>}
 </section>;
