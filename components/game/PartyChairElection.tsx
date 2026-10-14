'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {CheckCircle2,Clock3,LockKeyhole,UsersRound,Vote} from 'lucide-react';
import {partyStageOpen} from './partyStageAccess';
import {GAME_DATA_REFRESH_EVENT} from './useGameTableSync';
import type {Party} from './types';
import type {ReturnTypeRepublic} from './viewTypes';
type Ballot={voter_id:string;candidate_id:string};

export default function PartyChairElection({g,party}:{g:ReturnTypeRepublic;party:Party}){
 const [votes,setVotes]=useState<Ballot[]>([]);
 const [candidate,setCandidate]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const members=useMemo(()=>g.members.filter(m=>m.kind==='student'&&m.roster_archived_at==null&&m.team===party.name),[g.members,party.name]);
 const me=g.me;
 const eligible=me?.kind==='student'&&me.roster_archived_at==null&&me.team===party.name;
 const pending=g.partyInvitations.filter(i=>i.party_id===party.id&&i.status==='pending');
 const accepted=g.partyInvitations.filter(i=>i.party_id===party.id&&i.status==='accepted');
 const stage1=g.stages.find(s=>s.stage_no===1);
 const votingOpen=partyStageOpen(g.game,stage1);
 const canVote=votingOpen&&members.length>=2&&!pending.length&&!party.leader_user_id;
 useEffect(()=>{
  let active=true;
  async function load(){
   const r=await supabase.from('party_chair_ballots').select('voter_id,candidate_id').eq('party_id',party.id).eq('game_id',party.game_id);
   if(active&&!r.error)setVotes((r.data||[]) as Ballot[]);
  }
  const update=(e:Event)=>{if((e as CustomEvent<{gameId:string}>).detail?.gameId===party.game_id)void load()};
  void load();window.addEventListener(GAME_DATA_REFRESH_EVENT,update);
  return()=>{active=false;window.removeEventListener(GAME_DATA_REFRESH_EVENT,update)};
 },[party.id,party.game_id]);
 const totals=new Map<string,number>();
 for(const vote of votes)totals.set(vote.candidate_id,(totals.get(vote.candidate_id)||0)+1);
 const current=votes.find(v=>v.voter_id===me?.user_id)?.candidate_id;
 async function cast(){
  if(!candidate||busy||!canVote||!eligible)return;
  setBusy(true);setNotice('');
  try{
   const success=await g.voteForPartyChair(party.id,candidate);
   setNotice(success?'Голос учтён. Если проголосовали все участники и нет равенства голосов, председатель избран.':'Голос не сохранён. Проверьте сообщение об ошибке.');
   if(success){const r=await supabase.from('party_chair_ballots').select('voter_id,candidate_id').eq('party_id',party.id);if(!r.error)setVotes((r.data||[]) as Ballot[])}
  }finally{setBusy(false)}
 }
 return <section className="civicChairElection" aria-label={'Выборы председателя партии '+party.name}>
  <header className="civicChairHeading"><span className="civicChairSymbol"><Vote size={23}/></span>
   <div><small>ВНУТРИПАРТИЙНАЯ ПРОЦЕДУРА</small><h3>Выборы председателя</h3><p>Приглашения, согласие на вступление, голосование.</p></div>
   <span className="civicChairStatus">{party.leader_user_id?'Председатель избран':canVote?'Голосование открыто':'Формирование состава'}</span>
  </header>
  <div className="civicChairSteps"><span><b>1</b> Приглашения</span><span><b>2</b> Согласие</span><span><b>3</b> Выборы</span></div>
  <div className="civicChairStats">
   <div><UsersRound size={17}/><small>Члены партии</small><strong>{members.length}</strong></div>
   <div><CheckCircle2 size={17}/><small>Приняли приглашение</small><strong>{accepted.length}</strong></div>
   <div><Clock3 size={17}/><small>Ждём ответ</small><strong>{pending.length}</strong></div>
   <div><Vote size={17}/><small>Голосов подано</small><strong>{votes.filter(v=>members.some(m=>m.user_id===v.voter_id)).length}/{members.length}</strong></div>
  </div>
  {party.leader_user_id?<div className="civicChairResult"><CheckCircle2 size={21}/><div><strong>Председатель избран</strong><p>{members.find(m=>m.user_id===party.leader_user_id)?.full_name||'Избранный участник'}. Голосование завершено.</p></div></div>:
   !votingOpen?<p className="civicChairNotice"><LockKeyhole size={18}/> Этап 1 не открыт или приостановлен. Голосование недоступно.</p>:
   members.length<2?<p className="civicChairNotice"><UsersRound size={18}/> Сначала пригласите другого участника. Он должен согласиться вступить в партию.</p>:
   pending.length>0?<p className="civicChairNotice"><Clock3 size={18}/> Ожидается ответ на {pending.length} приглашений. Дождитесь согласия или отмените приглашения.</p>:null}
  {canVote&&<div className="civicChairCandidates">
   <h4>Кандидаты</h4><p>Каждый действующий член партии имеет один голос.</p>
   <div className="civicChairCandidateGrid">{members.map(member=><button key={member.user_id} type="button" className={'civicChairCandidate'+(candidate===member.user_id?' selected':'')} aria-pressed={candidate===member.user_id} disabled={!eligible||busy} onClick={()=>setCandidate(member.user_id)}>
    <span className="civicChairAvatar">{member.full_name.slice(0,1)}</span><span><b>{member.full_name}</b><small>{current===member.user_id?'Ваш выбор':'Кандидат'}</small></span><span className="civicChairRadio"/>
   </button>)}</div>
   {eligible&&<div className="civicChairActions"><small>{current?'Ваш голос можно изменить до завершения выборов.':'Выберите кандидата и подтвердите решение.'}</small><button type="button" className="primary" disabled={busy||!candidate} onClick={()=>void cast()}><Vote size={17}/>{busy?'Сохранение…':current?'Изменить голос':'Голосовать'}</button></div>}
  </div>}
  {notice&&<p className="civicChairFeedback" role="status">{notice}</p>}
 </section>;
}
