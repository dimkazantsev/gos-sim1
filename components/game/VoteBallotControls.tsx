'use client';
import {useEffect,useState} from 'react';
import type {Vote,Ballot} from './types';
export default function VoteBallotControls({vote,maxWeight,canCast,ballot,onSubmit}:{vote:Vote;maxWeight:number;canCast:boolean;ballot?:Ballot;onSubmit:(yes:number,no:number,abstain:number)=>Promise<boolean>}){
 const [partial,setPartial]=useState(false),[split,setSplit]=useState(false),[quantity,setQuantity]=useState(maxWeight),[yes,setYes]=useState(0),[no,setNo]=useState(0),[abstain,setAbstain]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>setQuantity(maxWeight),[maxWeight]);
 const integer=(v:number)=>Number.isInteger(v)&&v>=0,amount=partial?quantity:maxWeight,total=yes+no+abstain,valid=split?[yes,no,abstain].every(integer)&&total>0&&total<=maxWeight&&(!abstain||vote.allow_abstain):integer(amount)&&amount>0&&amount<=maxWeight;
 async function send(y:number,n:number,a:number){if(!valid||!canCast||busy)return;setBusy(true);try{await onSubmit(y,n,a)}finally{setBusy(false)}}
 const submitted=ballot?{yes:ballot.yes_weight??(ballot.choice==='yes'?ballot.weight:0),no:ballot.no_weight??(ballot.choice==='no'?ballot.weight:0),abstain:ballot.abstain_weight??(ballot.choice==='abstain'?ballot.weight:0)}:null;
 return <section className="civicBallot civicBallotModern" aria-label="Подать голоса">
  <div className="civicBallotTop">
   <div className="civicBallotTopCopy">
    <span className="civicBallotEyebrow">ПОДАЧА ГОЛОСОВ</span>
    <strong>{vote.voting_mode==='mandate'?'Доступные депутатские голоса':'Доступные голоса'}</strong>
   </div>
   <div className="civicBallotQuota" aria-label={'Доступно голосов: '+maxWeight}>
    <b>{maxWeight}</b><span>голосов</span>
   </div>
  </div>
  {vote.voting_mode==='mandate'&&<div className="civicBallotModes">
   <label className={'civicBallotMode '+(partial?'isActive':'')}>
    <input type="checkbox" checked={partial} onChange={e=>{setPartial(e.target.checked);setSplit(false)}}/>
    <span><strong>Указать количество голосов</strong><small>Использовать часть доступных мандатов</small></span>
   </label>
   <label className={'civicBallotMode '+(split?'isActive':'')}>
    <input type="checkbox" checked={split} onChange={e=>{setSplit(e.target.checked);if(e.target.checked)setPartial(false)}}/>
    <span><strong>Распределить голоса между вариантами</strong><small>Разделить голоса между решениями</small></span>
   </label>
  </div>}
  {partial&&<label className="civicBallotAmount">
   <span>Количество голосов<small>От 1 до {maxWeight}</small></span>
   <input type="number" min={1} max={maxWeight} step={1} value={Number.isFinite(quantity)?quantity:''} onChange={e=>setQuantity(e.target.valueAsNumber)}/>
  </label>}
  {split?<div className="civicBallotSplit">
   <div className="civicSplitInputs">{(['yes','no',...(vote.allow_abstain?['abstain']:[])] as const).map(key=><label key={key} className={'civicBallotSplitField is-'+key}>
    <span>{key==='yes'?'За':key==='no'?'Против':'Воздержаться'}</span>
    <input type="number" min={0} max={maxWeight} step={1} value={Number.isFinite(key==='yes'?yes:key==='no'?no:abstain)?(key==='yes'?yes:key==='no'?no:abstain):''} onChange={e=>(key==='yes'?setYes:key==='no'?setNo:setAbstain)(e.target.valueAsNumber)}/>
   </label>)}</div>
   <div className="civicBallotSplitFooter">
    <p className="civicBallotRemaining" role="status">Распределено: <b>{Number.isFinite(total)?total:0}</b> из {maxWeight}. Осталось: <b>{Math.max(0,maxWeight-(Number.isFinite(total)?total:0))}</b>.</p>
    <button type="button" className="primary civicBallotSubmit" disabled={!canCast||!valid||busy} onClick={()=>void send(yes,no,abstain)}>Подать голоса · {Number.isFinite(total)?total:0}</button>
   </div>
  </div>:<div className="voteChoiceButtons civicBallotChoices">
   <button type="button" className="civicBallotChoice is-yes" disabled={!canCast||!valid||busy} onClick={()=>void send(amount,0,0)}><span>За</span><b>{Number.isFinite(amount)?amount:0}</b></button>
   <button type="button" className="civicBallotChoice is-no" disabled={!canCast||!valid||busy} onClick={()=>void send(0,amount,0)}><span>Против</span><b>{Number.isFinite(amount)?amount:0}</b></button>
   {vote.allow_abstain&&<button type="button" className="civicBallotChoice is-abstain" disabled={!canCast||!valid||busy} onClick={()=>void send(0,0,amount)}><span>Воздержаться</span><b>{Number.isFinite(amount)?amount:0}</b></button>}
  </div>}
  {!valid&&maxWeight>0&&<p className="civicBallotError" role="alert">Укажите целые числа. Сумма должна быть от 1 до {maxWeight}.</p>}
  {submitted&&<p className="civicMyBallot">Ваши голоса: за {submitted.yes}, против {submitted.no}, воздержались {submitted.abstain}. Всего {ballot?.weight}.</p>}
 </section>;
}
