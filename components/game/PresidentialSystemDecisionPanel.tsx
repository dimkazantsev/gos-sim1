'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type Proposal={id:string;game_id:string;system_type:'relative'|'absolute'|'qualified'|'preferential';threshold_pct:number|null;rationale:string|null;status:'draft'|'registered'|'vote_open'|'adopted'|'rejected'|'superseded';vote_id:string|null;proposed_by:string;created_at:string;updated_at:string;registered_at:string|null;bill_document_id:string|null;session_id:string|null;agenda_item_id:string|null;resolution_document_id:string|null};
const labels={relative:'Относительное большинство',absolute:'Абсолютное большинство',qualified:'Квалифицированное большинство',preferential:'Преференциальное большинство'} as const;

export default function PresidentialSystemDecisionPanel({g,onOpenVotes,stageNo=6}:{g:ReturnTypeRepublic;onOpenVotes:()=>void;stageNo?:6|7}){
 const {game,me,teacher,parties,members,votes,formalDocuments,setError}=g;
 const [rows,setRows]=useState<Proposal[]>([]);
 const [system,setSystem]=useState<Proposal['system_type']>('absolute');
 const [threshold,setThreshold]=useState(60);
 const [rationale,setRationale]=useState('');
 const [resolutionBody,setResolutionBody]=useState('');
 const [busy,setBusy]=useState(false);
 const role=(me?.role_title||'').toLowerCase();
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const canPropose=teacher||!!ledParty;
 const canManageVote=teacher||(role.includes('председател')&&role.includes('дум'))||(role.includes('совет')&&role.includes('дум'));
 const canCreateSf=teacher||role.includes('совет федерац')||role.includes('сенатор');

 async function load(){
  if(!game)return;
  const r=await supabase.from('presidential_system_proposals').select('*').eq('game_id',game.id).order('created_at',{ascending:false});
  if(!r.error)setRows((r.data||[]) as Proposal[]);
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('presidential-system:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_system_proposals',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const activeGame=game;
 const adopted=rows.find(x=>x.status==='adopted');
 const visible=rows.filter(x=>x.status!=='superseded');
 const sfResolution=formalDocuments.find(d=>d.stage_no===7&&d.doc_type==='sf_resolution'&&d.metadata?.purpose==='presidential_election_appointment');
 const proposer=(id:string)=>members.find(m=>m.user_id===id)?.full_name||'Фракция';
 const vote=(id:string|null)=>id?votes.find(v=>v.id===id):undefined;

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

 if(stageNo===7)return <section className="presSystemDecision presSystemAppointmentOnly"><section className="sfAppointment"><div><small>СОВЕТ ФЕДЕРАЦИИ · ЭТАП 7</small><h4>Постановление о назначении выборов Президента РФ</h4><p>{sfResolution?<>Создано: <b>{sfResolution.registry_no}</b> · {sfResolution.status_label}</>:<>Формальный акт ещё не создан.</>}</p></div>{canCreateSf&&!sfResolution&&<div className="sfAppointmentCreate"><textarea rows={2} value={resolutionBody} onChange={e=>setResolutionBody(e.target.value)} placeholder="Необязательно: уточните игровой срок проведения выборов"/><button className="primary" disabled={busy} onClick={()=>void createResolution()}>Создать постановление СФ</button></div>}</section></section>;

 return <section className="presSystemDecision">
  <header><div><small>ГОСУДАРСТВЕННАЯ ДУМА ФС РФ · ЭТАП 6</small><h3>Поправка к ФЗ № 19-ФЗ о системе выборов Президента</h3><p>Фракция вносит проект, Председатель ГД регистрирует его, вопрос рассматривается на заседании Государственной Думы и выносится на мандатное голосование. По итогам система выпускает постановление ГД и только после принятия синхронизирует модель выборов.</p></div><div className="presSystemAdopted"><small>ДЕЙСТВУЕТ</small><strong>{adopted?labels[adopted.system_type]:'Решение не принято'}</strong>{adopted?.system_type==='qualified'&&<span>{adopted.threshold_pct}%</span>}</div></header>

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
