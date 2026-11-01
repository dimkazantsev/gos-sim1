'use client';
import {userError} from '@/lib/userError';
import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {useDialog} from '../ui/useDialog';
import {AlertTriangle,CalendarClock,ChevronRight,Scale,ShieldAlert,UserRound,UsersRound,X} from 'lucide-react';
import {notifyGameDataRefresh,useGameTableSync} from './useGameTableSync';
import {getStageDeadlineRule,type StageDeadlineRule} from './stageDeadlineRuleShared';

type DeadlineIncident={
 id:string;game_id:string;stage_no:number;party_id:string|null;user_id:string|null;
 consequence_type:'representation_loss'|'regional_seat_loss'|'ghost_risk'|'presidential_rating_loss'|'other';
 magnitude:number|null;note:string;status:'active'|'reverted';created_at:string
};

type DeadlineRule=StageDeadlineRule;
const PAGE_SIZE=10;

const CONSEQUENCES={
 representation_loss:{label:'Потеря представительства',unit:'мест',hint:'Этапы 1–2: правила предусматривают потерю мест в КСРФ/ГД, но не задают фиксированное число.'},
 regional_seat_loss:{label:'Потеря региональных мест',unit:'мест',hint:'Этап 3: правила предусматривают потерю мест в законодательных органах субъектов РФ.'},
 ghost_risk:{label:'Повышение риска отсутствия депутатов при голосовании',unit:'к весу',hint:'Этап 5: величина повышает относительный вес фракции в неблагоприятной жеребьёвке. Базовый вес = 1.'},
 presidential_rating_loss:{label:'Снижение рейтинга кандидата',unit:'п.п.',hint:'Этап 6: правила допускают снижение итогового рейтинга; величину фиксирует преподаватель в пределах сценария.'},
 other:{label:'Иное последствие',unit:'',hint:'Используйте только если правило этапа требует последствия, которое не описано стандартными модификаторами.'}
} as const;

const recommended=(stageNo:number):keyof typeof CONSEQUENCES=>
 stageNo<=2?'representation_loss':stageNo===3?'regional_seat_loss':stageNo===5?'ghost_risk':stageNo===6?'presidential_rating_loss':'other';

