'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Vote} from './types';
import StyledSelect from '../ui/StyledSelect';
import InstitutionRegistrationPanel from './InstitutionRegistrationPanel';
import FormalDocumentPicker from './FormalDocumentPicker';
import {votePresetForDocument,institutionLabel,majorityLabel} from './proceduralVoting';
import VoteBallotControls from './VoteBallotControls';
import {VOTING_BODIES,type VotingUnit} from './votingBodies';
import {useSavedGameState,savedChoice} from './useSavedGameState';
import {Vote as VoteIcon} from 'lucide-react';
import DisclosureSummary from '../ui/DisclosureSummary';

function pct(n:number,d:number){return d>0?Math.round(n/d*100):0}
function time(v:string){return new Date(v).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}

export default function VotesView({g,onOpenDocument,onOpenStages,focusId,onClearFocus}:{g:ReturnTypeRepublic;onOpenDocument:(id:string)=>void;onOpenStages:()=>void;focusId?:string;onClearFocus?:()=>void}){
 const {votes,ballots,me,teacher,formalDocuments,stages,parties,members,partyMandates,createVote,canVote,castVote,closeVote,tally,quorum}=g;
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[mode,setMode]=useState<'member'|'faction'|'mandate'>('member');
 const [institution,setInstitution]=useState('all'),[quorumValue,setQuorumValue]=useState(0.5),[majorityKind,setMajorityKind]=useState<'yes_no_simple'|'present_majority'|'eligible_majority'|'eligible_fraction'>('present_majority'),[majorityValue,setMajorityValue]=useState(0.5);
 const [tab,setTab]=useSavedGameState<'open'|'closed'|'all'>(g.game?.id,g.me?.user_id,'votes-tab','open',savedChoice('open','closed','all')),[busy,setBusy]=useState('');
 const [group,setGroup]=useState(''),[query,setQuery]=useState(''),[units,setUnits]=useState<VotingUnit[]>([]);
 const groups=[...new Set(members.filter(m=>m.kind==='student').map(m=>m.group_name).filter((s):s is string=>!!s))];
 const [formalId,setFormalId]=useState('');
 const selectedNpa=formalDocuments.find(d=>d.id===formalId);
 const pendingNpas=formalDocuments.filter(d=>votePresetForDocument(d)&&!votes.some(v=>v.formal_document_id===d.id&&v.formal_step_code===d.status_code&&v.status==='open'));
 const focused=useRef('');
 useEffect(()=>{if(focusId)setTab('all')},[focusId]);
 useEffect(()=>{if(!focusId||focused.current===focusId)return;const node=document.getElementById('vote-'+focusId);if(node){focused.current=focusId;node.scrollIntoView({block:'start',behavior:'smooth'});node.focus({preventScroll:true})}},[focusId,tab,votes]);
 const [checkedIn,setCheckedIn]=useState<{user_id:string;institution_key:string;stage_no:number}[]>([]);
 useEffect(()=>{
  if(!g.game)return;
  let live=true;
  async function reload(){
   const game=g.game;if(!game)return;
   const r=await supabase.from('institution_session_registrations').select('user_id,institution_key,stage_no').eq('game_id',game.id);
   if(live&&!r.error)setCheckedIn(r.data||[]);
  }
  void reload();
  const channel=supabase.channel('vote-checkin:'+g.game.id)
   .on('postgres_changes',{schema:'public',table:'institution_session_registrations',event:'*',filter:'game_id=eq.'+g.game.id},()=>void reload()).subscribe();
  return()=>{live=false;void supabase.removeChannel(channel)};
 },[g.game?.id]);
 function isRegisteredForVote(v:Vote){
  return (!v.electorate_snapshot?.attendance_required&&v.procedure_key!=='registered_session')||
   checkedIn.some(row=>row.user_id===me?.user_id&&row.institution_key===v.institution_key&&row.stage_no===v.stage_no);
 }
 function canCast(v:Vote){return canVote(v)&&isRegisteredForVote(v)}


 const visible=useMemo(()=>votes.filter(v=>(tab==='all'||v.status===tab)&&(!query.trim()||[v.title,institutionLabel(v.institution_key),v.group_name,v.electorate_snapshot?.institution_label].join(' ').toLowerCase().includes(query.trim().toLowerCase()))),[votes,tab,query]);
 const openCount=votes.filter(v=>v.status==='open').length;

 async function openNpa(id:string){const d=formalDocuments.find(d=>d.id===id),preset=d?votePresetForDocument(d):null;if(!d||!preset)return;setBusy(id);try{await createVote({...preset,formalDocumentId:id,groupName:group||null})}finally{setBusy('')}}
 function chooseNpa(ids:string[]){setFormalId(ids[0]||'');const d=formalDocuments.find(d=>d.id===ids[0]);if(d){const preset=votePresetForDocument(d);setTitle(preset?.title||d.title);setBody(d.body_text||preset?.body||'');if(preset){setInstitution(preset.institutionKey);setMode(preset.mode);setQuorumValue(preset.quorumValue);setMajorityKind(preset.majorityKind);setMajorityValue(preset.majorityValue)}}}
 async function create(){
  if(selectedNpa){const preset=votePresetForDocument(selectedNpa);if(preset){const ok=await createVote({...preset,title:title||preset.title,body:body||preset.body,formalDocumentId:formalId,groupName:group||null});if(ok){setTitle('');setBody('');setFormalId('')}return}}

  const ok=await createVote({title,body,mode,institutionKey:institution,procedureKey:!['all','factions'].includes(institution)?'registered_session':'manual',quorumKind:'fraction',quorumValue,majorityKind,majorityValue,allowAbstain:true,tieBreakerChair:institution==='government',formalDocumentId:formalId||null,groupName:group||null});
  if(ok){setTitle('');setBody('');setFormalId('')}
 }

 function canClose(v:Vote){
  if(teacher)return true;if(!me)return false;if(units.some(u=>'unit:'+u.id===v.institution_key&&u.head_user_id===me.user_id))return true;
  const role=(me.role_title||'').toLowerCase();
  if(v.institution_key==='gd')return (role.includes('председател')&&role.includes('дум'))||(role.includes('совет')&&role.includes('дум'));
  if(v.institution_key==='government')return role.includes('председател')&&role.includes('правительств');
  if(v.institution_key==='sf')return role.includes('председател')&&role.includes('совет')&&role.includes('федерац');
  if(v.institution_key==='committee')return role.includes('председател')&&role.includes('комитет');
  if(v.institution_key==='municipality')return role.includes('глава города')||role.includes('глава')&&role.includes('муницип');
  return false;
 }

 return <div className="votesPage civicVotes">
  <section className="votesHero">
   <div><small>ПРОЦЕДУРНЫЙ ЦЕНТР</small><h1>Голосования</h1><p>Здесь принимаются решения, которые реально двигают НПА, государственные программы и иные формальные институты по процедуре.</p></div>
   <div className="votesHeroState"><strong>{openCount}</strong><span>открытых голосований</span><button onClick={onOpenStages}>Этапы игры →</button></div>
  </section>

  {teacher&&<details className="teacherDetails voteManual projectDisclosure">
   <DisclosureSummary icon={VoteIcon} title="Открыть отдельное голосование" description="Самостоятельный вопрос или документ из реестра НПА"/>
   <div className="teacherDetailsBody">
    <div className="voteBuilder modern">
     <input aria-label="Вопрос голосования" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Вопрос голосования"/>
     <FormalDocumentPicker documents={formalDocuments} value={formalId?[formalId]:[]} onChange={chooseNpa} multiple={false}/>
     <textarea aria-label="Проект решения" value={body} onChange={e=>setBody(e.target.value)} placeholder="Проект решения / пояснение"/>
     <div className="voteBuilderGrid">
      <StyledSelect label="Кто голосует" value={institution} onChange={key=>{setInstitution(key);setMode(key==='gd'?'mandate':'member');setQuorumValue(VOTING_BODIES.find(b=>b.key===key)?.quorum||.5);setMajorityKind(key==='gd'?'eligible_majority':'present_majority')}} options={[{value:'all',label:'Все участники'},{value:'factions',label:'Фракции'},...VOTING_BODIES.map(b=>({value:b.key,label:b.title})),...units.map(u=>({value:'unit:'+u.id,label:u.title}))]}/>
      <StyledSelect label="Учебная группа" value={group} onChange={setGroup} options={[{value:'',label:'Все группы'},...groups.map(s=>({value:s,label:s}))]}/>
      <StyledSelect label="Способ подсчёта" value={mode} onChange={v=>setMode(v as typeof mode)} options={institution==='gd'?[{value:'mandate',label:'По числу депутатских мандатов'}]:['all','factions'].includes(institution)?[{value:'member',label:'Один участник — один голос'},{value:'faction',label:'Одна фракция — один голос'}]:[{value:'member',label:'Один участник — один голос'}]}/>
      <StyledSelect label="Кворум" value={String(quorumValue)} onChange={v=>setQuorumValue(Number(v))}
       options={[...(institution==='ks'?[{value:String(6/11),label:'Учебный кворум КС · 6/11'}]:[]),{value:'0.5',label:'Не менее 1/2'},{value:String(2/3),label:'Не менее 2/3'},{value:'0.75',label:'Не менее 3/4'}]}/>
      <StyledSelect label="Порог решения" value={majorityKind} onChange={v=>setMajorityKind(v as typeof majorityKind)}
       options={[{value:'present_majority',label:'Большинство присутствующих'},{value:'eligible_majority',label:'Большинство от общего состава'},
       {value:'eligible_fraction',label:'Доля от общего состава'},{value:'yes_no_simple',label:'Больше «за», чем «против»'}]}/>
     </div>
     {majorityKind==='eligible_fraction'&&<StyledSelect label="Необходимая доля" value={String(majorityValue)}
       onChange={v=>setMajorityValue(Number(v))} options={[{value:String(2/3),label:'2/3'},{value:'0.75',label:'3/4'}]}/>}
     <p className="civicVoteBase">{institution==='gd'?'Общий состав: 450 мандатов. GV уменьшает доступные голоса, сохраняя базу расчёта кворума.':['government','municipality'].includes(institution)?'Общий состав: '+members.filter(m=>m.kind==='student'&&(!group||m.group_name===group)).length+' студентов выбранной группы.':'Состав и право голоса фиксируются при открытии процедуры.'}</p><button className="primary" disabled={title.trim().length<3} onClick={create}>Открыть голосование</button>
    </div>
   </div>
  </details>}

  <section className="npaVoteQueue"><header><h2>НПА, ожидающие голосования</h2><span>{pendingNpas.length}</span></header><p>Документы появляются здесь автоматически при переходе на стадию голосования. Правила процедуры берутся из документа.</p>{pendingNpas.map(d=>{const preset=votePresetForDocument(d)!;return <article key={d.id}><div><small>{d.registry_no} · {d.status_label}</small><b>{d.title}</b><span>{institutionLabel(preset.institutionKey)}</span></div><button className="secondary" onClick={()=>onOpenDocument(d.id)}>Открыть НПА</button><button className="primary" disabled={busy===d.id} onClick={()=>void openNpa(d.id)}>{busy===d.id?'Открывается…':'Открыть голосование'}</button></article>})}{!pendingNpas.length&&<span>Сейчас нет документов на стадии голосования.</span>}</section>
  <InstitutionRegistrationPanel g={g} onUnitsChange={setUnits}/>
  <section className="votesOverview">
   <article><small>ВСЕГО</small><strong>{votes.length}</strong><span>процедур</span></article>
   <article><small>ПРИНЯТО</small><strong>{votes.filter(v=>v.result_code==='passed').length}</strong><span>решений</span></article>
   <article><small>ОТКЛОНЕНО</small><strong>{votes.filter(v=>v.result_code==='rejected').length}</strong><span>решений</span></article>
   <article><small>БЕЗ КВОРУМА</small><strong>{votes.filter(v=>v.result_code==='no_quorum').length}</strong><span>заседаний</span></article>
  </section>



  <input className="civicVoteSearch" aria-label="Поиск голосований" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Поиск по вопросу, органу или группе"/>
  <div className="voteTabs"><button className={tab==='open'?'active':''} onClick={()=>{onClearFocus?.();setTab('open')}}>Открытые <span>{openCount}</span></button><button className={tab==='closed'?'active':''} onClick={()=>{onClearFocus?.();setTab('closed')}}>Завершённые</button><button className={tab==='all'?'active':''} onClick={()=>{onClearFocus?.();setTab('all')}}>Все</button></div>

  <div className="proceduralVoteList">{visible.length===0?<div className="emptyState">В этой категории голосований пока нет.</div>:visible.map(v=>{
   const t=tally(v),q=quorum(v,checkedIn),my=ballots.find(b=>b.vote_id===v.id&&b.voter_id===me?.user_id);
   const doc=v.formal_document_id?formalDocuments.find(d=>d.id===v.formal_document_id):undefined;
   const stage=stages.find(s=>s.stage_no===v.stage_no);
   const denominator=Math.max(1,t.yes+t.no+t.abstain);
   const rule=majorityLabel(v.majority_kind,Number(v.majority_value));
   return <article id={'vote-'+v.id} tabIndex={-1} className={'proceduralVoteCard '+v.status+(focusId===v.id?' isFocused':'')} key={v.id}>
    <header>
     <div className="voteInstitution"><span>✓</span><div><small>{v.electorate_snapshot?.institution_label||institutionLabel(v.institution_key)}</small><b>{v.title}</b></div></div>
     <div className={'voteState '+(v.status==='open'?'live':v.result_code||'closed')}>{v.status==='open'?'● ГОЛОСОВАНИЕ ИДЁТ':v.result_label||'ЗАВЕРШЕНО'}</div>
    </header>

    {(doc||stage)&&<div className="voteRelations">
     {doc&&<button onClick={()=>onOpenDocument(doc.id)}><small>СВЯЗАННЫЙ НПА</small><b>{doc.registry_no}</b><span>{doc.title}</span></button>}
     {stage&&<button onClick={onOpenStages}><small>ЭТАП ИГРЫ</small><b>{stage.stage_no}. {stage.title}</b><span>{v.formal_step_code?'Стадия НПА: '+v.formal_step_code:'Открыть описание этапа'}</span></button>}
    </div>}

    {v.body&&<p className="voteBody">{v.body}</p>}

    <div className="voteRuleStrip">
     <div><small>КВОРУМ</small><b>{v.quorum_kind==='none'?'Не требуется':q.needed+' из '+q.eligible}</b></div>
     <div><small>РЕШЕНИЕ</small><b>{rule}</b></div>
     <div><small>ФОРМАТ</small><b>{v.voting_mode==='mandate'?'по числу мандатов':v.voting_mode==='faction'?'одна фракция — один голос':'персонально'}</b></div>
    </div>

    <div className="quorumMeter"><div><span>Присутствует: {q.present} из {q.eligible} · Подано: {q.cast}</span><b className={q.met?'ok':'wait'}>{q.met?'КВОРУМ ЕСТЬ':'НУЖНО '+Math.max(0,q.needed-q.present)}</b></div><i><em style={{width:Math.min(100,pct(q.present,q.eligible))+'%'}}/></i></div>
    {v.voting_mode==='mandate'&&<details className="deputyRegistration" open={v.status==='open'}>
     <summary><div><small>РЕГИСТРАЦИЯ ДЕПУТАТОВ</small><b>Кто представляет голоса фракций на этом заседании</b></div><span>{partyMandates.filter(a=>v.procedure_key!=='registered_session'||checkedIn.some(r=>r.user_id===a.user_id&&r.institution_key===v.institution_key&&r.stage_no===v.stage_no)).reduce((a,x)=>a+x.effective_mandates,0)} / {parties.reduce((a,p)=>a+Number(p.mandates||0),0)} участвует · GV −{parties.reduce((a,p)=>a+Math.min(p.mandates,p.ghost_loss_current),0)}</span></summary>
     <div className="deputyRegistrationBody">
      {parties.filter(p=>p.mandates>0).map(p=>{
       const rows=partyMandates.filter(x=>x.party_id===p.id);
       const base=rows.reduce((a,x)=>a+x.base_mandates,0);
       const effective=rows.reduce((a,x)=>a+x.effective_mandates,0);
       return <article key={p.id}>
        <header><span style={{background:p.color}}>{p.name.slice(0,2).toUpperCase()}</span><div><b>{p.name}</b><small>{base} мандатов · {effective} доступно{p.ghost_active?' · GV −'+p.ghost_loss_current:''}{p.representation_penalty?' · Потеря мест −'+p.representation_penalty:''}</small></div></header>
        <div>{rows.map(a=>{const m=members.find(x=>x.user_id===a.user_id);return <div className="deputyStudentRow" key={a.user_id}><b>{m?.full_name||'Участник'}</b><span>{a.base_mandates} манд.</span><em>{[a.ghost_loss?'−'+a.ghost_loss+' GV':'',a.representation_loss?'−'+a.representation_loss+' мест':''].filter(Boolean).join(' · ')||'—'}</em><strong>{a.effective_mandates} голосов {v.procedure_key==='registered_session'?(checkedIn.some(r=>r.user_id===a.user_id&&r.institution_key===v.institution_key&&r.stage_no===v.stage_no)?'· На заседании':'· Не зарегистрирован'):''}</strong></div>})}</div>
       </article>
      })}
     </div>
    </details>}

    <div className="voteResultBoard">
     <div className="voteNumber yes"><strong>{t.yes}</strong><span>ЗА</span><small>{pct(t.yes,denominator)}%</small></div>
     <div className="voteVisual"><i className="yes" style={{width:pct(t.yes,denominator)+'%'}}/><i className="abstain" style={{width:pct(t.abstain,denominator)+'%'}}/><i className="no" style={{width:pct(t.no,denominator)+'%'}}/></div>
     <div className="voteNumber abstain"><strong>{t.abstain}</strong><span>ВОЗД.</span><small>{pct(t.abstain,denominator)}%</small></div>
     <div className="voteNumber no"><strong>{t.no}</strong><span>ПРОТИВ</span><small>{pct(t.no,denominator)}%</small></div>
    </div>

    {v.status==='open'?<div className="proceduralVoteActions">
     <VoteBallotControls vote={v} maxWeight={g.ballotWeight(v)} canCast={canCast(v)} ballot={my} onSubmit={(yes,no,abstain)=>g.castVoteAllocation(v,yes,no,abstain)}/>
     {!canVote(v)&&<small className="voteNotEligible">Вашей игровой роли не предоставлено право голоса в этой процедуре.</small>}
     {canVote(v)&&!isRegisteredForVote(v)&&<small className="voteNotEligible">Сначала отметьте присутствие в панели регистрации выше, затем голосуйте.</small>}
     {v.voting_mode==='mandate'&&canVote(v)&&<small className="myMandateWeight">Ваш вес в этом голосовании: <b>{partyMandates.find(x=>x.user_id===me?.user_id)?.effective_mandates||0}</b> депутатских голосов.</small>}
     {canClose(v)&&<button className="primary closeProceduralVote" disabled={busy===v.id} onClick={async()=>{if(!confirm('Закрыть голосование и зафиксировать результат?'))return;setBusy(v.id);await closeVote(v.id);setBusy('')}}>{busy===v.id?'Подсчитываю…':'Закрыть и применить результат →'}</button>}
    </div>:<div className={'finalVoteDecision '+(v.result_code||'')}>
     <div><small>ИТОГОВОЕ РЕШЕНИЕ</small><strong>{v.result_label||'Голосование завершено'}</strong>{v.decision_note&&<p>{v.decision_note}</p>}</div>
     <div><span>За <b>{v.result_yes??t.yes}</b></span><span>Против <b>{v.result_no??t.no}</b></span><span>Воздержались <b>{v.result_abstain??t.abstain}</b></span></div>
    </div>}

    <footer><span>Открыто {time(v.opened_at)}</span>{v.closed_at&&<span>Завершено {time(v.closed_at)}</span>}{doc&&<span>Результат связан с движением НПА</span>}</footer>
   </article>
  })}</div>
 </div>;
}
