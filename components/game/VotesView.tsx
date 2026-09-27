'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Vote} from './types';
import {institutionLabel,majorityLabel} from './proceduralVoting';

function pct(n:number,d:number){return d>0?Math.round(n/d*100):0}
function time(v:string){return new Date(v).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}

export default function VotesView({g,onOpenDocument,onOpenStages}:{g:ReturnTypeRepublic;onOpenDocument:(id:string)=>void;onOpenStages:()=>void}){
 const {votes,ballots,me,teacher,formalDocuments,stages,parties,members,partyMandates,createVote,canVote,castVote,closeVote,tally,quorum}=g;
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[mode,setMode]=useState<'member'|'faction'|'mandate'>('faction');
 const [institution,setInstitution]=useState('all'),[quorumValue,setQuorumValue]=useState(0.5),[majorityKind,setMajorityKind]=useState<'yes_no_simple'|'present_majority'|'eligible_majority'|'eligible_fraction'>('present_majority'),[majorityValue,setMajorityValue]=useState(0.5);
 const [tab,setTab]=useState<'open'|'closed'|'all'>('open'),[busy,setBusy]=useState('');

 const visible=useMemo(()=>votes.filter(v=>tab==='all'||v.status===tab),[votes,tab]);
 const openCount=votes.filter(v=>v.status==='open').length;

 async function create(){
  const ok=await createVote({title,body,mode,institutionKey:institution,procedureKey:'manual',quorumKind:'fraction',quorumValue,majorityKind,majorityValue,allowAbstain:true,tieBreakerChair:institution==='government'});
  if(ok){setTitle('');setBody('')}
 }

 function canClose(v:Vote){
  if(teacher)return true;if(!me)return false;
  const role=(me.role_title||'').toLowerCase();
  if(v.institution_key==='gd')return (role.includes('председател')&&role.includes('дум'))||(role.includes('совет')&&role.includes('дум'));
  if(v.institution_key==='government')return role.includes('председател')&&role.includes('правительств');
  if(v.institution_key==='sf')return role.includes('председател')&&role.includes('совет')&&role.includes('федерац');
  if(v.institution_key==='committee')return role.includes('председател')&&role.includes('комитет');
  if(v.institution_key==='municipality')return role.includes('глава города')||role.includes('глава')&&role.includes('муницип');
  return false;
 }

 return <div className="votesPage">
  <section className="votesHero">
   <div><small>ПРОЦЕДУРНЫЙ ЦЕНТР</small><h1>Голосования</h1><p>Здесь принимаются решения, которые реально двигают НПА, государственные программы и иные формальные институты по процедуре.</p></div>
   <div className="votesHeroState"><strong>{openCount}</strong><span>открытых голосований</span><button onClick={onOpenStages}>Этапы игры →</button></div>
  </section>

  <section className="votesOverview">
   <article><small>ВСЕГО</small><strong>{votes.length}</strong><span>процедур</span></article>
   <article><small>ПРИНЯТО</small><strong>{votes.filter(v=>v.result_code==='passed').length}</strong><span>решений</span></article>
   <article><small>ОТКЛОНЕНО</small><strong>{votes.filter(v=>v.result_code==='rejected').length}</strong><span>решений</span></article>
   <article><small>БЕЗ КВОРУМА</small><strong>{votes.filter(v=>v.result_code==='no_quorum').length}</strong><span>заседаний</span></article>
  </section>

  {teacher&&<details className="teacherDetails voteManual">
   <summary><div><b>Открыть отдельное голосование</b><span>Для вопросов, не привязанных к конкретному НПА</span></div><i>+</i></summary>
   <div className="teacherDetailsBody">
    <div className="voteBuilder modern">
     <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Вопрос голосования"/>
     <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Проект решения / пояснение"/>
     <div className="voteBuilderGrid">
      <label>Кто голосует<select value={institution} onChange={e=>setInstitution(e.target.value)}><option value="all">Все участники</option><option value="gd">Государственная Дума</option><option value="government">Правительство РФ</option><option value="sf">Совет Федерации</option><option value="committee">Профильный комитет</option><option value="municipality">Муниципальный орган</option></select></label>
      <label>Способ подсчёта<select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="member">Один участник — один голос</option><option value="faction">Одна фракция — один голос</option><option value="mandate">Вес = число мандатов</option></select></label>
      <label>Кворум<select value={quorumValue} onChange={e=>setQuorumValue(Number(e.target.value))}><option value={0.5}>Не менее 1/2</option><option value={2/3}>Не менее 2/3</option><option value={0.75}>Не менее 3/4</option></select></label>
      <label>Порог решения<select value={majorityKind} onChange={e=>setMajorityKind(e.target.value as typeof majorityKind)}><option value="present_majority">Большинство присутствующих</option><option value="eligible_majority">Большинство от общего состава</option><option value="eligible_fraction">Доля от общего состава</option><option value="yes_no_simple">Больше «за», чем «против»</option></select></label>
     </div>
     {majorityKind==='eligible_fraction'&&<label className="voteFraction">Необходимая доля<select value={majorityValue} onChange={e=>setMajorityValue(Number(e.target.value))}><option value={2/3}>2/3</option><option value={0.75}>3/4</option></select></label>}
     <button className="primary" onClick={create}>Открыть голосование</button>
    </div>
   </div>
  </details>}

  <div className="voteTabs"><button className={tab==='open'?'active':''} onClick={()=>setTab('open')}>Открытые <span>{openCount}</span></button><button className={tab==='closed'?'active':''} onClick={()=>setTab('closed')}>Завершённые</button><button className={tab==='all'?'active':''} onClick={()=>setTab('all')}>Все</button></div>

  <div className="proceduralVoteList">{visible.length===0?<div className="emptyState">В этой категории голосований пока нет.</div>:visible.map(v=>{
   const t=tally(v),q=quorum(v),my=ballots.find(b=>b.vote_id===v.id&&b.voter_id===me?.user_id);
   const doc=v.formal_document_id?formalDocuments.find(d=>d.id===v.formal_document_id):undefined;
   const stage=stages.find(s=>s.stage_no===v.stage_no);
   const denominator=Math.max(1,t.yes+t.no+t.abstain);
   const rule=majorityLabel(v.majority_kind,Number(v.majority_value));
   return <article className={'proceduralVoteCard '+v.status} key={v.id}>
    <header>
     <div className="voteInstitution"><span>✓</span><div><small>{institutionLabel(v.institution_key)}</small><b>{v.title}</b></div></div>
     <div className={'voteState '+(v.status==='open'?'live':v.result_code||'closed')}>{v.status==='open'?'● ГОЛОСОВАНИЕ ИДЁТ':v.result_label||'ЗАВЕРШЕНО'}</div>
    </header>

    {(doc||stage)&&<div className="voteRelations">
     {doc&&<button onClick={()=>onOpenDocument(doc.id)}><small>СВЯЗАННЫЙ НПА</small><b>{doc.registry_no}</b><span>{doc.title}</span></button>}
     {stage&&<button onClick={onOpenStages}><small>ЭТАП ИГРЫ</small><b>{stage.stage_no}. {stage.title}</b><span>{v.formal_step_code?'Стадия НПА: '+v.formal_step_code:'Открыть описание этапа'}</span></button>}
    </div>}

    {v.body&&<p className="voteBody">{v.body}</p>}

    <div className="voteRuleStrip">
     <div><small>КВОРУМ</small><b>{v.quorum_kind==='none'?'Не требуется':Math.round(Number(v.quorum_value)*100)+'% состава'}</b></div>
     <div><small>РЕШЕНИЕ</small><b>{rule}</b></div>
     <div><small>ФОРМАТ</small><b>{v.voting_mode==='mandate'?'по числу мандатов':v.voting_mode==='faction'?'одна фракция — один голос':'персонально'}</b></div>
    </div>

    <div className="quorumMeter"><div><span>Участие: {q.cast} из {q.eligible}</span><b className={q.met?'ok':'wait'}>{q.met?'КВОРУМ ЕСТЬ':'НУЖНО '+Math.max(0,q.needed-q.cast)}</b></div><i><em style={{width:Math.min(100,pct(q.cast,q.eligible))+'%'}}/></i></div>
    {v.voting_mode==='mandate'&&<details className="deputyRegistration" open={v.status==='open'}>
     <summary><div><small>РЕГИСТРАЦИЯ ДЕПУТАТОВ</small><b>Кто представляет голоса фракций на этом заседании</b></div><span>{partyMandates.reduce((a,x)=>a+x.effective_mandates,0)} / {parties.reduce((a,p)=>a+Number(p.mandates||0),0)} присутствует</span></summary>
     <div className="deputyRegistrationBody">
      {parties.filter(p=>p.mandates>0).map(p=>{
       const rows=partyMandates.filter(x=>x.party_id===p.id);
       const base=rows.reduce((a,x)=>a+x.base_mandates,0);
       const effective=rows.reduce((a,x)=>a+x.effective_mandates,0);
       return <article key={p.id}>
        <header><span style={{background:p.color}}>{p.name.slice(0,2).toUpperCase()}</span><div><b>{p.name}</b><small>{base} мандатов · {effective} зарегистрировано{p.ghost_active?' · GV −'+p.ghost_loss_current:''}</small></div></header>
        <div>{rows.map(a=>{const m=members.find(x=>x.user_id===a.user_id);return <div className="deputyStudentRow" key={a.user_id}><b>{m?.full_name||'Участник'}</b><span>{a.base_mandates} манд.</span>{a.ghost_loss?<em>−{a.ghost_loss} GV</em>:<em>—</em>}<strong>{a.effective_mandates} голосов</strong></div>})}</div>
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
     <div className="voteChoiceButtons">
      <button disabled={!canVote(v)} className={my?.choice==='yes'?'selected yes':''} onClick={()=>castVote(v,'yes')}>✓ За</button>
      {v.allow_abstain&&<button disabled={!canVote(v)} className={my?.choice==='abstain'?'selected abstain':''} onClick={()=>castVote(v,'abstain')}>○ Воздержаться</button>}
      <button disabled={!canVote(v)} className={my?.choice==='no'?'selected no':''} onClick={()=>castVote(v,'no')}>× Против</button>
     </div>
     {!canVote(v)&&<small className="voteNotEligible">Вашей игровой роли не предоставлено право голоса в этой процедуре.</small>}
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