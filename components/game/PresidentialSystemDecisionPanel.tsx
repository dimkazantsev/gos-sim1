'use client';
import {useEffect,useState} from 'react';
import {MessageCircle,ClipboardCheck,Vote,LibraryBig} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import type {View} from './types';

type Proposal={id:string;game_id:string;system_type:'relative'|'absolute'|'qualified'|'preferential';threshold_pct:number|null;rationale:string|null;status:'draft'|'registered'|'vote_open'|'adopted'|'rejected'|'superseded';vote_id:string|null;proposed_by:string;created_at:string;updated_at:string;registered_at:string|null;bill_document_id:string|null;session_id:string|null;agenda_item_id:string|null;resolution_document_id:string|null};
const labels={relative:'Относительное большинство',absolute:'Абсолютное большинство',qualified:'Квалифицированное большинство',preferential:'Преференциальное большинство'} as const;

export default function PresidentialSystemDecisionPanel({g,onOpenVotes,onNavigate,stageNo=6}:{g:ReturnTypeRepublic;onOpenVotes:()=>void;onNavigate?:(view:View)=>void;stageNo?:6|7}){
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
 const canManageVote=teacher||(role.includes('председател')&&role.includes('дум'))||(role.includes('совет')&&role.includes('дум'));
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
 useEffect(()=>{void load()},[game?.id]);
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
 function openPublicChat(){if(!publicChannel)return;g.setChannelId(publicChannel.id);g.setChatOpen(true)}
 function openRegistration(){
  const root=document.getElementById('stage-registration-'+stageNo);
  const details=root?.querySelector('details');
  if(details)details.setAttribute('open','');
  root?.scrollIntoView({behavior:'smooth',block:'center'});
 }
 const procedureHub=<section className="presProcedureHub" aria-label={stageNo===6?'Единый контур заседания Государственной Думы':'Единый контур заседания Совета Федерации'}>
  <div className="presProcedureHubIntro"><small>ЕДИНЫЙ КОНТУР ЗАСЕДАНИЯ</small><b>{stageNo===6?'Государственная Дума':'Совет Федерации'} · этап {stageNo}</b><span>Обсуждение, присутствие, голосование и НПА связаны с одной процедурой. Регистрация влияет на допуск к голосованию, а голосование связано с документом из реестра НПА.</span></div>
  <div className="presProcedureHubActions">
   <button type="button" disabled={!publicChannel} onClick={openPublicChat}><MessageCircle size={18}/><span><small>01 · ОБСУЖДЕНИЕ</small><b>Публичный чат</b><em>{publicChannel?'Открыть обсуждение':'Нет публичного канала'}</em></span></button>
   <button type="button" onClick={openRegistration}><ClipboardCheck size={18}/><span><small>02 · ПРИСУТСТВИЕ</small><b>Регистрация на заседание</b><em>{myRegistered?'Вы зарегистрированы':'Зарегистрировано: '+registrations.length}</em></span></button>
   <button type="button" onClick={onOpenVotes}><Vote size={18}/><span><small>03 · РЕШЕНИЕ</small><b>Голосование</b><em>{openStageVotes.length?'Открыто: '+openStageVotes.length:stageVotes.length?'Завершено: '+stageVotes.length:'Ожидает открытия'}</em></span></button>
   <button type="button" onClick={()=>onNavigate?.('documents')} disabled={!onNavigate}><LibraryBig size={18}/><span><small>04 · ДОКУМЕНТ</small><b>Реестр НПА</b><em>{stageDocs.length?'Документов этапа: '+stageDocs.length:'Документ появится после регистрации проекта'}</em></span></button>
  </div>
 </section>;

 async function propose(){
  setBusy(true);const r=await supabase.rpc('propose_presidential_system',{p_game_id:activeGame.id,p_system_type:system,p_threshold_pct:system==='qualified'?threshold:null,p_rationale:rationale.trim()||null});
  if(r.error)setError(r.error.message);else{setRationale('');await load()}setBusy(false);
 }
 async function registerProposal(id:string){
  setBusy(true);const r=await supabase.rpc('register_presidential_system_proposal',{p_proposal_id:id});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function openVote(id:string){
  setBusy(true);const r=await supabase.rpc('open_presidential_system_vote',{p_proposal_id:id});
  if(r.error)setError(r.error.message);else{await load();onOpenVotes()}setBusy(false);
 }
 async function createResolution(){
  setBusy(true);const r=await supabase.rpc('create_presidential_election_appointment_resolution',{p_game_id:activeGame.id,p_body:resolutionBody.trim()||null});
  if(r.error)setError(r.error.message);else setResolutionBody('');setBusy(false);
 }

 if(stageNo===7)return <section className="presSystemDecision presSystemAppointmentOnly">{procedureHub}<section className="sfAppointment"><div><small>СОВЕТ ФЕДЕРАЦИИ · ЭТАП 7</small><h4>Постановление о назначении выборов Президента РФ</h4><p>{sfResolution?<>Создано: <b>{sfResolution.registry_no}</b> · {sfResolution.status_label}</>:<>Формальный акт ещё не создан.</>}</p></div>{canCreateSf&&!sfResolution&&<div className="sfAppointmentCreate"><textarea rows={2} value={resolutionBody} onChange={e=>setResolutionBody(e.target.value)} placeholder="Необязательно: уточните игровой срок проведения выборов"/><button className="primary" disabled={busy} onClick={()=>void createResolution()}>Создать постановление СФ</button></div>}</section></section>;

 return <section className="presSystemDecision">
  <header><div><small>ГОСУДАРСТВЕННАЯ ДУМА ФС РФ · ЭТАП 6</small><h3>Поправка к ФЗ № 19-ФЗ о системе выборов Президента</h3><p>Фракция вносит проект, Председатель ГД регистрирует его, вопрос рассматривается на заседании Государственной Думы и выносится на мандатное голосование. По итогам система выпускает постановление ГД и только после принятия синхронизирует модель выборов.</p></div><div className="presSystemAdopted"><small>ДЕЙСТВУЕТ</small><strong>{adopted?labels[adopted.system_type]:'Решение не принято'}</strong>{adopted?.system_type==='qualified'&&<span>{adopted.threshold_pct}%</span>}</div></header>

  {procedureHub}
  {canPropose&&<div className="presSystemProposal"><label>Система<select value={system} onChange={e=>setSystem(e.target.value as Proposal['system_type'])}><option value="relative">Относительное большинство</option><option value="absolute">Абсолютное большинство</option><option value="qualified">Квалифицированное большинство</option><option value="preferential">Преференциальное большинство</option></select></label>{system==='qualified'&&<label>Порог, %<input type="number" min="51" max="100" value={threshold} onChange={e=>setThreshold(Math.max(51,Math.min(100,Number(e.target.value)||60)))}/></label>}<label className="wide">Позиция фракции<textarea rows={2} value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="Почему именно эта модель должна применяться на выборах Президента?"/></label><button className="primary" disabled={busy} onClick={()=>void propose()}>Создать проект поправки</button></div>}

  <div className="presSystemList">{visible.map(p=>{const v=vote(p.vote_id);const bill=p.bill_document_id?formalDocuments.find(d=>d.id===p.bill_document_id):undefined;const resolution=p.resolution_document_id?formalDocuments.find(d=>d.id===p.resolution_document_id):undefined;return <article key={p.id} className={p.status}>
   <div className="presSystemProposalMain"><small>{proposer(p.proposed_by)}</small><b>{labels[p.system_type]}</b>{p.rationale&&<p>{p.rationale}</p>}<div className="presSystemRoute">
    <span className="done">1 · Проект внесён</span>
    <span className={p.registered_at?'done':''}>2 · Регистрация в ГД</span>
    <span className={p.vote_id?'done':''}>3 · Заседание и голосование</span>
    <span className={p.resolution_document_id?'done':''}>4 · Постановление ГД</span>
   </div>
   {bill&&<p className="presSystemDocumentRef">Законопроект: <b>{bill.registry_no||'зарегистрирован'}</b> · {bill.status_label}</p>}
   {resolution&&<p className="presSystemDocumentRef">Постановление: <b>{resolution.registry_no||'оформлено'}</b> · {resolution.status_label}</p>}
   </div>
   <div className="presSystemProposalActions"><span>{p.status==='adopted'?'Принято':p.status==='vote_open'?'На голосовании':p.status==='registered'?'Зарегистрировано':p.status==='rejected'?'Отклонено':'Проект'}</span>{p.system_type==='qualified'&&<em>{p.threshold_pct}%</em>}{v&&<em>{v.status==='open'?'голосование открыто':v.result_label||'закрыто'}</em>}
    {canManageVote&&p.status==='draft'&&<button disabled={busy} onClick={()=>void registerProposal(p.id)}>Зарегистрировать проект</button>}
    {canManageVote&&p.status==='registered'&&<button className="primary" disabled={busy} onClick={()=>void openVote(p.id)}>Созвать заседание ГД и открыть голосование</button>}
    {v?.status==='open'&&<button onClick={onOpenVotes}>Перейти к голосованию →</button>}
   </div>
  </article>})}</div>

 </section>;
}