export default function DeadlineControl({g,stageNo}:{g:ReturnTypeRepublic;stageNo:number}){
 const {game,me,teacher,parties,members,stages,setError}=g;
 const stage=stages.find(s=>s.stage_no===stageNo);
 const [rows,setRows]=useState<DeadlineIncident[]>([]);
 const [rule,setRule]=useState<DeadlineRule|null>(null);
 const [hasMore,setHasMore]=useState(false);
 const [pageBusy,setPageBusy]=useState(false);
 const [partyId,setPartyId]=useState('');
 const [userId,setUserId]=useState('');
 const [targetType,setTargetType]=useState<'party'|'student'>('party');
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [applyOpen,setApplyOpen]=useState(false);
 const [now,setNow]=useState(Date.now());
 const applyDialogRef=useDialog(applyOpen,()=>setApplyOpen(false));

 const scope=JSON.stringify([game?.id,stageNo,me?.user_id,me?.kind,me?.role_title,teacher]);
 const activeScope=useRef(scope),alive=useRef(true),mutationScope=useRef<string|null>(null);activeScope.current=scope;
 const [dataScope,setDataScope]=useState(scope);
 const reads=useRef({scope,promise:null as Promise<void>|null,queued:false,explicit:false,cancel:null as (()=>void)|null});
 if(reads.current.scope!==scope)reads.current={scope,promise:null,queued:false,explicit:false,cancel:null};
 const readState=reads.current,scopeCurrent=()=>alive.current&&activeScope.current===scope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>{
  setRows([]);setRule(null);setHasMore(false);setPageBusy(false);setTargetType('party');setPartyId('');setUserId('');setNote('');setBusy(false);setApplyOpen(false);setDataScope(scope);
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
     const loadedCount=Math.max(PAGE_SIZE,rows.length);
     const [incidents,rules]=await Promise.race([Promise.all([
      supabase.from('stage_deadline_incidents').select('*').eq('game_id',game.id).eq('stage_no',stageNo).eq('status','active').order('created_at',{ascending:false}).order('id',{ascending:false}).range(0,loadedCount).abortSignal(controller.signal),
      getStageDeadlineRule(game.id,stageNo,me.user_id)
     ]),new Promise<never>((_,reject)=>{
      state.cancel=()=>{clearTimeout(timeout);controller.abort();reject(new Error('Обновление последствий отменено.'))};
      timeout=setTimeout(()=>{controller.abort();reject(new Error('Не удалось обновить последствия: сервер не ответил вовремя.'))},12000);
     })]);
     if(scopeCurrent()&&!controller.signal.aborted&&(!passive||document.visibilityState==='visible')){
      if(!incidents.error){const page=(incidents.data||[]) as DeadlineIncident[];setRows(page.slice(0,loadedCount));setHasMore(page.length>loadedCount)}
      if(!rules.error)setRule(rules.data as DeadlineRule|null);
      if(incidents.error||rules.error)setError(userError(incidents.error||rules.error));
     }
    }catch(error){if(scopeCurrent()&&(!passive||document.visibilityState==='visible'))setError(userError(error))}
    finally{clearTimeout(timeout);state.cancel=null}
   }while(state.queued&&scopeCurrent());
  })().finally(()=>{state.promise=null});
  return state.promise;
 }
 async function loadMore(){
  if(!game||!me||pageBusy||!hasMore||!scopeCurrent()||reads.current.promise)return;
  setPageBusy(true);
  try{
   const offset=rows.length;
   const result=await supabase.from('stage_deadline_incidents').select('*')
    .eq('game_id',game.id).eq('stage_no',stageNo).eq('status','active')
    .order('created_at',{ascending:false}).order('id',{ascending:false})
    .range(offset,offset+PAGE_SIZE);
   if(!scopeCurrent())return;
   if(result.error){setError(userError(result.error));return}
   const batch=(result.data||[]) as DeadlineIncident[];
   setRows(previous=>{
    const seen=new Set(previous.map(row=>row.id));
    return [...previous,...batch.slice(0,PAGE_SIZE).filter(row=>!seen.has(row.id))];
   });
   setHasMore(batch.length>PAGE_SIZE);
  }catch(error){if(scopeCurrent())setError(userError(error))}
  finally{if(scopeCurrent())setPageBusy(false)}
 }
 useGameTableSync(me?.user_id?game?.id:undefined,['stage_deadline_incidents','stage_deadline_rules'],()=>load(true),scope,undefined,3000,180000);
 useEffect(()=>{
  if(!game)return;
  const gameId=game.id;
  const sync=(event:Event)=>{
   const detail=(event as CustomEvent<{gameId?:string;stageNo?:number}>).detail;
   if(scopeCurrent()&&detail?.gameId===gameId&&detail?.stageNo===stageNo)notifyGameDataRefresh(gameId,'stage_deadline_rules');
  };
  window.addEventListener('gos-stage-policy-updated',sync);
  return()=>window.removeEventListener('gos-stage-policy-updated',sync);
 },[scope]);
 useEffect(()=>{
  let id:ReturnType<typeof setInterval>|undefined;
  const sync=()=>{clearInterval(id);if(document.visibilityState==='visible'){setNow(Date.now());id=setInterval(()=>setNow(Date.now()),30000)}};
  sync();document.addEventListener('visibilitychange',sync);
  return()=>{clearInterval(id);document.removeEventListener('visibilitychange',sync)};
 },[]);

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

 async function change(request:()=>PromiseLike<{error:unknown}>,after?:()=>void){
  if(!game||!me||!scopeCurrent()||!teacher||mutationScope.current===scope)return;
  mutationScope.current=scope;setBusy(true);
  try{
   const r=await request();if(!scopeCurrent())return;
   if(r.error)setError(userError(r.error));else{notifyGameDataRefresh(game.id,'stage_deadline_incidents');await load();if(scopeCurrent())after?.()}
  }catch(error){if(scopeCurrent())setError(userError(error))}
  finally{if(mutationScope.current===scope)mutationScope.current=null;if(scopeCurrent())setBusy(false)}
 }
 async function record(){
  if(!game||!teacher||!scopeCurrent())return;
  const targetParty=targetType==='party'?partyId:'';
  const targetUser=targetType==='student'?userId:'';
  if(!targetParty&&!targetUser)return;
  const submittedNote=note;
  await change(()=>supabase.rpc('apply_stage_deadline_rule',{
   p_game_id:game.id,
   p_stage_no:stageNo,
   p_party_id:targetParty||null,
   p_user_id:targetUser||null,
   p_note:note.trim()||null
  }),()=>{setPartyId(value=>value===targetParty?'':value);setUserId(value=>value===targetUser?'':value);setNote(value=>value===submittedNote?'':value);setApplyOpen(false)});
 }
 async function revert(id:string){
  await change(()=>supabase.rpc('revert_deadline_consequence',{p_incident_id:id}));
 }

 if(!game||!stage||dataScope!==scope)return null;
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

   <div className="deadlineCount"><strong>{active.length}{hasMore?'+':''}</strong><span>активных последствий</span></div>

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
  {hasMore&&<div className="deadlineLoadMore"><button type="button" className="secondary" disabled={pageBusy} onClick={()=>void loadMore()}>{pageBusy?'Загрузка…':'Показать ещё 10 нарушений'}</button></div>}
 </section>;
}
