'use client';

import {useEffect,useId,useMemo,useState} from 'react';
import {Activity,ArrowDownRight,ChevronDown,ChevronUp,History,RotateCcw,Search,SlidersHorizontal} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {ImpactLedger,ImpactRule} from './types';

type RuleFilter='all'|'automatic'|'off';
type LedgerFilter='all'|'applied'|'reverted';
type Draft={enabled:boolean;auto:boolean;description:string;metrics:Record<string,string>;party:string};

function asDraft(rule:ImpactRule):Draft{
 return {
  enabled:rule.enabled,auto:rule.auto_apply,description:rule.description||'',
  metrics:Object.fromEntries(Object.entries(rule.effects?.metrics||{}).map(([key,value])=>[key,String(value)])),
  party:String(rule.effects?.actor_party_support||0)
 };
}
function decimal(value:string){
 const trimmed=value.trim().replace(',','.');
 return trimmed===''?0:Number(trimmed);
}
function cleanedMetrics(metrics:Record<string,string>){
 return Object.fromEntries(Object.entries(metrics)
  .map(([key,value])=>[key,decimal(value)] as const)
  .filter(([,value])=>value!==0));
}
function isValidNumber(value:string){
 return value.trim()===''||Number.isFinite(decimal(value));
}
function delta(value:number){
 return (value>0?'+':'')+String(value);
}
function impactEntries(g:ReturnTypeRepublic,effects:ImpactRule['effects']){
 const metrics=effects?.metrics||{};
 const entries=Object.entries(metrics).filter(([,value])=>Number(value)!==0).map(([key,value])=>{
  const metric=g.metrics.find(x=>x.metric_key===key);
  return {key,label:metric?.label||key,value:Number(value),unit:metric?.unit||''};
 });
 const support=Number(effects?.actor_party_support||0);
 if(support)entries.push({key:'actor_party_support',label:'Поддержка партии автора',value:support,unit:'п.п.'});
 return entries;
}
function ruleState(rule:ImpactRule){
 if(!rule.enabled)return 'Выключено';
 return rule.auto_apply?'Автоматически':'Авто отключено';
}
function RuleCard({g,rule,expanded,onToggle}:{g:ReturnTypeRepublic;rule:ImpactRule;expanded:boolean;onToggle:()=>void}){
 const panelId=useId();
 const [draft,setDraft]=useState<Draft>(()=>asDraft(rule));
 const [saving,setSaving]=useState(false);
 const [saved,setSaved]=useState(false);
 useEffect(()=>{setDraft(asDraft(rule));setSaved(false)},[rule.id,rule.updated_at]);
 const current=useMemo(()=>asDraft(rule),[rule]);
 const valid=isValidNumber(draft.party)&&Object.values(draft.metrics).every(isValidNumber);
 const dirty=draft.enabled!==current.enabled||draft.auto!==current.auto
  ||draft.description!==current.description
  ||(valid&&(decimal(draft.party)!==decimal(current.party)
   ||JSON.stringify(cleanedMetrics(draft.metrics))!==JSON.stringify(cleanedMetrics(current.metrics))))
  ||!valid;
 const effects=impactEntries(g,rule.effects);
 const nonzero=Object.values(draft.metrics).filter(v=>isValidNumber(v)&&decimal(v)!==0).length
  +(isValidNumber(draft.party)&&decimal(draft.party)!==0?1:0);
 function reset(){setDraft(asDraft(rule));setSaved(false)}
 function patch(patch:Partial<Draft>){setDraft(d=>({...d,...patch}));setSaved(false)}
 async function save(){
  if(saving||!dirty||!valid)return;
  setSaving(true);
  try{
   const success=await g.updateImpactRule(rule.id,draft.enabled,draft.auto,{
    metrics:cleanedMetrics(draft.metrics),
    ...(decimal(draft.party)!==0?{actor_party_support:decimal(draft.party)}:{})
   },draft.description);
   if(success)setSaved(true);
  }finally{setSaving(false)}
 }
 return <article className={'impactRuleCard impactRuleRow '+(!rule.enabled?'disabled':'')+(expanded?' expanded':'')} aria-label={rule.label}>
  <div className="impactRuleSummary">
   <div className="impactRuleTitleBlock">
    <small className="impactRuleEvent">{rule.event_type.replaceAll('_',' ')}</small>
    <h3>{rule.label}</h3>
    <div className="impactRuleMeta">
     <span className={'impactStatus '+(rule.enabled?(rule.auto_apply?'automatic':'manual'):'off')}>{ruleState(rule)}</span>
     <span>{effects.length?effects.length+' показателей':'Без изменений показателей'}</span>
     {dirty&&<span className="impactUnsaved">Не сохранено</span>}
     {!dirty&&saved&&<span className="impactSaved" role="status">Сохранено</span>}
    </div>
   </div>
   <button className="impactExpandButton" type="button" aria-expanded={expanded}
    aria-controls={panelId} onClick={onToggle}>
    {expanded?'Свернуть':'Настроить'}
    {expanded?<ChevronUp aria-hidden="true"/>:<ChevronDown aria-hidden="true"/>}
   </button>
  </div>
  {!expanded&&<div className="impactPreview" aria-label="Текущие эффекты правила">
   {effects.length===0?<span className="impactNoEffects">Показатели не изменяются</span>:
    <>{effects.slice(0,3).map(e=><span className="impactDelta" key={e.key}><b>{delta(e.value)}{e.unit?' '+e.unit:''}</b> {e.label}</span>)}{effects.length>3&&<span className="impactMoreEffects">Ещё {effects.length-3}</span>}</>}
  </div>}
  <div id={panelId} className="impactRuleEditor" hidden={!expanded}>
   <form onSubmit={e=>{e.preventDefault();void save()}}>
    <div className="impactRuleControls">
     <label className="impactToggle"><span><b>Правило включено</b><small>Разрешает применение этого правила</small></span>
      <input type="checkbox" checked={draft.enabled} onChange={e=>patch({enabled:e.target.checked})}/>
     </label>
     <label className="impactToggle"><span><b>Автоматическое применение</b><small>{draft.enabled?'Срабатывает при подходящем событии':'Сначала включите правило'}</small></span>
      <input type="checkbox" disabled={!draft.enabled} checked={draft.auto} onChange={e=>patch({auto:e.target.checked})}/>
     </label>
    </div>
    <label className="impactDescription"><span>Описание механики</span>
     <textarea rows={2} value={draft.description} onChange={e=>patch({description:e.target.value})}
      placeholder="Когда и как действует правило"/>
    </label>
    <div className="impactEffectsHead"><div><b>Изменение показателей</b><p>Укажите величину со знаком + или −. Пустое поле и 0 не изменяют показатель.</p></div><span>{nonzero} изменяются</span></div>
    <div className="impactRuleEffects">
     {g.metrics.map(m=><label key={m.id}>
      <span>{m.label}</span>
      <div className="impactNumeric"><input type="text" inputMode="decimal" autoComplete="off" aria-label={'Изменение: '+m.label}
       aria-invalid={!isValidNumber(draft.metrics[m.metric_key]??'')}
       placeholder="0" value={draft.metrics[m.metric_key]??''}
       onChange={e=>{setDraft(d=>({...d,metrics:{...d.metrics,[m.metric_key]:e.target.value}}));setSaved(false)}}/>
       <em>{m.unit||' '}</em></div>
     </label>)}
     <label className="partySupportEffect"><span>Поддержка партии автора</span>
      <div className="impactNumeric"><input type="text" inputMode="decimal" autoComplete="off" aria-label="Изменение поддержки партии автора"
       aria-invalid={!isValidNumber(draft.party)} value={draft.party} onChange={e=>patch({party:e.target.value})}/>
       <em>п.п.</em></div>
     </label>
    </div>
    {rule.conditions&&Object.keys(rule.conditions).length>0?
     <details className="impactConditions"><summary>Условия применения <ChevronDown aria-hidden="true"/></summary>
      <pre>{JSON.stringify(rule.conditions,null,2)}</pre></details>:
     <p className="impactConditionsEmpty">Дополнительные условия не заданы.</p>}
    <footer className="impactRuleFooter">
     <span role="status" className={dirty?'impactUnsaved':saved?'impactSaved':''}>
      {!valid?'Проверьте числовые значения':dirty?'Есть несохранённые изменения':saved?'Изменения сохранены':'Изменений нет'}
     </span>
     <div><button type="button" className="impactReset" onClick={reset} disabled={!dirty||saving}><RotateCcw aria-hidden="true"/> Сбросить</button>
      <button type="submit" className="primary" disabled={!dirty||!valid||saving}>{saving?'Сохранение…':'Сохранить'}</button></div>
    </footer>
   </form>
  </div>
 </article>;
}

