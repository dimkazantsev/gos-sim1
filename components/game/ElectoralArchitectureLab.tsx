'use client';
import {useEffect,useState} from 'react';
import {MessageCircle,Save} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {allocateElectoralSeats as allocate,allocateRegionalSeats} from './electoralMath';

type PRule={id:string;system_type:'proportional'|'majoritarian'|'mixed';allocation_method:'hare'|'droop'|'dhondt'|'sainte_lague'|'imperiali'|null;majoritarian_method:'plurality'|'absolute_two_round'|null;proportional_share:number|null;rationale:string|null;status:'draft'|'vote_open'|'adopted'|'rejected'|'superseded';vote_id:string|null;proposed_by:string;created_at:string};
type RRule={id:string;method:'random'|'proportional'|'agreement';rationale:string|null;status:'draft'|'vote_open'|'adopted'|'rejected'|'allocated'|'superseded';vote_id:string|null;proposed_by:string;created_at:string};
type RegionAllocation={id:string;rule_id:string;party_id:string;regions:number;source:'random'|'proportional'|'agreement'};
type ElectoralCalcResult={id:string;system_type:PRule['system_type'];allocation_method:PRule['allocation_method'];proportional_share:number|null;support:Record<string,number>;district_seats:Record<string,number>;result:Record<string,number>;created_at:string};
type RegionalCalcResult={id:string;method:RRule['method'];inputs:Record<string,unknown>;result:Record<string,number>;created_at:string};

const sysLabel={proportional:'Пропорциональная',majoritarian:'Мажоритарная',mixed:'Смешанная'} as const;
const allocationLabel={hare:'Квота Хэйра + наибольшие остатки',droop:'Квота Друпа + наибольшие остатки',dhondt:'Д’Ондт',sainte_lague:'Сент-Лагю',imperiali:'Империали'} as const;
const majLabel={plurality:'Относительное большинство',absolute_two_round:'Абсолютное большинство + 2-й тур'} as const;
const regionalLabel={random:'Демократический / случайный',proportional:'Пропорционально мандатам ГД',agreement:'Договорной'} as const;

