'use client';
import {useEffect,useState} from 'react';
import {MessageCircle,ClipboardCheck,Vote,LibraryBig} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import type {View} from './types';

type Proposal={id:string;game_id:string;system_type:'relative'|'absolute'|'qualified'|'preferential';threshold_pct:number|null;rationale:string|null;status:'draft'|'registered'|'vote_open'|'adopted'|'rejected'|'superseded';vote_id:string|null;proposed_by:string;created_at:string;updated_at:string;registered_at:string|null;bill_document_id:string|null;session_id:string|null;agenda_item_id:string|null;resolution_document_id:string|null};
const labels={relative:'Относительное большинство',absolute:'Абсолютное большинство',qualified:'Квалифицированное большинство',preferential:'Преференциальное большинство'} as const;

export default function PresidentialSystemDecisionPanel({g,onOpenVotes,onNavigate,onOpenDocument,stageNo=6}:{g:ReturnTypeRepublic;onOpenVotes:(voteId?:string)=>void;onNavigate?:(view:View)=>void;onOpenDocument?:(id:string)=>void;stageNo?:6|7}){
 const {game,me,teacher,parties,members,votes,formalDocuments,setError}=g;
 const [rows,setRows]=useState<Proposal[]>([]);
 const [system,setSystem]=useState<Proposal['system_type']>('absolute');
 const [threshold,setThreshold]=useState(60);
 const [rationale,setRationale]=useState('');
 const [resolutionBody,setResolutionBody]=useState('');
 const [registrations,setRegistrations]=useState<Array<{user_id:string;institution_key:string;stage_no:number}>>([]);
 const [busy,setBusy]=useState(false);
 const role=(me?.role_title||'').toLowerCase();
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const canPropose=teacher||!!ledParty;
 const canCreateSf=teacher||role.includes('совет федерац')||role.includes('сенатор');
 const sessionBody=stageNo===6?'gd':'sf';

 async function load(){
  if(!game)return;
  const [r,reg]=await Promise.all([
   supabase.from('presidential_system_proposals').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('institution_session_registrations').select('user_id,institution_key,stage_no').eq('game_id',game.id).eq('stage_no',stageNo).eq('institution_key',sessionBody)
  ]);
  if(!r.error)setRows((r.data||[]) as Proposal[]);
  if(!reg.error)setRegistrations(reg.data||[]);
 }
 useEffect(()=>{void load()},[game?.id,stageNo]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('presidential-system:'+game.id+':'+stageNo)
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_system_proposals',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'institution_session_registrations',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id,stageNo]);

 if(!game||!me)return null;
 const activeGame=game;
 const adopted=rows.find(x=>x.status==='adopted');
 const visible=rows.filter(x=>x.status!=='superseded');
 const sfResolution=formalDocuments.find(d=>d.stage_no===7&&d.doc_type==='sf_resolution'&&d.metadata?.purpose==='presidential_election_appointment');
 const proposer=(id:string)=>members.find(m=>m.user_id===id)?.full_name||'Фракция';
 const vote=(id:string|null)=>id?votes.find(v=>v.id===id):undefined;
 const publicChannel=g.channels.find(channel=>channel.kind==='public'&&channel.name!=='Вне игры'&&['Публичная политика','Общая беседа','Общий штаб','Общий чат'].includes(channel.name))||g.channels.find(channel=>channel.kind==='public'&&channel.name!=='Вне игры');
 const stageVotes=votes.filter(v=>v.stage_no===stageNo&&v.institution_key===sessionBody);
 const stageDocs=formalDocuments.filter(d=>d.stage_no===stageNo);
 const myRegistered=registrations.some(r=>r.user_id===me.user_id);
 const openStageVotes=stageVotes.filter(v=>v.status==='open');
 const activeProposal=visible.find(x=>['vote_open','registered','adopted'].includes(x.status))||visible[0];
 const linkedDocument=stageNo===7
  ?sfResolution
  :formalDocuments.find(d=>d.id===(activeProposal?.resolution_document_id||activeProposal?.bill_document_id))||stageDocs.find(d=>d.metadata?.purpose==='presidential_electoral_system')||stageDocs[0];
 const canEnterDiscussion=teacher||myRegistered;
 const canOpenVoteSystem=stageVotes.length>0||!!linkedDocument;
 function openPublicChat(){if(!publicChannel||!canEnterDiscussion)return;g.setChannelId(publicChannel.id);g.setChatOpen(true)}
 const activeVoteId=activeProposal?.vote_id||openStageVotes[0]?.id||stageVotes[0]?.id||null;
 function openRegistration(){onOpenVotes(activeVoteId||undefined)}
 function openRegistry(){
  if(linkedDocument&&onOpenDocument){onOpenDocument(linkedDocument.id);return}
  onNavigate?.('documents');
 }
 const procedureHub=<section className="presProcedureHub" aria-label={stageNo===6?'Маршрут заседания Государственной Думы':'Маршрут заседания Совета Федерации'}>
  <header className="presProcedureHubHead"><div><small>МАРШРУТ ЗАСЕДАНИЯ</small><b>{stageNo===6?'Государственная Дума':'Совет Федерации'} · этап {stageNo}</b></div><span>Регистрация → обсуждение → НПА → голосование</span></header>
  <div className="presProcedureHubActions">
   <button type="button" className={myRegistered?'isDone':activeVoteId?'isCurrent':'isWaiting'} disabled={!activeVoteId} onClick={openRegistration}><span className="presProcedureStepNo">01</span><ClipboardCheck size={18}/><span><small>ПРИСУТСТВИЕ</small><b>Регистрация на заседание</b><em>{myRegistered?'Вы зарегистрированы':activeVoteId?'Открыть через «Голосование» · зарегистрировано: '+registrations.length:'Сначала создайте проект'}</em></span></button>
   <button type="button" className={canEnterDiscussion?'isReady':'isLocked'} disabled={!publicChannel||!canEnterDiscussion} onClick={openPublicChat}><span className="presProcedureStepNo">02</span><MessageCircle size={18}/><span><small>ОБСУЖДЕНИЕ</small><b>Публичный чат</b><em>{!publicChannel?'Нет публичного канала':canEnterDiscussion?'Открыть обсуждение':'Сначала зарегистрируйтесь'}</em></span></button>
   <button type="button" className={linkedDocument?'isDone':'isWaiting'} onClick={openRegistry} disabled={!onNavigate&&!onOpenDocument}><span className="presProcedureStepNo">03</span><LibraryBig size={18}/><span><small>ДОКУМЕНТ</small><b>Реестр НПА</b><em>{linkedDocument?(linkedDocument.registry_no||'Документ создан')+' · '+linkedDocument.status_label:'Проект появится после регистрации'}</em></span></button>
   <button type="button" className={openStageVotes.length?'isLive':stageVotes.length?'isDone':'isWaiting'} onClick={()=>onOpenVotes(activeVoteId||undefined)} disabled={!canOpenVoteSystem}><span className="presProcedureStepNo">04</span><Vote size={18}/><span><small>РЕШЕНИЕ</small><b>Голосование</b><em>{openStageVotes.length?'Открыто: '+openStageVotes.length:stageVotes.length?'Завершено: '+stageVotes.length:linkedDocument?'Открыть голосование по НПА':'Сначала зарегистрируйте проект'}</em></span></button>
  </div>
 </section>;

 async function propose(){
  setBusy(true);
  const r=await supabase.rpc('propose_presidential_system',{p_game_id:activeGame.id,p_system_type:system,p_threshold_pct:system==='qualified'?threshold:null,p_rationale:rationale.trim()||null});
  if(r.error)setError(r.error.message);
  else{
   setRationale('');
   await g.refresh();
   await load();
  }
  setBusy(false);
 }
 async function createResolution(){
  setBusy(true);const r=await supabase.rpc('create_presidential_election_appointment_resolution',{p_game_id:activeGame.id,p_body:resolutionBody.trim()||null});
  if(r.error)setError(r.error.message);else setResolutionBody('');setBusy(false);
 }

 if(stageNo===7)return <section className="presSystemDecision presSystemAppointmentOnly">{procedureHub}<section className="sfAppointment"><div><small>СОВЕТ ФЕДЕРАЦИИ · ЭТАП 7</small><h4>Постановление о назначении выборов Президента РФ</h4><p>{sfResolution?<>Создано: <b>{sfResolution.registry_no}</b> · {sfResolution.status_label}</>:<>Формальный акт ещё не создан.</>}</p></div>{canCreateSf&&!sfResolution&&<div className="sfAppointmentCreate"><textarea rows={2} value={resolutionBody} onChange={e=>setResolutionBody(e.target.value)} placeholder="Необязательно: уточните игровой срок проведения выборов"/><button className="primary" disabled={busy} onClick={()=>void createResolution()}>Создать постановление СФ</button></div>}</section></section>;

 return <section className="presSystemDecision">
  <header><div><small>ГОСУДАРСТВЕННАЯ ДУМА ФС РФ · ЭТАП 6</small><h3>Поправка к ФЗ № 19-ФЗ о системе выборов Президента</h3><p>Фракция создаёт проект поправки. Система сразу добавляет законопроект в реестр НПА и создаёт связанное голосование ГД. Участники регистрируются на заседание, обсуждают проект и голосуют. Принятое решение автоматически синхронизирует модель выборов и открывает процедуру ЦИК ниже.</p></div><button type="button" className={'presSystemAdopted '+(adopted?'isReady':'')} disabled={!adopted} onClick={()=>document.getElementById('stage6-cec')?.scrollIntoView({behavior:'smooth',block:'start'})}><small>ДЕЙСТВУЕТ</small><strong>{adopted?labels[adopted.system_type]:'Решение не принято'}</strong>{adopted?.system_type==='qualified'&&<span>{adopted.threshold_pct}%</span>}{adopted&&<em>Перейти к ЦИК ↓</em>}</button></header>

  {procedureHub}
  {canPropose&&<div className="presSystemProposal"><label>Система<select value={system} onChange={e=>setSystem(e.target.value as Proposal['system_type'])}><option value="relative">Относительное большинство</option><option value="absolute">Абсолютное большинство</option><option value="qualified">Квалифицированное большинство</option><option value="preferential">Преференциальное большинство</option></select></label>{system==='qualified'&&<label>Порог, %<input type="number" min="51" max="100" value={threshold} onChange={e=>setThreshold(Math.max(51,Math.min(100,Number(e.target.value)||60)))}/></label>}<label className="wide">Позиция фракции<textarea rows={2} value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="Почему именно эта модель должна применяться на выборах Президента?"/></label><button className="primary" disabled={busy} onClick={()=>void propose()}>Создать проект поправки</button></div>}

  <div className="presSystemList">{visible.map(p=>{const v=vote(p.vote_id);const bill=p.bill_document_id?formalDocuments.find(d=>d.id===p.bill_document_id):undefined;const resolution=p.resolution_document_id?formalDocuments.find(d=>d.id===p.resolution_document_id):undefined;return <article key={p.id} className={p.status}>
   <div className="presSystemProposalMain"><small>{proposer(p.proposed_by)}</small><b>{labels[p.system_type]}</b>{p.rationale&&<p>{p.rationale}</p>}<div className="presSystemRoute">
    <span className="done">1 · Проект создан</span>
    <span className={p.bill_document_id?'done':''}>2 · НПА в реестре</span>
    <span className={p.vote_id?'done':''}>3 · Голосование создано</span>
    <span className={p.resolution_document_id?'done':''}>4 · Решение ГД</span>
   </div>
   {bill&&<p className="presSystemDocumentRef">Законопроект: <b>{bill.registry_no||'зарегистрирован'}</b> · {bill.status_label}</p>}
   {resolution&&<p className="presSystemDocumentRef">Постановление: <b>{resolution.registry_no||'оформлено'}</b> · {resolution.status_label}</p>}
   </div>
   <div className="presSystemProposalActions"><span>{p.status==='adopted'?'Принято':p.status==='vote_open'?'На голосовании':p.status==='registered'?'Зарегистрировано':p.status==='rejected'?'Отклонено':'Проект'}</span>{p.system_type==='qualified'&&<em>{p.threshold_pct}%</em>}{v&&<em>{v.status==='open'?'голосование открыто':v.result_label||'закрыто'}</em>}
    {bill&&<button onClick={()=>onOpenDocument?.(bill.id)}>Открыть проект НПА →</button>}
    {v?.status==='open'&&<button className="primary" onClick={()=>onOpenVotes(v.id)}>Перейти к голосованию →</button>}
   </div>
  </article>})}</div>

 </section>;
}