function LedgerRow({g,entry,rule}:{g:ReturnTypeRepublic;entry:ImpactLedger;rule?:ImpactRule}){
 const [busy,setBusy]=useState(false);
 const entries=impactEntries(g,entry.effects);
 const reverted=entry.status==='reverted';
 const name=entry.actor_id?g.names[entry.actor_id]||'Участник':null;
 async function undo(){
  if(busy||!window.confirm('Отменить это срабатывание и вернуть изменения показателей?'))return;
  setBusy(true);
  try{await g.revertImpactEntry(entry.id)}finally{setBusy(false)}
 }
 return <article className={'impactHistoryRow '+(reverted?'reverted':'')}>
  <div className="impactHistoryTop">
   <span className={'impactHistoryIcon '+(reverted?'reverted':'')}><ArrowDownRight aria-hidden="true"/></span>
   <div className="impactHistoryIdentity"><small><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString('ru-RU')}</time> · {entry.source_type.replaceAll('_',' ')}</small>
    <b>{rule?.label||entry.rule_key}</b>
    {entry.note&&<p>{entry.note}</p>}
    {name&&<span>{name}</span>}
   </div>
   <span className={'impactHistoryStatus '+(reverted?'reverted':'applied')}>{reverted?'Отменено':entry.status==='adjusted'?'Скорректировано':'Применено'}</span>
  </div>
  <div className="impactHistoryBottom">
   <div className="impactLedgerEffects">{entries.length?entries.map(e=><span className="impactDelta" key={e.key}><b>{delta(e.value)}{e.unit?' '+e.unit:''}</b> {e.label}</span>):<span className="impactNoEffects">Нет изменений показателей</span>}</div>
   {!reverted&&<button className="impactUndo" disabled={busy} type="button" onClick={()=>void undo()}><RotateCcw aria-hidden="true"/>{busy?'Отмена…':'Отменить эффект'}</button>}
  </div>
 </article>;
}

