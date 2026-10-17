'use client';
import {userError} from '@/lib/userError';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';

type Unit={id:string;title:string;head_user_id:string|null};
type Assignment={unit_id:string;user_id:string;party_id:string|null};
type Election={id:string;office_key:string;office_title:string;round_no:1|2;vote_mode:'open'|'secret';ballot_mode?:'faction'|'personal';status:'nomination'|'open'|'closed'|'finished';winner_candidate_id:string|null;created_at:string};
type Candidate={id:string;election_id:string;user_id:string;party_id:string;created_at:string};
type Ballot={election_id:string;party_id:string;candidate_id:string;votes:number};

export default function CommitteeChairElectionPanel({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,parties,setError,gdMandateCapacity,gdEffectivePresence}=g;
 const [units,setUnits]=useState<Unit[]>([]);
 const [assignments,setAssignments]=useState<Assignment[]>([]);
 const [elections,setElections]=useState<Election[]>([]);
 const [candidates,setCandidates]=useState<Candidate[]>([]);
 const [ballots,setBallots]=useState<Ballot[]>([]);
 const [personalBallots,setPersonalBallots]=useState<{election_id:string;voter_id:string;party_id:string;candidate_id:string}[]>([]);
 const [registered,setRegistered]=useState<{user_id:string;present_mandates:number|null}[]>([]);
 const [personalMandates,setPersonalMandates]=useState<{party_id:string;user_id:string;base_mandates:number;effective_mandates:number}[]>([]);
 const [nominee,setNominee]=useState<Record<string,string>>({});
 const [voteDraft,setVoteDraft]=useState<Record<string,string>>({});
 const [mode,setMode]=useState<Record<string,'open'|'secret'>>({});
 const [busy,setBusy]=useState(false);
 const role=stageRoleTitles(g);
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id&&p.registration_status==='registered');
 const canCreate=teacher||(role.includes('председател')&&role.includes('дум'))||(role.includes('совет')&&role.includes('дум'));

 async function load(){
  if(!game)return;
  const [u,a,e,c,b,m,p,r]=await Promise.all([
   supabase.from('institution_units').select('id,title,head_user_id').eq('game_id',game.id).eq('unit_kind','committee').order('unit_key'),
   supabase.from('institution_assignments').select('unit_id,user_id,party_id').eq('game_id',game.id).eq('unit_kind','committee'),
   supabase.from('office_elections').select('*').eq('game_id',game.id).eq('stage_no',4).like('office_key','committee:%').order('created_at'),
   supabase.from('office_candidates').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('office_ballots').select('election_id,party_id,candidate_id,votes').eq('game_id',game.id),
   supabase.from('party_member_mandates').select('party_id,user_id,base_mandates,effective_mandates').eq('game_id',game.id),
   supabase.from('office_personal_ballots').select('election_id,voter_id,party_id,candidate_id').eq('game_id',game.id),
   supabase.from('institution_session_registrations').select('user_id,present_mandates').eq('game_id',game.id).eq('stage_no',4).eq('institution_key','gd')
  ]);
  const failure=[u,a,e,c,b,m,p,r].find(x=>x.error);if(failure?.error){setError(userError(failure.error));return;}
  if(!u.error)setUnits((u.data||[]) as Unit[]);
  if(!a.error)setAssignments((a.data||[]) as Assignment[]);
  if(!e.error)setElections((e.data||[]) as Election[]);
  if(!c.error)setCandidates((c.data||[]) as Candidate[]);
  if(!b.error)setBallots((b.data||[]) as Ballot[]);
  if(!m.error)setPersonalMandates((m.data||[]) as typeof personalMandates);
  if(!p.error)setPersonalBallots(p.data||[]);
  if(!r.error)setRegistered(r.data||[]);
 }
 useGameTableSync(game?.id,['office_elections','office_candidates','office_ballots','office_personal_ballots','institution_units','institution_assignments','party_member_mandates','institution_session_registrations'],load,me?.user_id||'');

 if(!game||!me)return null;
 const activeMandates=(partyId:string)=>personalMandates.filter(x=>x.party_id===partyId).reduce((a,x)=>a+Number(x.effective_mandates||0),0);
 const name=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';
 const party=(id:string)=>parties.find(p=>p.id===id);
 const activeElection=(unitId:string)=>[...elections].reverse().find(e=>e.office_key==='committee:'+unitId&&['nomination','open'].includes(e.status));
 const history=(unitId:string)=>elections.filter(e=>e.office_key==='committee:'+unitId);
 const ec=(eid:string)=>candidates.filter(c=>c.election_id===eid);
 const eb=(eid:string)=>ballots.filter(b=>b.election_id===eid);
 const totalFor=(eid:string,cid:string)=>{
  const election=elections.find(x=>x.id===eid);
  if(election?.ballot_mode==='personal')return personalBallots.filter(b=>b.election_id===eid&&b.candidate_id===cid)
   .reduce((sum,b)=>sum+gdEffectivePresence(b.voter_id,registered.find(r=>r.user_id===b.voter_id)?.present_mandates),0);
  return eb(eid).filter(b=>b.candidate_id===cid).reduce((a,b)=>a+Number(b.votes||0),0);
 };
 const used=(eid:string,pid:string)=>eb(eid).filter(b=>b.party_id===pid).reduce((a,b)=>a+Number(b.votes||0),0);

 async function create(unitId:string){
  setBusy(true);const r=await supabase.rpc('create_committee_chair_election',{p_unit_id:unitId,p_vote_mode:mode[unitId]||'open'});
  if(r.error)setError(userError(r.error));else await load();setBusy(false);
 }
 async function nominate(eid:string){
  const uid=nominee[eid];if(!uid)return;setBusy(true);const r=await supabase.rpc('nominate_office_candidate',{p_election_id:eid,p_user_id:uid});
  if(r.error)setError(userError(r.error));else{setNominee(v=>({...v,[eid]:''}));await load()}setBusy(false);
 }
 async function open(eid:string){setBusy(true);const r=await supabase.rpc('open_office_election',{p_election_id:eid});if(r.error)setError(userError(r.error));else await load();setBusy(false)}
 async function cast(eid:string,cid:string){
  const amount=Math.max(0,Number(voteDraft[eid+'-'+cid])||0);setBusy(true);
  const r=await supabase.rpc('set_office_ballot',{p_election_id:eid,p_candidate_id:cid,p_votes:amount});
  if(r.error)setError(userError(r.error));else await load();setBusy(false);
 }
 async function personalCast(eid:string,cid:string){setBusy(true);const r=await supabase.rpc('cast_personal_office_ballot',{p_election_id:eid,p_candidate_id:cid});if(r.error)setError(userError(r.error));else await load();setBusy(false)}
 async function close(eid:string){setBusy(true);const r=await supabase.rpc('close_office_election',{p_election_id:eid});if(r.error)setError(userError(r.error));else await load();setBusy(false)}

 return <section className="committeeElectionBoard">
  <div className="committeeElectionHead"><div className="committeeElectionIntro"><small>Государственная Дума · Этап 4</small><h3>Выборы председателей комитетов</h3><p>Председатели зарегистрированных партий выдвигают кандидатов из состава своих фракций до распределения депутатов по комитетам. Зарегистрированные депутаты голосуют действующими мандатами с учётом гоствойтинга. При трёх и более кандидатах, если никто не избран в первом туре, назначается второй тур для двух лидеров.</p></div><div className="committeeElectionThreshold" aria-label="Для избрания требуется 226 голосов из 450"><span>Необходимое большинство</span><strong>226 <small>из 450</small></strong><em>голосов для избрания</em></div></div>
  <div className="committeeElectionGrid">{units.map(u=>{
   const e=activeElection(u.id);
   const last=[...history(u.id)].reverse()[0];
   const election=e||last;
   const cs=election?ec(election.id):[];
   const ownCandidates=election&&ledParty?members.filter(m=>m.kind==='student'&&m.team===ledParty.name&&gdMandateCapacity(m.user_id)>0).map(m=>m.user_id):[];
   const myCapacity=ledParty?activeMandates(ledParty.id):0;
   const myMandates=personalMandates.find(a=>a.user_id===me.user_id);
   const myPresent=registered.some(r=>r.user_id===me.user_id)?gdEffectivePresence(me.user_id,registered.find(r=>r.user_id===me.user_id)?.present_mandates):0;
   const myUsed=election&&ledParty?used(election.id,ledParty.id):0;
   return <article key={u.id} className={'committeeElectionCard '+(election?.status||'idle')}>
    <header><div><small>КОМИТЕТ</small><b>{u.title}</b><span>Председатель: {name(u.head_user_id)}</span></div>{!e&&canCreate&&<div className="committeeElectionCreate"><select aria-label={'Форма выборов председателя: '+u.title} value={mode[u.id]||'open'} onChange={x=>setMode(v=>({...v,[u.id]:x.target.value as 'open'|'secret'}))}><option value="open">Открыто</option><option value="secret">Тайно</option></select><button disabled={busy} onClick={()=>void create(u.id)}>Начать выборы</button></div>}</header>
    {election&&<><div className="committeeElectionState"><span>{election.round_no===2?'II тур':'I тур'}</span><b>{election.status==='nomination'?'Выдвижение':election.status==='open'?'Голосование':election.status==='finished'?'Завершено':'Тур закрыт'}</b><em>{election.vote_mode==='secret'?'тайное':'открытое'}</em></div>
    {election.status==='nomination'&&(teacher||ledParty)&&<div className="committeeNominate"><select aria-label={'Кандидат в председатели: '+u.title} value={nominee[election.id]||''} onChange={x=>setNominee(v=>({...v,[election.id]:x.target.value}))}><option value="">Кандидат от фракции…</option>{(teacher?members.filter(m=>m.kind==='student'&&gdMandateCapacity(m.user_id)>0).map(m=>m.user_id):ownCandidates).filter(uid=>!cs.some(c=>c.user_id===uid)).map(uid=><option key={uid} value={uid}>{name(uid)}</option>)}</select><button disabled={busy||!nominee[election.id]} onClick={()=>void nominate(election.id)}>Выдвинуть</button>{teacher&&<button className="primary" disabled={busy||cs.length===0} onClick={()=>void open(election.id)}>Открыть голосование</button>}</div>}
    <div className="committeeCandidateList">{cs.map(c=>{
     const own=ledParty?eb(election.id).find(b=>b.party_id===ledParty.id&&b.candidate_id===c.id)?.votes:undefined;
     const mine=personalBallots.some(b=>b.election_id===election.id&&b.voter_id===me.user_id&&b.candidate_id===c.id);
     const visible=election.vote_mode==='open'||!['nomination','open'].includes(election.status)||teacher;
     return <div key={c.id}><span style={{background:party(c.party_id)?.color||'#315efb'}}>{name(c.user_id).split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()}</span><div><b>{name(c.user_id)}</b><small>{party(c.party_id)?.name||'Фракция'}</small></div><strong>{visible?totalFor(election.id,c.id):election.ballot_mode==='personal'?(mine?myPresent:'•'):(own??'•')}</strong>
     {election.status==='open'&&election.ballot_mode==='personal'&&me.kind==='student'&&<div className="committeeBallot"><button type="button" className={mine?'primary':''} disabled={busy||!registered.some(r=>r.user_id===me.user_id)||myPresent<=0} onClick={()=>void personalCast(election.id,c.id)}>{mine?'Вы проголосовали':'Отдать '+myPresent+' голосов'}</button></div>}
     {election.status==='open'&&election.ballot_mode!=='personal'&&ledParty&&<div className="committeeBallot"><input aria-label={'Мандаты за '+name(c.user_id)+' в комитете '+u.title} type="number" min="0" max={myCapacity} value={voteDraft[election.id+'-'+c.id]??String(own??0)} onChange={x=>setVoteDraft(v=>({...v,[election.id+'-'+c.id]:x.target.value}))}/><button disabled={busy} onClick={()=>void cast(election.id,c.id)}>Записать</button></div>}</div>
    })}</div>
    {election.status==='open'&&election.ballot_mode==='personal'&&me.kind==='student'&&<div className="committeeMandateUse">Присутствуют Ваши депутаты: <b>{myPresent}</b> · {registered.some(r=>r.user_id===me.user_id)?'Вы зарегистрированы':'Сначала зарегистрируйтесь на заседание ГД'}</div>}
    {election.status==='open'&&election.ballot_mode!=='personal'&&ledParty&&<div className="committeeMandateUse">{ledParty.name}: <b>{myUsed}/{myCapacity}</b> мандатов распределено</div>}
    {election.status==='open'&&teacher&&<button className="primary committeeCloseVote" disabled={busy} onClick={()=>void close(election.id)}>Закрыть голосование</button>}</>}
   </article>
  })}</div>
 </section>;
}
