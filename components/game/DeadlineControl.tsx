'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {useDialog} from '../ui/useDialog';
import {AlertTriangle,CalendarClock,ChevronRight,Scale,ShieldAlert,UserRound,UsersRound,X} from 'lucide-react';

type DeadlineIncident={
 id:string;game_id:string;stage_no:number;party_id:string|null;user_id:string|null;
 consequence_type:'representation_loss'|'regional_seat_loss'|'ghost_risk'|'presidential_rating_loss'|'other';
 magnitude:number|null;note:string;status:'active'|'reverted';created_at:string
};

type DeadlineRule={
 game_id:string;stage_no:number;deadline_at:string|null;inclusive:boolean;
 penalty_points:number;penalty_description:string;consequence_type:'none'|'representation_loss'|'regional_seat_loss'|'ghost_risk'|'presidential_rating_loss';consequence_magnitude:number|null;updated_at:string
};

const CONSEQUENCES={
 representation_loss:{label:'Потеря представительства',unit:'мест',hint:'Этапы 1–2: правила предусматривают потерю мест в КСРФ/ГД, но не задают фиксированное число.'},
 regional_seat_loss:{label:'Потеря региональных мест',unit:'мест',hint:'Этап 3: правила предусматривают потерю мест в законодательных органах субъектов РФ.'},
 ghost_risk:{label:'Рост риска Ghost voting',unit:'к весу',hint:'Этап 5: величина повышает относительный вес фракции в неблагоприятной жеребьёвке. Базовый вес = 1.'},
 presidential_rating_loss:{label:'Снижение рейтинга кандидата',unit:'п.п.',hint:'Этап 6: правила допускают снижение итогового рейтинга; величину фиксирует преподаватель в пределах сценария.'},
 other:{label:'Иное последствие',unit:'',hint:'Используйте только если правило этапа требует последствия, которое не описано стандартными модификаторами.'}
} as const;

const recommended=(stageNo:number):keyof typeof CONSEQUENCES=>
 stageNo<=2?'representation_loss':stageNo===3?'regional_seat_loss':stageNo===5?'ghost_risk':stageNo===6?'presidential_rating_loss':'other';