export default function ImpactRulesPanel({g,initialTab='rules',initialExpandedRuleId=null}:{g:ReturnTypeRepublic;initialTab?:'rules'|'ledger';initialExpandedRuleId?:string|null}){
 const {impactRules,impactLedger}=g;
 const [tab,setTab]=useState<'rules'|'ledger'>(initialTab);
 const [query,setQuery]=useState('');
 const [ruleFilter,setRuleFilter]=useState<RuleFilter>('all');
 const [ledgerFilter,setLedgerFilter]=useState<LedgerFilter>('all');
 const [expandedId,setExpandedId]=useState<string|null>(initialExpandedRuleId);
 const enabled=impactRules.filter(r=>r.enabled).length;
 const automatic=impactRules.filter(r=>r.enabled&&r.auto_apply).length;
 const filtered=impactRules.filter(r=>{
  const matchQuery=(r.label+' '+r.event_type+' '+(r.description||'')).toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU'));
  return matchQuery&&(ruleFilter==='all'||(ruleFilter==='automatic'&&r.enabled&&r.auto_apply)||(ruleFilter==='off'&&!r.enabled));
 });
 const history=useMemo(()=>[...impactLedger].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)),[impactLedger]);
 const filteredHistory=history.filter(l=>ledgerFilter==='all'||(ledgerFilter==='reverted'?l.status==='reverted':l.status!=='reverted'));
 return <section className="surface impactEngine impactWorkbench" aria-label="Модель последствий">
  <header className="impactWorkbenchHeader">
   <div><small>МОДЕЛЬ ПОСЛЕДСТВИЙ</small><h2>Правила и последствия решений</h2>
    <p>Настройка автоматических эффектов и проверяемая история их применения.</p></div>
   <div className="impactWorkbenchStats">
    <span><b>{impactRules.length}</b><small>всего правил</small></span>
    <span><b>{enabled}</b><small>включено</small></span>
    <span><b>{automatic}</b><small>работают автоматически</small></span>
   </div>
  </header>
  <div className="impactProcess" aria-label="Как работает модель">
   <span><Activity aria-hidden="true"/> Событие</span><i>→</i>
   <span><SlidersHorizontal aria-hidden="true"/> Правило</span><i>→</i>
   <span><ArrowDownRight aria-hidden="true"/> Показатели</span><i>→</i>
   <span><History aria-hidden="true"/> Журнал</span>
  </div>
  <nav className="impactWorkbenchTabs" aria-label="Разделы модели">
   <button type="button" className={tab==='rules'?'active':''} aria-current={tab==='rules'?'page':undefined} onClick={()=>setTab('rules')}>
    <SlidersHorizontal aria-hidden="true"/> Правила <span>{impactRules.length}</span></button>
   <button type="button" className={tab==='ledger'?'active':''} aria-current={tab==='ledger'?'page':undefined} onClick={()=>setTab('ledger')}>
    <History aria-hidden="true"/> Журнал влияния <span>{impactLedger.length}</span></button>
  </nav>
  <div hidden={tab!=='rules'} className="impactTabContent" role="region" aria-label="Правила модели">
   <div className="impactWorkbenchFilters">
    <label className="impactSearch"><Search aria-hidden="true"/><input type="search" aria-label="Найти правило"
     value={query} onChange={e=>setQuery(e.target.value)} placeholder="Поиск по названию или событию"/></label>
    <div className="impactFilterChoices" aria-label="Фильтр правил">
     {([['all','Все'],['automatic','Автоматические'],['off','Выключенные']] as const).map(([key,title])=>
      <button type="button" key={key} aria-pressed={ruleFilter===key} className={ruleFilter===key?'selected':''} onClick={()=>setRuleFilter(key)}>{title}</button>)}
    </div>
   </div>
   <p className="impactListCount">Показано {filtered.length} из {impactRules.length} правил. Нажмите «Настроить», чтобы изменить конкретное правило.</p>
   <div className="impactRulesGrid">
    {impactRules.map(rule=><div className="impactRuleItem" key={rule.id} hidden={!filtered.some(item=>item.id===rule.id)}>
     <RuleCard g={g} rule={rule} expanded={expandedId===rule.id} onToggle={()=>setExpandedId(current=>current===rule.id?null:rule.id)}/>
    </div>)}
    {filtered.length===0&&<div className="impactEmpty">Правила по выбранным условиям не найдены. Измените поиск или фильтр.</div>}
   </div>
  </div>
  <div hidden={tab!=='ledger'} className="impactTabContent" role="region" aria-label="Журнал влияния">
   <div className="impactLedgerHeader"><p>Записи показывают, какие изменения реально применены или отменены.</p>
    <div className="impactFilterChoices" aria-label="Фильтр журнала">
     {([['all','Все'],['applied','Действуют'],['reverted','Отменённые']] as const).map(([key,title])=>
      <button type="button" key={key} aria-pressed={ledgerFilter===key} className={ledgerFilter===key?'selected':''} onClick={()=>setLedgerFilter(key)}>{title}</button>)}
    </div></div>
   <div className="impactLedger">
    {filteredHistory.length===0?<div className="impactEmpty">Записей по выбранному фильтру пока нет.</div>:
     filteredHistory.slice(0,50).map(entry=><LedgerRow key={entry.id} g={g} entry={entry} rule={impactRules.find(r=>r.rule_key===entry.rule_key)}/>)}
   </div>
   {filteredHistory.length>50&&<p className="impactListCount">Показаны последние 50 из {filteredHistory.length} записей.</p>}
  </div>
 </section>;
}
