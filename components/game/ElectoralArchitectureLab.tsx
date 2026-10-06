'use client';
import {useEffect,useState} from 'react';
import {MessageCircle} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type PRule={id:string;system_type:'proportional'|'majoritarian'|'mixed';allocation_method:'hare'|'droop'|'dhondt'|'sainte_lague'|'imperiali'|null;majoritarian_method:'plurality'|'absolute_two_round'|null;proportional_share:number|null;rationale:string|null;status:'draft'|'vote_open'|'adopted'|'rejected'|'superseded';vote_id:string|null;proposed_by:string;created_at:string};
type RRule={id:string;method:'random'|'proportional'|'agreement';rationale:string|null;status:'draft'|'vote_open'|'adopted'|'rejected'|'allocated'|'superseded';vote_id:string|null;proposed_by:string;created_at:string};
type RegionAllocation={id:string;rule_id:string;party_id:string;regions:number;source:'random'|'proportional'|'agreement'};

const sysLabel={proportional:'Пропорциональная',majoritarian:'Мажоритарная',mixed:'Смешанная'} as const;
const allocationLabel={hare:'Квота Хэйра + наибольшие остатки',droop:'Квота Друпа + наибольшие остатки',dhondt:'Д’Ондт',sainte_lague:'Сент-Лагю',imperiali:'Империали'} as const;
const majLabel={plurality:'Относительное большинство',absolute_two_round:'Абсолютное большинство + 2-й тур'} as const;
const regionalLabel={random:'Демократический / случайный',proportional:'Пропорционально мандатам ГД',agreement:'Договорной'} as const;

function divisorAllocate(values:number[],seats:number,method:'dhondt'|'sainte_lague'|'imperiali'){
 const out=values.map(()=>0);
 for(let s=0;s<seats;s++){
  let best=-1,bestQ=-1;
  for(let i=0;i<values.length;i++){
   const d=method==='dhondt'?out[i]+1:method==='sainte_lague'?out[i]*2+1:out[i]+2;
   const q=values[i]/d;
   if(q>bestQ){bestQ=q;best=i}
  }
  if(best>=0)out[best]++;
 }
 return out;
}
function quotaAllocate(values:number[],seats:number,method:'hare'|'droop'){
 const total=values.reduce((a,b)=>a+b,0);if(total<=0)return values.map(()=>0);
 const quota=method==='hare'?total/seats:Math.floor(total/(seats+1))+1;
 const raw=values.map(v=>v/quota);
 const out=raw.map(x=>Math.floor(x));
 let remain=Math.max(0,seats-out.reduce((a,b)=>a+b,0));
 const order=raw.map((x,i)=>({i,r:x-Math.floor(x)})).sort((a,b)=>b.r-a.r);
 for(let k=0;k<remain;k++)out[order[k%order.length].i]++;
 while(out.reduce((a,b)=>a+b,0)>seats){const i=out.indexOf(Math.max(...out));out[i]--}
 return out;
}
function allocate(values:number[],seats:number,method:PRule['allocation_method']){
 if(!method||seats<=0||values.reduce((n,v)=>n+v,0)<=0)return values.map(()=>0);
 if(method==='hare'||method==='droop')return quotaAllocate(values,seats,method);
 return divisorAllocate(values,seats,method);
}

