'use client';
import {useEffect,useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {ImpactRule} from './types';

function RuleCard({g,rule}:{g:ReturnTypeRepublic;rule:ImpactRule}){
 const [enabled,setEnabled]=useState(rule.enabled);
 const [auto,setAuto]=useState(rule.auto_apply);
 const [description,setDescription]=useState(rule.description||'');
 const [effects,setEffects]=useState<Record<string,number>>(rule.effects?.metrics||{});
 const [party,setParty]=useState(Number(rule.effects?.actor_party_support||0));
 const [busy,setBusy]=useState(false);
 useEffect(()=>{setEnabled(rule.enabled);setAuto(rule.auto_apply);setDescription(rule.description||'');setEffects(rule.effects?.metrics||{});setParty(Number(rule.effects?.actor_party_support||0))},[rule.id,rule.updated_at]);
 async function save(){
  setBusy(true);
  await g.updateImpactRule(rule.id,enabled,auto,{metrics:Object.fromEntries(Object.entries(effects).filter(([,v])=>Number(v)!==0)),...(party?{actor_party_support:party}:{})},description);
  setBusy(false);
 }
 return <article className={'impactRuleCard '+(enabled?'enabled':'disabled')}>
  <header>
   <div><small>{rule.event_type.replaceAll('_',' ').toUpperCase()}</small><h3>{rule.label}</h3></div>
   <div className="impactRuleToggles">
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/><span>Правило</span></label>
    <label><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/><span>Авто</span></label>
   </div>
  </header>
  <textarea rows={2} value={description} onChange={e=>setDescription(e.target.value)} />
  <div className="impactRuleEffects">
   {g.metrics.map(m=><label key={m.id}><span>{m.label}</span><input type="number" step="0.1" value={effects[m.metric_key]??0} onChange={e=>setEffects(x=>({...x,[m.metric_key]:Number(e.target.value)||0}))}/><em>{m.unit||''}</em></label>)}
   <label className="partySupportEffect"><span>Поддержка партии автора</span><input type="number" step="0.1" value={party} onChange={e=>setParty(Number(e.target.value)||0)}/><em>п.п.</em></label>
  </div>
  <footer><span>{rule.conditions&&Object.keys(rule.conditions).length?'Условия: '+JSON.stringify(rule.conditions):'Без дополнительных условий'}</span><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?'Сохраняю…':'Сохранить правило'}</button></footer>
 </article>;
}

function effectsText(g:ReturnTypeRepublic,effects:Record<string,unknown>){
 const m=(effects.metrics||{}) as Record<string,number>;
 const out=Object.entries(m).filter(([,v])=>Number(v)!==0).map(([k,v])=>{
  const metric=g.metrics.find(x=>x.metric_key===k);
  return (Number(v)>0?'+':'')+v+' '+(metric?.label||k);
 });
 if(Number(effects.actor_party_support||0)!==0)out.push((Number(effects.actor_party_support)>0?'+':'')+effects.actor_party_support+' поддержка партии');
 return out;
}

export default function ImpactRulesPanel({g}:{g:ReturnTypeRepublic}){
 const {impactRules,impactLedger,names,revertImpactEntry}=g;
 const [tab,setTab]=useState<'rules'|'ledger'>('rules');
 const active=useMemo(()=>impactRules.filter(r=>r.enabled&&r.auto_apply).length,[impactRules]);
 return <section className="surface impactEngine">
  <div className="surfaceHead"><div><small>АВТОМАТИЧЕСКАЯ МОДЕЛЬ ПОСЛЕДСТВИЙ</small><h2>Действие → правило → изменение показателей</h2></div><span>{active} авто-правил</span></div>
  <div className="impactEngineIntro"><div className="impactEngineFlow"><b>Действие игрока</b><i>→</i><b>Правило</b><i>→</i><b>Показатели</b><i>→</i><b>История</b></div><p>Автоматика учитывает содержательные игровые события: публикации, принятые решения, голосования, движение НПА и кризисы. Навигация и обычные клики показатели не меняют. Любое правило можно отключить, изменить или откатить его конкретное срабатывание.</p></div>
  <div className="impactEngineTabs"><button className={tab==='rules'?'active':''} onClick={()=>setTab('rules')}>Правила <span>{impactRules.length}</span></button><button className={tab==='ledger'?'active':''} onClick={()=>setTab('ledger')}>Журнал влияния <span>{impactLedger.length}</span></button></div>
  {tab==='rules'?<div className="impactRulesGrid">{impactRules.map(r=><RuleCard key={r.id} g={g} rule={r}/>)}</div>:
  <div className="impactLedger">
   {impactLedger.length===0?<div className="emptyState">Автоматические эффекты ещё не срабатывали.</div>:impactLedger.slice(0,50).map(l=>{
    const rule=impactRules.find(r=>r.rule_key===l.rule_key);
    const chips=effectsText(g,l.effects as Record<string,unknown>);
    return <article key={l.id} className={l.status}>
     <span className="impactLedgerMark">{l.status==='reverted'?'↺':'↯'}</span>
     <div><small>{new Date(l.created_at).toLocaleString('ru-RU')} · {l.source_type}</small><b>{rule?.label||l.rule_key}</b><p>{l.note||'Автоматическое изменение'}</p>{l.actor_id&&<em>{names[l.actor_id]||'Участник'}</em>}</div>
     <div className="impactLedgerEffects">{chips.map(x=><span key={x}>{x}</span>)}</div>
     {l.status!=='reverted'?<button onClick={()=>{if(confirm('Отменить это автоматическое изменение и вернуть показатели назад?'))void revertImpactEntry(l.id)}}>Отменить эффект</button>:<strong>Отменено</strong>}
    </article>
   })}
  </div>}
 </section>;
}