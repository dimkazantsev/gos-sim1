'use client';
import {userError} from '@/lib/userError';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {notifyGameDataRefresh,useGameTableSync} from './useGameTableSync';

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
 const canPropose=teacher||me?.kind==='student'&&(!!ledParty||(me.role_title||'').toLowerCase().includes('депутат'));
 const scope=JSON.stringify([game?.id,me?.user_id,me?.kind,me?.role_title,me?.team,teacher,ledParty?.id]);
 const activeScope=useRef(scope),alive=useRef(true),mutationScope=useRef<string|null>(null);activeScope.current=scope;
 const [dataScope,setDataScope]=useState(scope);
 const reads=useRef({scope,promise:null as Promise<void>|null,queued:false,explicit:false,cancel:null as (()=>void)|null});
 if(reads.current.scope!==scope)reads.current={scope,promise:null,queued:false,explicit:false,cancel:null};
 const readState=reads.current,scopeCurrent=()=>alive.current&&activeScope.current===scope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>{
  setRows([]);setMode('prohibited');setRationale('');setBusy(false);setDataScope(scope);
  return()=>{readState.cancel?.()};
 },[scope]);
 async function load(background=false){
  if(!game||!me||!scopeCurrent()||background&&document.visibilityState!=='visible')return;
  const state=reads.current;state.explicit=state.explicit||!background;
  if(state.promise){state.queued=true;return state.promise}
  state.promise=(async()=>{
   do{
    state.queued=false;const passive=!state.explicit;state.explicit=false;
    const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>|undefined;
    try{
     const r=await Promise.race([
      supabase.from('ghost_voting_policies').select('*').eq('game_id',game.id).order('created_at',{ascending:false}).abortSignal(controller.signal),
      new Promise<never>((_,reject)=>{
       state.cancel=()=>{clearTimeout(timeout);controller.abort();reject(new Error('Обновление постановлений отменено.'))};
       timeout=setTimeout(()=>{controller.abort();reject(new Error('Не удалось обновить постановления: сервер не ответил вовремя.'))},12000);
      })
     ]);
     if(scopeCurrent()&&!controller.signal.aborted&&(!passive||document.visibilityState==='visible')){
      if(!r.error)setRows((r.data||[]) as Policy[]);else setError(userError(r.error));
     }
    }catch(error){if(scopeCurrent()&&(!passive||document.visibilityState==='visible'))setError(userError(error))}
    finally{clearTimeout(timeout);state.cancel=null}
   }while(state.queued&&scopeCurrent());
  })().finally(()=>{state.promise=null});
  return state.promise;
 }
 useGameTableSync(me?.user_id?game?.id:undefined,['ghost_voting_policies','game_votes'],()=>load(true),scope,undefined,3000,180000);

 if(!game||!me||dataScope!==scope)return null;
 const activeGame=game;
 const adopted=rows.find(x=>x.status==='adopted');
 const visible=rows.filter(x=>x.status!=='superseded');
 const proposer=(id:string)=>members.find(m=>m.user_id===id)?.full_name||'Участник';
 const vote=(id:string|null)=>id?votes.find(v=>v.id===id):undefined;

 async function change(request:()=>PromiseLike<{error:unknown}>,after?:()=>void){
  if(!scopeCurrent()||!canPropose||busy||adopted||mutationScope.current===scope)return;
  mutationScope.current=scope;setBusy(true);
  try{
   const r=await request();if(!scopeCurrent())return;
   if(r.error)setError(userError(r.error));else{notifyGameDataRefresh(activeGame.id,'ghost_voting_policies');await load();if(scopeCurrent())after?.()}
  }catch(error){if(scopeCurrent())setError(userError(error))}
  finally{if(mutationScope.current===scope)mutationScope.current=null;if(scopeCurrent())setBusy(false)}
 }
 async function propose(){
  const submittedRationale=rationale;
  await change(()=>supabase.rpc('propose_ghost_voting_policy',{p_game_id:activeGame.id,p_policy_mode:mode,p_rationale:rationale.trim()||null}),()=>setRationale(value=>value===submittedRationale?'':value));
 }
 async function openVote(id:string){
  if(!teacher&&!ledParty)return;
  await change(()=>supabase.rpc('open_ghost_voting_policy_vote',{p_policy_id:id}),()=>{notifyGameDataRefresh(activeGame.id,'game_votes');onOpenVotes()});
 }

 return <section className="ghostPolicyLab">
  <header className="ghostPolicyHead"><div><small>ПОСТАНОВЛЕНИЕ ГД · ЭТАП 5</small><h2>Режим Goust Voting</h2><p>Жеребьёвка 25–50 отсутствующих депутатов уже работает отдельно. Здесь Государственная Дума определяет политико-процедурный режим, в котором она применяется.</p></div><div className="ghostPolicyCurrent"><small>ДЕЙСТВУЮЩИЙ РЕЖИМ</small><strong>{adopted?labels[adopted.policy_mode]:'Не принят'}</strong><span>{adopted?cadence[adopted.policy_mode]:'Требуется постановление ГД'}</span></div></header>

  <div className="ghostCadenceNote"><b>Почему частота не автоматизирована жёстко</b><p>Фразы «через каждые 2 заседания» и «через одно заседание» допускают разные трактовки точки отсчёта. Поэтому система фиксирует выбранный режим и показывает авторскую формулировку дословно, а сам запуск конкретной жеребьёвки остаётся у преподавателя.</p></div>

  {canPropose&&!adopted&&<section className="ghostPolicyProposal">
   <div className="ghostPolicyProposalHead">
    <div><small>ПРОЕКТ ПОСТАНОВЛЕНИЯ</small><h3>Выберите режим Goust Voting</h3><p>Один вариант станет предметом рассмотрения Государственной Думы.</p></div>
   </div>
   <div className="ghostPolicyModes" role="radiogroup" aria-label="Предлагаемый режим">
    {([
     ['prohibited','Запрещено','Goust Voting не применяется'],
     ['justified','По уважительной причине','Допускается только при обоснованном отсутствии'],
     ['allowed','Разрешено','Goust Voting применяется без дополнительного ограничения']
    ] as const).map(([value,title,desc],index)=><button key={value} type="button" role="radio" aria-checked={mode===value} tabIndex={mode===value?0:-1} className={mode===value?'active':''} onClick={()=>setMode(value)} onKeyDown={e=>{
     const choices=['prohibited','justified','allowed'] as const;
     const next=e.key==='ArrowRight'||e.key==='ArrowDown'?(index+1)%3:e.key==='ArrowLeft'||e.key==='ArrowUp'?(index+2)%3:e.key==='Home'?0:e.key==='End'?2:null;
     if(next===null)return;e.preventDefault();setMode(choices[next]);e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
    }}><span>{title}</span><small>{desc}</small></button>)}
   </div>
   <label className="ghostPolicyRationale"><span>Обоснование</span><textarea rows={4} value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="Почему этот режим выгоден вашей фракции и как он влияет на устойчивость большинства?"/></label>
   <footer className="ghostPolicyProposalFooter"><span>После внесения проект появится в списке ниже и сможет быть вынесен на голосование.</span><button className="primary" disabled={busy} onClick={()=>void propose()}>Внести проект постановления</button></footer>
  </section>}

  <div className="ghostPolicyList">{visible.length===0?<div className="emptyState">Проектов постановления ещё нет.</div>:visible.map(p=>{const v=vote(p.vote_id);return <article key={p.id} className={p.status}><header><div><small>РЕЖИМ</small><b>{labels[p.policy_mode]}</b></div><em>{p.status==='adopted'?'Принят':p.status==='vote_open'?'Голосование':p.status==='rejected'?'Отклонён':'Проект'}</em></header><p>{cadence[p.policy_mode]}</p>{p.status==='rejected'&&adopted&&!p.vote_id&&<p className="ghostPolicyRejectedNote">Отклонено: по этому вопросу принято другое решение.</p>}{p.rationale&&<blockquote>{p.rationale}</blockquote>}<footer><span>{proposer(p.proposed_by)}</span>{v&&<span>{v.status==='open'?'голосование открыто':v.result_label||'закрыто'}</span>}{(teacher||ledParty)&&!adopted&&p.status==='draft'&&<button disabled={busy} onClick={()=>void openVote(p.id)}>Вынести в зал ГД →</button>}</footer></article>})}</div>
 </section>;
}