export default function ElectoralArchitectureLab({g,stageNo,onOpenVotes}:{g:ReturnTypeRepublic;stageNo:2|3;onOpenVotes:()=>void}){
 const {game,me,teacher,parties,members,votes,setError}=g;
 const [pRules,setPRules]=useState<PRule[]>([]);
 const [rRules,setRRules]=useState<RRule[]>([]);
 const [allocations,setAllocations]=useState<RegionAllocation[]>([]);
 const [savedResults,setSavedResults]=useState<ElectoralCalcResult[]>([]);
 const [regionalSavedResults,setRegionalSavedResults]=useState<RegionalCalcResult[]>([]);
 const [system,setSystem]=useState<PRule['system_type']>('proportional');
 const [method,setMethod]=useState<NonNullable<PRule['allocation_method']>>('dhondt');
 const [calculatorMethod,setCalculatorMethod]=useState<NonNullable<PRule['allocation_method']>>('dhondt');
 const [calculatorSystem,setCalculatorSystem]=useState<PRule['system_type']>('proportional');
 const [calculatorMixedShare,setCalculatorMixedShare]=useState(50);
 const [districtSeats,setDistrictSeats]=useState<Record<string,string>>({});
 const [majority,setMajority]=useState<NonNullable<PRule['majoritarian_method']>>('plurality');
 const [propShare,setPropShare]=useState(50);
 const [rationale,setRationale]=useState('');
 const [regionalMethod,setRegionalMethod]=useState<RRule['method']>('random');
 const [regionalCalculatorMethod,setRegionalCalculatorMethod]=useState<RRule['method']>('proportional');
 const [regionalCalculatorDraft,setRegionalCalculatorDraft]=useState<Record<string,string>>({});
 const [regionalLottery,setRegionalLottery]=useState<Record<string,number>>({});
 const [regionalRationale,setRegionalRationale]=useState('');
 const [regionDraft,setRegionDraft]=useState<Record<string,string>>({});
 const [support,setSupport]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const canPropose=teacher||!!ledParty;

 async function load(){
  if(!game)return;
  const [p,r,a,calc,regionalCalc]=await Promise.all([
   supabase.from('parliamentary_election_rules').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('regional_election_rules').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('regional_allocations').select('*').eq('game_id',game.id),
   supabase.from('electoral_calculator_results').select('*').eq('game_id',game.id).eq('published',true).order('created_at',{ascending:false}).limit(20),
   supabase.from('regional_calculator_results').select('*').eq('game_id',game.id).eq('published',true).order('created_at',{ascending:false}).limit(20)
  ]);
  if(!p.error)setPRules((p.data||[]) as PRule[]);
  if(!r.error)setRRules((r.data||[]) as RRule[]);
  if(!a.error)setAllocations((a.data||[]) as RegionAllocation[]);
  if(!calc.error)setSavedResults((calc.data||[]) as ElectoralCalcResult[]);
  if(!regionalCalc.error)setRegionalSavedResults((regionalCalc.data||[]) as RegionalCalcResult[]);
  setSupport(v=>{const n={...v};for(const x of parties)if(n[x.id]===undefined)n[x.id]=String(Number(x.support||0));return n});
  setDistrictSeats(v=>{const n={...v};for(const x of parties)if(n[x.id]===undefined)n[x.id]='0';return n});
  setRegionalCalculatorDraft(v=>{const n={...v};for(const x of parties)if(n[x.id]===undefined)n[x.id]='0';return n});
 }
 useEffect(()=>{void load()},[game?.id,parties.length]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('electoral-architecture:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'parliamentary_election_rules',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'regional_election_rules',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'regional_allocations',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'electoral_calculator_results',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'regional_calculator_results',filter:'game_id=eq.'+game.id},()=>void load())
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

 const calculatorVotes=parties.map(p=>Math.max(0,Number(support[p.id])||0));
 const calculatorSupportTotal=calculatorVotes.reduce((sum,value)=>sum+value,0);
 const proportionalPool=calculatorSystem==='proportional'?450:calculatorSystem==='mixed'?Math.round(450*calculatorMixedShare/100):0;
 const districtPool=calculatorSystem==='majoritarian'?450:calculatorSystem==='mixed'?450-proportionalPool:0;
 const proportionalSeats=proportionalPool>0&&calculatorSupportTotal>0?allocate(calculatorVotes,proportionalPool,calculatorMethod):calculatorVotes.map(()=>0);
 const districtValues=parties.map(p=>Math.max(0,Math.floor(Number(districtSeats[p.id])||0)));
 const districtTotal=districtValues.reduce((sum,value)=>sum+value,0);
 const calculatorSeats=parties.map((_,i)=>calculatorSystem==='proportional'?proportionalSeats[i]||0:calculatorSystem==='majoritarian'?districtValues[i]||0:(proportionalSeats[i]||0)+(districtValues[i]||0));
 const preview=parties.map((p,i)=>({party:p,seats:calculatorSeats[i]||0,proportional:proportionalSeats[i]||0,district:districtValues[i]||0}));
 const calculatorAllocatedTotal=calculatorSeats.reduce((sum,value)=>sum+value,0);
 const calculatorReady=(proportionalPool===0||calculatorSupportTotal>0)&&(districtPool===0||districtTotal===districtPool)&&calculatorAllocatedTotal===450;
 const latestSavedResult=savedResults[0];
 const regionalMandates=parties.map(p=>Math.max(0,Number(p.mandates)||0));
 const regionalMandateTotal=regionalMandates.reduce((a,b)=>a+b,0);
 const proportionalRegional=allocateRegionalSeats(regionalMandates);
 const agreementRegional=parties.map(p=>Math.max(0,Math.floor(Number(regionalCalculatorDraft[p.id])||0)));
 const agreementRegionalTotal=agreementRegional.reduce((a,b)=>a+b,0);
 const randomRegional=parties.map(p=>Math.max(0,Math.floor(Number(regionalLottery[p.id])||0)));
 const regionalPreview=parties.map((p,i)=>({
  party:p,
  regions:regionalCalculatorMethod==='proportional'?proportionalRegional[i]||0:regionalCalculatorMethod==='agreement'?agreementRegional[i]||0:randomRegional[i]||0
 }));
 const regionalPreviewTotal=regionalPreview.reduce((a,x)=>a+x.regions,0);
 const regionalCalculatorReady=regionalCalculatorMethod==='proportional'?regionalMandateTotal>0:regionalCalculatorMethod==='agreement'?agreementRegionalTotal===89:regionalPreviewTotal===89;
 const latestRegionalSaved=regionalSavedResults[0];

 function drawRegionalLottery(){
  if(!parties.length)return;
  const out:Record<string,number>={};for(const p of parties)out[p.id]=0;
  for(let i=0;i<89;i++){const p=parties[Math.floor(Math.random()*parties.length)];out[p.id]=(out[p.id]||0)+1}
  setRegionalLottery(out);
 }

 async function proposeP(){
  setBusy(true);const r=await supabase.rpc('propose_parliamentary_election_rule',{p_game_id:activeGame.id,p_system_type:system,p_allocation_method:system==='majoritarian'?null:method,p_majoritarian_method:system==='proportional'?null:majority,p_proportional_share:system==='mixed'?propShare:null,p_rationale:rationale.trim()||null});
  if(r.error)setError(r.error.message);else{setRationale('');await load()}setBusy(false);
 }
 async function voteP(id:string){setBusy(true);const r=await supabase.rpc('open_parliamentary_rule_vote',{p_rule_id:id});if(r.error)setError(r.error.message);else{await load();onOpenVotes()}setBusy(false)}
 async function publishCalculatorResult(){
  if(!teacher||!calculatorReady)return;
  setBusy(true);
  const supportPayload=Object.fromEntries(parties.map((p,i)=>[p.id,calculatorVotes[i]||0]));
  const districtPayload=Object.fromEntries(parties.map((p,i)=>[p.id,districtValues[i]||0]));
  const resultPayload=Object.fromEntries(parties.map((p,i)=>[p.id,calculatorSeats[i]||0]));
  const r=await supabase.rpc('publish_electoral_calculator_result',{
   p_game_id:activeGame.id,
   p_system_type:calculatorSystem,
   p_allocation_method:calculatorSystem==='majoritarian'?null:calculatorMethod,
   p_proportional_share:calculatorSystem==='mixed'?calculatorMixedShare:null,
   p_support:supportPayload,
   p_district_seats:districtPayload,
   p_result:resultPayload
  });
  if(r.error)setError(r.error.message);else await load();
  setBusy(false);
 }
 async function publishRegionalCalculatorResult(){
  if(!teacher||!regionalCalculatorReady)return;
  setBusy(true);
  const inputs=regionalCalculatorMethod==='proportional'
   ?{mandates:Object.fromEntries(parties.map((p,i)=>[p.id,regionalMandates[i]||0]))}
   :regionalCalculatorMethod==='agreement'
    ?{agreement:Object.fromEntries(parties.map((p,i)=>[p.id,agreementRegional[i]||0]))}
    :{draw:'random'};
  const result=Object.fromEntries(regionalPreview.map(x=>[x.party.id,x.regions]));
  const r=await supabase.rpc('publish_regional_calculator_result',{p_game_id:activeGame.id,p_method:regionalCalculatorMethod,p_inputs:inputs,p_result:result});
  if(r.error)setError(r.error.message);else await load();
  setBusy(false);
 }
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

  {latestSavedResult&&<section className="electoralPublishedResult">
   <div className="electoralPublishedHead">
    <div><small>ОПУБЛИКОВАННЫЙ РАСЧЁТ</small><h3>{sysLabel[latestSavedResult.system_type]}</h3><p>Сохранён преподавателем · {new Date(latestSavedResult.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</p></div>
    <strong>450 мест</strong>
   </div>
   <div className="electoralPublishedGrid">
    {parties.map(p=><div key={p.id}><span><i style={{background:p.color}}/><b>{p.name}</b></span><strong>{Number(latestSavedResult.result?.[p.id]||0)}</strong><small>мандатов</small></div>)}
   </div>
  </section>}

  {teacher&&<section className="electoralCalculator">
   <div className="electoralCalculatorHead">
    <div><small>КАЛЬКУЛЯТОР ПРЕПОДАВАТЕЛЯ</small><h3>Распределение 450 мест</h3><p>Студенты не видят расчёт до публикации результата.</p></div>
    <div className="electoralCalculatorControls">
     <label><span>Система</span><select value={calculatorSystem} onChange={e=>setCalculatorSystem(e.target.value as PRule['system_type'])}><option value="proportional">Пропорциональная</option><option value="majoritarian">Мажоритарная</option><option value="mixed">Смешанная</option></select></label>
     {calculatorSystem!=='majoritarian'&&<label><span>Формула</span><select value={calculatorMethod} onChange={e=>setCalculatorMethod(e.target.value as NonNullable<PRule['allocation_method']>)}><option value="hare">Квота Хэйра</option><option value="droop">Квота Друпа</option><option value="dhondt">Д’Ондт</option><option value="sainte_lague">Сент-Лагю</option><option value="imperiali">Империали</option></select></label>}
     {calculatorSystem==='mixed'&&<label><span>Пропорциональная часть, %</span><input type="number" min="1" max="99" value={calculatorMixedShare} onChange={e=>setCalculatorMixedShare(Math.max(1,Math.min(99,Number(e.target.value)||50)))}/></label>}
    </div>
   </div>
   <div className="electoralCalculatorList">
    {parties.map((p,i)=><div className="electoralCalculatorRow" key={p.id}>
     <span className="electoralCalculatorParty"><i style={{background:p.color}}/><b>{p.name}</b></span>
     {calculatorSystem!=='majoritarian'&&<label><span>Поддержка</span><span className="electoralCalculatorInput"><input type="number" min="0" max="100" step="0.1" value={support[p.id]??''} onChange={e=>setSupport(v=>({...v,[p.id]:e.target.value}))}/><em>%</em></span></label>}
     {calculatorSystem!=='proportional'&&<label><span>Выиграно округов</span><span className="electoralCalculatorInput"><input type="number" min="0" max={districtPool} step="1" value={districtSeats[p.id]??'0'} onChange={e=>setDistrictSeats(v=>({...v,[p.id]:e.target.value}))}/><em>окр.</em></span></label>}
     <div className="electoralCalculatorResult"><span>Мандаты</span><strong>{preview[i]?.seats||0}</strong>{calculatorSystem==='mixed'&&<small>{preview[i]?.proportional||0} + {preview[i]?.district||0}</small>}</div>
    </div>)}
   </div>
   <div className="electoralCalculatorSummary">
    {calculatorSystem!=='majoritarian'&&<span>Сумма поддержки <b>{calculatorSupportTotal.toLocaleString('ru-RU',{maximumFractionDigits:1})}%</b></span>}
    {calculatorSystem!=='proportional'&&<span>Округа <b>{districtTotal} / {districtPool}</b></span>}
    {calculatorSystem==='mixed'&&<span>Пропорционально <b>{proportionalPool}</b></span>}
    <span>Распределено <b>{calculatorAllocatedTotal} / 450</b></span>
    <button type="button" className="primary electoralPublishCalc" disabled={busy||!calculatorReady} onClick={()=>void publishCalculatorResult()}><Save size={16} aria-hidden="true"/>Сохранить и открыть всем</button>
   </div>
  </section>}
 </section>;

 return <section className="electoralLab regionalLab">
  <header className="electoralLabHead"><div><small>КСРФ · ЭТАП 3</small><h2>89 субъектов в российской правовой системе</h2><p>В игре фракции распределяют условный политический контроль над 89 субъектами одним из трёх методов: жеребьёвкой, пропорционально мандатам Госдумы или договором. Это игровая модель, а не реальный порядок формирования органов власти субъектов РФ.</p></div><div className="electoralAdopted"><small>ПРИНЯТЫЙ МЕТОД</small><strong>{adoptedR?regionalLabel[adoptedR.method]:'Не принят'}</strong><span>{adoptedR?.status==='allocated'?'Результат зафиксирован':''}</span></div></header>

  {canPropose&&<div className="electoralProposal regionalProposal"><label>Метод<select value={regionalMethod} onChange={e=>setRegionalMethod(e.target.value as RRule['method'])}><option value="random">Демократический / случайный</option><option value="proportional">Пропорциональный</option><option value="agreement">Договорной</option></select></label><label className="wide">Аргументация<textarea rows={3} value={regionalRationale} onChange={e=>setRegionalRationale(e.target.value)}/></label><button className="primary" disabled={busy} onClick={()=>void proposeR()}>Внести предложение</button></div>}

  <div className="electoralRuleList">{activeR.length===0?<div className="emptyState">Предложений ещё нет.</div>:activeR.map(r=>{const v=voteStatus(r.vote_id);return <article key={r.id} className={r.status}><header><span>МЕТОД</span><b>{regionalLabel[r.method]}</b><em>{r.status==='allocated'?'Распределено':r.status==='adopted'?'Принято':r.status==='vote_open'?'На голосовании':r.status==='rejected'?'Отклонено':'Проект'}</em></header>{r.rationale&&<p>{r.rationale}</p>}<footer><span>{proposer(r.proposed_by)}</span>{v&&<span>{v.status==='open'?'голосование открыто':v.result_label||'закрыто'}</span>}{canPropose&&r.status==='draft'&&<button disabled={busy} onClick={()=>void voteR(r.id)}>Вынести на голосование →</button>}</footer></article>})}</div>

  {latestRegionalSaved&&<section className="regionalPublishedResult">
   <div className="regionalPublishedHead"><div><small>ОПУБЛИКОВАННЫЙ РАСЧЁТ</small><h3>{regionalLabel[latestRegionalSaved.method]}</h3><p>Сохранён преподавателем · {new Date(latestRegionalSaved.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</p></div><strong>89 субъектов</strong></div>
   <div className="regionalPublishedGrid">{parties.map(p=><div key={p.id}><span><i style={{background:p.color}}/><b>{p.name}</b></span><strong>{Number(latestRegionalSaved.result?.[p.id]||0)}</strong><small>субъектов</small></div>)}</div>
  </section>}

  {teacher&&<section className="regionalCalculator">
   <div className="regionalCalculatorHead">
    <div><small>КАЛЬКУЛЯТОР ПРЕПОДАВАТЕЛЯ</small><h3>Распределение 89 субъектов</h3><p>Расчёт скрыт от студентов до публикации результата.</p></div>
    <label><span>Метод</span><select value={regionalCalculatorMethod} onChange={e=>setRegionalCalculatorMethod(e.target.value as RRule['method'])}><option value="random">Жеребьёвка</option><option value="proportional">Пропорционально мандатам ГД</option><option value="agreement">Договорной</option></select></label>
   </div>
   {regionalCalculatorMethod==='random'&&<div className="regionalCalculatorLottery"><button type="button" className="primary" onClick={drawRegionalLottery}>Провести жеребьёвку</button><span>Каждый из 89 субъектов случайно назначается одной из партий.</span></div>}
   <div className="regionalCalculatorRows">
    {parties.map((p,i)=><div key={p.id}><span className="regionalCalculatorParty"><i style={{background:p.color}}/><b>{p.name}</b></span>
     {regionalCalculatorMethod==='proportional'&&<span className="regionalCalculatorSource"><small>Мандаты ГД</small><b>{regionalMandates[i]||0}</b></span>}
     {regionalCalculatorMethod==='agreement'&&<label><span>По договору</span><input type="number" min="0" max="89" value={regionalCalculatorDraft[p.id]??'0'} onChange={e=>setRegionalCalculatorDraft(v=>({...v,[p.id]:e.target.value}))}/></label>}
     <span className="regionalCalculatorResult"><small>Субъекты</small><strong>{regionalPreview[i]?.regions||0}</strong></span>
    </div>)}
   </div>
   <div className="regionalCalculatorSummary">
    {regionalCalculatorMethod==='proportional'&&<span>Мандаты ГД <b>{regionalMandateTotal}</b></span>}
    {regionalCalculatorMethod==='agreement'&&<span>По договору <b>{agreementRegionalTotal} / 89</b></span>}
    {regionalCalculatorMethod==='random'&&<span>Распределено <b>{regionalPreviewTotal} / 89</b></span>}
    <button type="button" className="primary" disabled={busy||!regionalCalculatorReady} onClick={()=>void publishRegionalCalculatorResult()}><Save size={16} aria-hidden="true"/>Сохранить и открыть всем</button>
   </div>
  </section>}

  {adoptedR&&<section className="regionalAllocation"><div className="regionalAllocationHead"><div><small>РАСПРЕДЕЛЕНИЕ КОНТРОЛЯ</small><h3>{regionalLabel[adoptedR.method]}</h3></div><strong>{regionRows.reduce((a,x)=>a+Number(x.regions||0),0)} / 89</strong></div>
   {adoptedR.method==='proportional'&&<div className="regionalAmbiguity"><b>Неоднозначность авторских правил</b><p>В общем описании упомянут и бюджет партии, однако математический вес бюджета не задан; детальное описание определяет пропорцию по мандатам ГД. Поэтому автоматический расчёт использует только мандаты и не выдумывает коэффициент бюджета.</p></div>}
   <div className="regionalPartyRows">{parties.map(p=>{const row=regionRows.find(x=>x.party_id===p.id);return <div key={p.id}><i style={{background:p.color}}/><b>{p.name}</b><span>{p.mandates} мандатов ГД · бюджет {Number(p.budget||0).toLocaleString('ru-RU')}</span>{adoptedR.method==='agreement'&&adoptedR.status==='adopted'?(teacher||ledParty?.id===p.id?<input type="number" min="0" max="89" value={regionDraft[p.id]??String(row?.regions||0)} onChange={e=>setRegionDraft(v=>({...v,[p.id]:e.target.value}))}/>:<strong>{row?.regions||0}</strong>):<strong>{row?.regions??p.regions??0}</strong>}{adoptedR.method==='agreement'&&adoptedR.status==='adopted'&&(teacher||ledParty?.id===p.id)&&<button disabled={busy} onClick={()=>void setRegion(p.id)}>Записать</button>}</div>})}</div>
   {adoptedR.method==='agreement'&&adoptedR.status==='adopted'&&<div className={totalAgreement===89?'regionalTotal ok':'regionalTotal'}><span>Сумма договорённостей</span><b>{totalAgreement} / 89</b></div>}
   {teacher&&adoptedR.status==='adopted'&&<button className="primary regionalExecute" disabled={busy||(adoptedR.method==='agreement'&&totalAgreement!==89)} onClick={()=>void executeR()}>{adoptedR.method==='random'?'Провести жеребьёвку 89 субъектов':adoptedR.method==='proportional'?'Рассчитать 89 субъектов':'Зафиксировать договор'}</button>}
  </section>}
 </section>;
}
