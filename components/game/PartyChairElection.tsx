'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {GAME_DATA_REFRESH_EVENT} from './useGameTableSync';
import type {Party} from './types';
import type {ReturnTypeRepublic} from './viewTypes';
type Ballot={voter_id:string;candidate_id:string};

export default function PartyChairElection({g,party}:{g:ReturnTypeRepublic;party:Party}){
 const [votes,setVotes]=useState<Ballot[]>([]);
 const [candidate,setCandidate]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const members=useMemo(()=>g.members.filter(m=>m.kind==='student'&&m.team===party.name),[g.members,party.name]);
 const me=g.me;
 const eligible=me?.kind==='student'&&me.team===party.name;
 const stage1=g.stages.find(s=>s.stage_no===1);
 const votingOpen=stage1?.status==='open'&&(!stage1.deadline||Date.parse(stage1.deadline)>Date.now());
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
  if(!candidate||busy)return;
  setBusy(true);setNotice('');
  try{
   const success=await g.voteForPartyChair(party.id,candidate);
   setNotice(success?'Голос учтён. Если проголосовали все участники и нет равенства голосов, председатель избран.':'Голос не сохранён. Проверьте сообщение об ошибке.');
   if(success){const r=await supabase.from('party_chair_ballots').select('voter_id,candidate_id').eq('party_id',party.id);if(!r.error)setVotes((r.data||[]) as Ballot[])}
  }finally{setBusy(false)}
 }
 return <section className="civicPartyEditor" aria-label={'Выборы председателя партии '+party.name}>
  <h3>Выборы председателя</h3>
  {party.leader_user_id?<p>Председатель избран: <b>{members.find(m=>m.user_id===party.leader_user_id)?.full_name||'Избранный участник'}</b>. Голосование завершено.</p>:
   <p>Каждый член партии голосует за одного кандидата. Итог подводится после голосования всех действующих членов; при равенстве голосов допускается переголосование.</p>}
  <p>Подано голосов: <b>{votes.length} из {members.length}</b>.</p>
  {members.map(member=><p key={member.user_id}><span>{member.full_name}</span> — {totals.get(member.user_id)||0} голосов</p>)}
  {!party.leader_user_id&&eligible&&votingOpen&&<>
   <label>Кандидат
    <select value={candidate} onChange={e=>setCandidate(e.target.value)}>
     <option value="">Выберите участника партии</option>
     {members.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
    </select>
   </label>
   {current&&<p>Ваш предыдущий голос можно изменить до подведения итогов.</p>}
   <button type="button" className="primary" disabled={busy||!candidate} onClick={()=>void cast()}>{busy?'Сохранение…':current?'Изменить голос':'Голосовать'}</button>
  </>}
  {!party.leader_user_id&&!votingOpen&&<p>Голосование недоступно: этап создания партий завершён.</p>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
