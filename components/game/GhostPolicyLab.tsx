'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type Policy={id:string;game_id:string;policy_mode:'prohibited'|'justified'|'allowed';rationale:string|null;status:'draft'|'vote_open'|'adopted'|'rejected'|'superseded';vote_id:string|null;proposed_by:string;adopted_at:string|null;created_at:string};
const labels={prohibited:'Запрещено',justified:'Разрешено по уважительной причине',allowed:'Разрешено'} as const;
const cadence={
 prohibited:'Авторская формулировка: жеребьёвка проводится «через каждые 2 заседания ГД».',
 justified:'Авторская формулировка: жеребьёвка проводится «через одно заседание ГД».',
 allowed:'Авторская формулировка: жеребьёвка проводится всегда.'
} as const;

export default function GhostPolicyLab({g,onOpenVotes}:{g:ReturnTypeRepublic;onOpenVotes:()=>void}){
 const {game,me,teacher,parties,members,votes,setError}=g;
 const [rows,setRows]=useState<Policy[]>([]);
 const [mode,setMode]=useState<Policy['policy_mode']>('prohibited');
 const [rationale,setRationale]=useState('');
 const [busy,setBusy]=useState(false);
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const canPropose=teacher||!!ledParty||(me?.role_title||'').toLowerCase().includes('депутат');

 async function load(){
  if(!game)return;
  const r=await supabase.from('ghost_voting_policies').select('*').eq('game_id',game.id).order('created_at',{ascending:false});
  if(!r.error)setRows((r.data||[]) as Policy[]);
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('ghost-policy:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'ghost_voting_policies',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const activeGame=game;
 const adopted=rows.find(x=>x.status==='adopted');
 const visible=rows.filter(x=>x.status!=='superseded');
 const proposer=(id:string)=>members.find(m=>m.user_id===id)?.full_name||'Участник';
 const vote=(id:string|null)=>id?votes.find(v=>v.id===id):undefined;

 async function propose(){
  setBusy(true);const r=await supabase.rpc('propose_ghost_voting_policy',{p_game_id:activeGame.id,p_policy_mode:mode,p_rationale:rationale.trim()||null});
  if(r.error)setError(r.error.message);else{setRationale('');await load()}setBusy(false);
 }
 async function openVote(id:string){
  setBusy(true);const r=await supabase.rpc('open_ghost_voting_policy_vote',{p_policy_id:id});
  if(r.error)setError(r.error.message);else{await load();onOpenVotes()}setBusy(false);
 }

 return <section className="ghostPolicyLab">
  <header className="ghostPolicyHead"><div><small>ПОСТАНОВЛЕНИЕ ГД · ЭТАП 5</small><h2>Режим Ghost voting</h2><p>Жеребьёвка 25–50 отсутствующих депутатов уже работает отдельно. Здесь Государственная Дума определяет политико-процедурный режим, в котором она применяется.</p></div><div className="ghostPolicyCurrent"><small>ДЕЙСТВУЮЩИЙ РЕЖИМ</small><strong>{adopted?labels[adopted.policy_mode]:'Не принят'}</strong><span>{adopted?cadence[adopted.policy_mode]:'Требуется постановление ГД'}</span></div></header>

  <div className="ghostCadenceNote"><b>Почему частота не автоматизирована жёстко</b><p>Фразы «через каждые 2 заседания» и «через одно заседание» допускают разные трактовки точки отсчёта. Поэтому система фиксирует выбранный режим и показывает авторскую формулировку дословно, а сам запуск конкретной жеребьёвки остаётся у преподавателя.</p></div>

  {canPropose&&<section className="ghostPolicyProposal">
   <div className="ghostPolicyProposalHead">
    <div><small>ПРОЕКТ ПОСТАНОВЛЕНИЯ</small><h3>Выберите режим Ghost voting</h3><p>Один вариант станет предметом рассмотрения Государственной Думы.</p></div>
   </div>
   <div className="ghostPolicyModes" role="radiogroup" aria-label="Предлагаемый режим">
    {([
     ['prohibited','Запрещено','Ghost voting не применяется'],
     ['justified','По уважительной причине','Допускается только при обоснованном отсутствии'],
     ['allowed','Разрешено','Ghost voting применяется без дополнительного ограничения']
    ] as const).map(([value,title,desc])=><button key={value} type="button" role="radio" aria-checked={mode===value} className={mode===value?'active':''} onClick={()=>setMode(value)}><span>{title}</span><small>{desc}</small></button>)}
   </div>
   <label className="ghostPolicyRationale"><span>Обоснование</span><textarea rows={4} value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="Почему этот режим выгоден вашей фракции и как он влияет на устойчивость большинства?"/></label>
   <footer className="ghostPolicyProposalFooter"><span>После внесения проект появится в списке ниже и сможет быть вынесен на голосование.</span><button className="primary" disabled={busy} onClick={()=>void propose()}>Внести проект постановления</button></footer>
  </section>}

  <div className="ghostPolicyList">{visible.length===0?<div className="emptyState">Проектов постановления ещё нет.</div>:visible.map(p=>{const v=vote(p.vote_id);return <article key={p.id} className={p.status}><header><div><small>РЕЖИМ</small><b>{labels[p.policy_mode]}</b></div><em>{p.status==='adopted'?'Принят':p.status==='vote_open'?'Голосование':p.status==='rejected'?'Отклонён':'Проект'}</em></header><p>{cadence[p.policy_mode]}</p>{p.rationale&&<blockquote>{p.rationale}</blockquote>}<footer><span>{proposer(p.proposed_by)}</span>{v&&<span>{v.status==='open'?'голосование открыто':v.result_label||'закрыто'}</span>}{(teacher||ledParty)&&p.status==='draft'&&<button disabled={busy} onClick={()=>void openVote(p.id)}>Вынести в зал ГД →</button>}</footer></article>})}</div>
 </section>;
}