export default function DeadlineControl({g,stageNo}:{g:ReturnTypeRepublic;stageNo:number}){
 const {game,teacher,parties,members,stages,setError}=g;
 const stage=stages.find(s=>s.stage_no===stageNo);
 const [rows,setRows]=useState<DeadlineIncident[]>([]);
 const [rule,setRule]=useState<DeadlineRule|null>(null);
 const [partyId,setPartyId]=useState('');
 const [userId,setUserId]=useState('');
 const [targetType,setTargetType]=useState<'party'|'student'>('party');
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [applyOpen,setApplyOpen]=useState(false);
 const [now,setNow]=useState(Date.now());
 const applyDialogRef=useDialog(applyOpen,()=>setApplyOpen(false));

 async function load(){
  if(!game)return;
  const [incidents,rules]=await Promise.all([
   supabase.from('stage_deadline_incidents').select('*').eq('game_id',game.id).eq('stage_no',stageNo).order('created_at',{ascending:false}),
   supabase.from('stage_deadline_rules').select('game_id,stage_no,deadline_at,inclusive,penalty_points,penalty_description,consequence_type,consequence_magnitude,updated_at').eq('game_id',game.id).eq('stage_no',stageNo).maybeSingle()
  ]);
  if(!incidents.error)setRows((incidents.data||[]) as DeadlineIncident[]);
  if(!rules.error)setRule((rules.data||null) as DeadlineRule|null);
 }
 useEffect(()=>{setTargetType('party');setPartyId('');setUserId('');setNote('');void load()},[game?.id,stageNo]);
 useEffect(()=>{
  if(!game)return;
  const gameId=game.id;
  const sync=(event:Event)=>{
   const detail=(event as CustomEvent<{gameId?:string;stageNo?:number}>).detail;
   if(detail?.gameId===gameId&&detail?.stageNo===stageNo)void load();
  };
  window.addEventListener('gos-stage-policy-updated',sync);
  return()=>window.removeEventListener('gos-stage-policy-updated',sync);
 },[game?.id,stageNo]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('deadline-control:'+game.id+':'+stageNo)
   .on('postgres_changes',{event:'*',schema:'public',table:'stage_deadline_incidents',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'stage_deadline_rules',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id,stageNo]);
 useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id)},[]);

 const effectiveDeadline=rule?.deadline_at??stage?.deadline??null;
 const deadline=effectiveDeadline?new Date(effectiveDeadline).getTime():null;
 const delta=deadline===null?null:Math.floor((deadline-now)/1000);
 const overdue=delta!==null&&delta<0;
 const abs=delta===null?0:Math.abs(delta);
 const timeText=deadline===null?'Не установлен':(overdue?'Просрочено на ':'Осталось ')+
  (Math.floor(abs/86400)>0?Math.floor(abs/86400)+' дн. ':'')+
  String(Math.floor((abs%86400)/3600)).padStart(2,'0')+':'+String(Math.floor((abs%3600)/60)).padStart(2,'0');
 const deadlineLabel=effectiveDeadline
  ?(rule?.inclusive===false?'Строго до ':'До, включительно · ')+new Date(effectiveDeadline).toLocaleString('ru-RU')
  :'Преподаватель ещё не установил срок этапа.';
 const penaltyPoints=Number(rule?.penalty_points??0);
 const penaltyDescription=rule?.penalty_description?.trim()||'Штрафное правило не настроено.';

 const active=useMemo(()=>rows.filter(x=>x.status==='active'),[rows]);
 const partyName=(id:string|null)=>parties.find(p=>p.id===id)?.name||'—';
 const userName=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';

 async function record(){
  if(!game)return;
  const targetParty=targetType==='party'?partyId:'';
  const targetUser=targetType==='student'?userId:'';
  if(!targetParty&&!targetUser)return;
  setBusy(true);
  const r=await supabase.rpc('apply_stage_deadline_rule',{
   p_game_id:game.id,
   p_stage_no:stageNo,
   p_party_id:targetParty||null,
   p_user_id:targetUser||null,
   p_note:note.trim()||null
  });
  if(r.error)setError(r.error.message);
  else{
   setPartyId('');setUserId('');setNote('');
   await load();setApplyOpen(false);
  }
  setBusy(false);
 }
 async function revert(id:string){
  setBusy(true);const r=await supabase.rpc('revert_deadline_consequence',{p_incident_id:id});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }

 if(!game||!stage)return null;
 const configuredConsequence=rule?.consequence_type??'none';
 const configuredMagnitude=Number(rule?.consequence_magnitude??0);
 const guide=configuredConsequence==='none'?null:CONSEQUENCES[configuredConsequence];
 const partyRuleReady=configuredConsequence!=='none'&&configuredMagnitude>0;
 const studentRuleReady=penaltyPoints>0;
 const canApplyRule=overdue&&(partyRuleReady||studentRuleReady);

 return <section className={'deadlineControl '+(overdue?'overdue':'')}>
  <div className={'deadlineControlTop '+(teacher?'hasAction':'')}>
   <header className="deadlineOverview">
    <div className="deadlineOverviewCopy">
     <small>ДЕДЛАЙН И ПОСЛЕДСТВИЯ</small>
     <h3>{timeText}</h3>
     <p>{deadlineLabel}</p>
     <div className="deadlineRuleMeta">
      <span><CalendarClock size={15}/>{effectiveDeadline?(rule?.inclusive===false?'Строгий срок':'Срок включительно'):'Срок не задан'}</span>
      <span className={penaltyPoints>0?'hasPenalty':''}><ShieldAlert size={15}/>{penaltyPoints>0?'Штраф: '+penaltyPoints+' балл'+(penaltyPoints===1?'':penaltyPoints<5?'а':'ов'):'Штраф не задан'}</span>
     </div>
     <div className="deadlineRuleDescription"><b>Основание:</b><span>{penaltyDescription}</span></div>
    </div>
   </header>

   <div className="deadlineCount"><strong>{active.length}</strong><span>активных последствий</span></div>

   {teacher&&<button type="button" className="deadlineActionCard" disabled={!canApplyRule} onClick={()=>{if(canApplyRule){setTargetType(partyRuleReady?'party':'student');setApplyOpen(true)}}}>
    <span className="deadlineActionIcon" aria-hidden="true"><Scale size={20}/></span>
    <span className="deadlineActionCopy"><b>{overdue?'Применить правило просрочки':'Правило применится после дедлайна'}</b><small>{canApplyRule?'Выберите адресата — санкция подставится автоматически':'Настройте дедлайн и санкцию в правиле этапа'}</small></span>
    <ChevronRight size={18} aria-hidden="true"/>
   </button>}
  </div>

  {teacher&&applyOpen&&<div className="deadlineViolationBackdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setApplyOpen(false)}}>
   <section ref={applyDialogRef} className="deadlineViolationPanel" role="dialog" aria-modal="true" aria-labelledby="deadline-violation-title" tabIndex={-1} onMouseDown={e=>e.stopPropagation()}>
    <header className="deadlineViolationHeader">
     <div className="deadlineViolationHeaderIcon" aria-hidden="true"><Scale size={23}/></div>
     <div><small>ПОСЛЕДСТВИЕ · ЭТАП {stageNo}</small><h3 id="deadline-violation-title">Зафиксировать нарушение</h3><p>Выберите адресата, задайте последствие и кратко обоснуйте решение.</p></div>
     <button type="button" className="deadlineViolationClose" aria-label="Закрыть" onClick={()=>setApplyOpen(false)}><X size={19}/></button>
    </header>

    <div className="deadlineViolationContext">
     <span><CalendarClock size={16}/><b>{timeText}</b><small>{deadlineLabel}</small></span>
     <span><ShieldAlert size={16}/><b>{targetType==='student'?(studentRuleReady?'−'+penaltyPoints+' балл'+(penaltyPoints===1?'':penaltyPoints<5?'а':'ов'):'Штраф студенту не настроен'):(partyRuleReady?(guide?.label||'Игровое последствие')+' · '+configuredMagnitude+' '+(guide?.unit||''):'Последствие партии не настроено')}</b><small>{penaltyDescription}</small></span>
    </div>

    <div className="deadlineViolationBody">
     <section className="deadlineViolationSection">
      <div className="deadlineViolationSectionHead"><span>01</span><div><b>Адресат</b><small>Выберите, к кому применить уже настроенное правило</small></div></div>
      <div className="deadlineTargetSwitch" role="group" aria-label="Тип адресата">
       {partyRuleReady&&<button type="button" className={targetType==='party'?'active':''} onClick={()=>{setTargetType('party');setUserId('')}}><UsersRound size={17}/> Партия</button>}
       {studentRuleReady&&<button type="button" className={targetType==='student'?'active':''} onClick={()=>{setTargetType('student');setPartyId('')}}><UserRound size={17}/> Студент</button>}
      </div>
      {targetType==='party'&&partyRuleReady&&<label className="deadlineViolationField">Партия<select value={partyId} onChange={e=>setPartyId(e.target.value)}><option value="">Выберите партию</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      {targetType==='student'&&studentRuleReady&&<label className="deadlineViolationField">Студент<select value={userId} onChange={e=>setUserId(e.target.value)}><option value="">Выберите студента</option>{members.filter(m=>m.kind==='student').map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label>}
     </section>

     <section className="deadlineViolationSection deadlineViolationRulePreview">
      <div className="deadlineViolationSectionHead"><span>02</span><div><b>Будет применено автоматически</b><small>Значения берутся из единого правила этапа</small></div></div>
      <div className="deadlineAutomaticRule">
       {targetType==='student'
        ?<><ShieldAlert size={18}/><div><b>Штраф: {penaltyPoints} балл{penaltyPoints===1?'':penaltyPoints<5?'а':'ов'}</b><p>{penaltyDescription}</p></div></>
        :<><Scale size={18}/><div><b>{guide?.label||'Игровое последствие'} · {configuredMagnitude} {guide?.unit||''}</b><p>{guide?.hint||penaltyDescription}</p></div></>}
      </div>
     </section>

     <section className="deadlineViolationSection">
      <div className="deadlineViolationSectionHead"><span>03</span><div><b>Комментарий</b><small>Необязательно — если нужен дополнительный контекст</small></div></div>
      <label className="deadlineViolationField">Комментарий<textarea rows={4} value={note} onChange={e=>setNote(e.target.value)} placeholder={penaltyDescription}/></label>
     </section>
    </div>

    <footer className="deadlineViolationFooter">
     <button type="button" className="secondary" onClick={()=>setApplyOpen(false)} disabled={busy}>Отмена</button>
     <button type="button" className="primary" disabled={busy||(targetType==='party'?!partyId:!userId)} onClick={()=>void record()}>{busy?'Применение…':'Применить правило'}</button>
    </footer>
   </section>
  </div>}

  {active.length>0&&<div className="deadlineLedger">{active.map(x=><article key={x.id}><div><b>{CONSEQUENCES[x.consequence_type].label}</b><small>{x.party_id?partyName(x.party_id):userName(x.user_id)} · {new Date(x.created_at).toLocaleString('ru-RU')}</small><p>{x.note}</p></div><strong>{x.magnitude!=null?String(x.magnitude)+' '+CONSEQUENCES[x.consequence_type].unit:'зафиксировано'}</strong>{teacher&&<button disabled={busy} onClick={()=>void revert(x.id)}>Отменить</button>}</article>)}</div>}
 </section>;
}