export default function ElectoralArchitectureLab({g,stageNo,onOpenVotes}:{g:ReturnTypeRepublic;stageNo:2|3;onOpenVotes:()=>void}){
 const {game,me,teacher,parties,members,votes,setError}=g;
 const [pRules,setPRules]=useState<PRule[]>([]);
 const [rRules,setRRules]=useState<RRule[]>([]);
 const [allocations,setAllocations]=useState<RegionAllocation[]>([]);
 const [system,setSystem]=useState<PRule['system_type']>('proportional');
 const [method,setMethod]=useState<NonNullable<PRule['allocation_method']>>('dhondt');
 const [majority,setMajority]=useState<NonNullable<PRule['majoritarian_method']>>('plurality');
 const [propShare,setPropShare]=useState(50);
 const [rationale,setRationale]=useState('');
 const [regionalMethod,setRegionalMethod]=useState<RRule['method']>('random');
 const [regionalRationale,setRegionalRationale]=useState('');
 const [regionDraft,setRegionDraft]=useState<Record<string,string>>({});
 const [support,setSupport]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const canPropose=teacher||!!ledParty;

 async function load(){
  if(!game)return;
  const [p,r,a]=await Promise.all([
   supabase.from('parliamentary_election_rules').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('regional_election_rules').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('regional_allocations').select('*').eq('game_id',game.id)
  ]);
  if(!p.error)setPRules((p.data||[]) as PRule[]);
  if(!r.error)setRRules((r.data||[]) as RRule[]);
  if(!a.error)setAllocations((a.data||[]) as RegionAllocation[]);
  setSupport(v=>{const n={...v};for(const x of parties)if(n[x.id]===undefined)n[x.id]=String(Number(x.support||0));return n});
 }
 useEffect(()=>{void load()},[game?.id,parties.length]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('electoral-architecture:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'parliamentary_election_rules',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'regional_election_rules',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'regional_allocations',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const activeGame=game;
 const adoptedP=pRules.find(x=>x.status==='adopted');
 const adoptedR=rRules.find(x=>x.status==='adopted'||x.status==='allocated');
 const activeP=pRules.filter(x=>!['superseded'].includes(x.status));
 const activeR=rRules.filter(x=>!['superseded'].includes(x.status));
 const voteStatus=(id:string|null)=>id?votes.find(v=>v.id===id):undefined;
 const proposer=(id:string)=>members.find(m=>m.user_id===id)?.full_name||'Фракция';
 const regionRows=adoptedR?allocations.filter(x=>x.rule_id===adoptedR.id):[];
 const totalAgreement=regionRows.reduce((a,x)=>a+Number(x.regions||0),0);
 const publicPolicyChannel=g.channels.find(c=>c.kind==='public'&&c.name.toLocaleLowerCase('ru-RU').includes('публич'))
  ||g.channels.find(c=>c.kind==='public'&&c.name!=='Вне игры')
  ||g.channels.find(c=>c.kind==='public');
 function openPublicPolicyChat(){
  if(publicPolicyChannel)g.setChannelId(publicPolicyChannel.id);
  g.setChatOpen(true);
 }

 const preview=(()=>{
  const values=parties.map(p=>Math.max(0,Number(support[p.id])||0));
  const seats=system==='mixed'?Math.round(450*propShare/100):system==='proportional'?450:0;
  const result=seats>0?allocate(values,seats,method):values.map(()=>0);
  return parties.map((p,i)=>({party:p,seats:result[i]}));
 })();

 async function proposeP(){
  setBusy(true);const r=await supabase.rpc('propose_parliamentary_election_rule',{p_game_id:activeGame.id,p_system_type:system,p_allocation_method:system==='majoritarian'?null:method,p_majoritarian_method:system==='proportional'?null:majority,p_proportional_share:system==='mixed'?propShare:null,p_rationale:rationale.trim()||null});
  if(r.error)setError(r.error.message);else{setRationale('');await load()}setBusy(false);
 }
 async function voteP(id:string){setBusy(true);const r=await supabase.rpc('open_parliamentary_rule_vote',{p_rule_id:id});if(r.error)setError(r.error.message);else{await load();onOpenVotes()}setBusy(false)}
 async function proposeR(){
  setBusy(true);const r=await supabase.rpc('propose_regional_election_rule',{p_game_id:activeGame.id,p_method:regionalMethod,p_rationale:regionalRationale.trim()||null});
  if(r.error)setError(r.error.message);else{setRegionalRationale('');await load()}setBusy(false);
 }
 async function voteR(id:string){setBusy(true);const r=await supabase.rpc('open_regional_rule_vote',{p_rule_id:id});if(r.error)setError(r.error.message);else{await load();onOpenVotes()}setBusy(false)}
 async function setRegion(partyId:string){
  if(!adoptedR)return;setBusy(true);const r=await supabase.rpc('set_regional_agreement_allocation',{p_rule_id:adoptedR.id,p_party_id:partyId,p_regions:Math.max(0,Number(regionDraft[partyId])||0)});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function executeR(){if(!adoptedR)return;setBusy(true);const r=await supabase.rpc('execute_regional_allocation',{p_rule_id:adoptedR.id});if(r.error)setError(r.error.message);else await load();setBusy(false)}

 if(stageNo===2)return <section className="electoralLab">
  <header className="electoralLabHead"><div className="electoralLabIntro"><small>КСРФ · ЭТАП 2</small><h2>Архитектура парламентских выборов</h2><p>Фракции выбирают тип избирательной системы и формулу распределения. Решение принимается отдельным фракционным голосованием простым большинством.</p><div className="electoralLabActions"><button type="button" className="electoralDiscuss" onClick={openPublicPolicyChat}><MessageCircle size={17} aria-hidden="true"/><span><b>Обсудить решение</b><small>{publicPolicyChannel?.name||'Публичная политика'}</small></span></button></div></div><div className="electoralAdopted"><small>ПРИНЯТОЕ ПРАВИЛО</small><strong>{adoptedP?sysLabel[adoptedP.system_type]:'Не принято'}</strong><span>{adoptedP?.allocation_method?allocationLabel[adoptedP.allocation_method]:adoptedP?.majoritarian_method?majLabel[adoptedP.majoritarian_method]:''}</span></div></header>

  {canPropose&&<div className="electoralProposal"><label>Система<select value={system} onChange={e=>setSystem(e.target.value as PRule['system_type'])}><option value="proportional">Пропорциональная</option><option value="majoritarian">Мажоритарная</option><option value="mixed">Смешанная</option></select></label>{system!=='majoritarian'&&<label>Квота / делители<select value={method} onChange={e=>setMethod(e.target.value as NonNullable<PRule['allocation_method']>)}><option value="hare">Квота Хэйра</option><option value="droop">Квота Друпа</option><option value="dhondt">Д’Ондт</option><option value="sainte_lague">Сент-Лагю</option><option value="imperiali">Империали</option></select></label>}{system!=='proportional'&&<label>Мажоритарное правило<select value={majority} onChange={e=>setMajority(e.target.value as NonNullable<PRule['majoritarian_method']>)}><option value="plurality">Относительное большинство</option><option value="absolute_two_round">Абсолютное + 2-й тур</option></select></label>}{system==='mixed'&&<label>Пропорциональная часть, %<input type="number" min="1" max="99" value={propShare} onChange={e=>setPropShare(Math.max(1,Math.min(99,Number(e.target.value)||50)))}/></label>}<label className="wide">Аргументация фракции<textarea rows={3} value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="Почему эта система выгодна и институционально оправдана?"/></label><button className="primary" disabled={busy} onClick={()=>void proposeP()}>Внести предложение в КСРФ</button></div>}

  <div className="electoralRuleList">{activeP.length===0?<div className="emptyState">Предложений ещё нет.</div>:activeP.map(r=>{const v=voteStatus(r.vote_id);return <article key={r.id} className={r.status}><header><span>{sysLabel[r.system_type]}</span><b>{r.allocation_method?allocationLabel[r.allocation_method]:r.majoritarian_method?majLabel[r.majoritarian_method]:'Правило'}</b><em>{r.status==='adopted'?'Принято':r.status==='vote_open'?'На голосовании':r.status==='rejected'?'Отклонено':'Проект'}</em></header>{r.rationale&&<p>{r.rationale}</p>}<footer><span>{proposer(r.proposed_by)}</span>{r.system_type==='mixed'&&<span>{r.proportional_share}% пропорционально</span>}{v&&<span>{v.status==='open'?'голосование открыто':v.result_label||'закрыто'}</span>}{canPropose&&r.status==='draft'&&<button disabled={busy} onClick={()=>void voteP(r.id)}>Вынести на голосование →</button>}</footer></article>})}</div>

  <section className="electoralSandbox"><div className="electoralSandboxHead"><div><small>КОНТРФАКТИЧЕСКИЙ КАЛЬКУЛЯТОР</small><h3>Как формула меняет распределение мандатов</h3><p>Это учебная модель, а не официальный результат этапа 4. Введите одинаковые исходные доли поддержки и сравнивайте формулы.</p></div><span>{system==='majoritarian'?'Нужны данные по округам':(system==='mixed'?Math.round(450*propShare/100):450)+' пропорциональных мест'}</span></div><div className="electoralSandboxRows">{parties.map((p,i)=><div key={p.id}><i style={{background:p.color}}/><b>{p.name}</b><input type="number" min="0" step="0.1" value={support[p.id]??''} onChange={e=>setSupport(v=>({...v,[p.id]:e.target.value}))}/><span>%</span><strong>{system==='majoritarian'?'—':preview[i]?.seats||0}</strong><small>мандатов</small></div>)}</div>{system==='majoritarian'&&<p className="electoralCaveat">Национальная доля голосов сама по себе не позволяет корректно вывести число мандатов при мажоритарной системе: нужны результаты по отдельным округам. Система намеренно не «угадывает» их.</p>}</section>
 </section>;

 return <section className="electoralLab regionalLab">
  <header className="electoralLabHead"><div><small>КСРФ · ЭТАП 3</small><h2>89 субъектов Российской Федерации</h2><p>После выбора метода система либо проводит случайную жеребьёвку, либо распределяет регионы пропорционально действующим мандатам ГД, либо проверяет договор фракций на сумму ровно 89.</p></div><div className="electoralAdopted"><small>ПРИНЯТЫЙ МЕТОД</small><strong>{adoptedR?regionalLabel[adoptedR.method]:'Не принят'}</strong><span>{adoptedR?.status==='allocated'?'Результат зафиксирован':''}</span></div></header>

  {canPropose&&<div className="electoralProposal regionalProposal"><label>Метод<select value={regionalMethod} onChange={e=>setRegionalMethod(e.target.value as RRule['method'])}><option value="random">Демократический / случайный</option><option value="proportional">Пропорциональный</option><option value="agreement">Договорной</option></select></label><label className="wide">Аргументация<textarea rows={3} value={regionalRationale} onChange={e=>setRegionalRationale(e.target.value)}/></label><button className="primary" disabled={busy} onClick={()=>void proposeR()}>Внести предложение</button></div>}

  <div className="electoralRuleList">{activeR.length===0?<div className="emptyState">Предложений ещё нет.</div>:activeR.map(r=>{const v=voteStatus(r.vote_id);return <article key={r.id} className={r.status}><header><span>МЕТОД</span><b>{regionalLabel[r.method]}</b><em>{r.status==='allocated'?'Распределено':r.status==='adopted'?'Принято':r.status==='vote_open'?'На голосовании':r.status==='rejected'?'Отклонено':'Проект'}</em></header>{r.rationale&&<p>{r.rationale}</p>}<footer><span>{proposer(r.proposed_by)}</span>{v&&<span>{v.status==='open'?'голосование открыто':v.result_label||'закрыто'}</span>}{canPropose&&r.status==='draft'&&<button disabled={busy} onClick={()=>void voteR(r.id)}>Вынести на голосование →</button>}</footer></article>})}</div>

  {adoptedR&&<section className="regionalAllocation"><div className="regionalAllocationHead"><div><small>РАСПРЕДЕЛЕНИЕ КОНТРОЛЯ</small><h3>{regionalLabel[adoptedR.method]}</h3></div><strong>{regionRows.reduce((a,x)=>a+Number(x.regions||0),0)} / 89</strong></div>
   {adoptedR.method==='proportional'&&<div className="regionalAmbiguity"><b>Неоднозначность авторских правил</b><p>В общем описании упомянут и бюджет партии, однако математический вес бюджета не задан; детальное описание определяет пропорцию по мандатам ГД. Поэтому автоматический расчёт использует только мандаты и не выдумывает коэффициент бюджета.</p></div>}
   <div className="regionalPartyRows">{parties.map(p=>{const row=regionRows.find(x=>x.party_id===p.id);return <div key={p.id}><i style={{background:p.color}}/><b>{p.name}</b><span>{p.mandates} мандатов ГД · бюджет {Number(p.budget||0).toLocaleString('ru-RU')}</span>{adoptedR.method==='agreement'&&adoptedR.status==='adopted'?(teacher||ledParty?.id===p.id?<input type="number" min="0" max="89" value={regionDraft[p.id]??String(row?.regions||0)} onChange={e=>setRegionDraft(v=>({...v,[p.id]:e.target.value}))}/>:<strong>{row?.regions||0}</strong>):<strong>{row?.regions??p.regions??0}</strong>}{adoptedR.method==='agreement'&&adoptedR.status==='adopted'&&(teacher||ledParty?.id===p.id)&&<button disabled={busy} onClick={()=>void setRegion(p.id)}>Записать</button>}</div>})}</div>
   {adoptedR.method==='agreement'&&adoptedR.status==='adopted'&&<div className={totalAgreement===89?'regionalTotal ok':'regionalTotal'}><span>Сумма договорённостей</span><b>{totalAgreement} / 89</b></div>}
   {teacher&&adoptedR.status==='adopted'&&<button className="primary regionalExecute" disabled={busy||(adoptedR.method==='agreement'&&totalAgreement!==89)} onClick={()=>void executeR()}>{adoptedR.method==='random'?'Провести жеребьёвку 89 субъектов':adoptedR.method==='proportional'?'Рассчитать 89 субъектов':'Зафиксировать договор'}</button>}
  </section>}
 </section>;
}
