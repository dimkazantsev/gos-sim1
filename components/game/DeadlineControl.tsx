'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import DisclosureSummary from '../ui/DisclosureSummary';
import {Scale} from 'lucide-react';

type DeadlineIncident={
 id:string;game_id:string;stage_no:number;party_id:string|null;user_id:string|null;
 consequence_type:'representation_loss'|'regional_seat_loss'|'ghost_risk'|'presidential_rating_loss'|'other';
 magnitude:number|null;note:string;status:'active'|'reverted';created_at:string
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
 const [partyId,setPartyId]=useState('');
 const [userId,setUserId]=useState('');
 const [kind,setKind]=useState<keyof typeof CONSEQUENCES>(recommended(stageNo));
 const [magnitude,setMagnitude]=useState('');
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [now,setNow]=useState(Date.now());

 async function load(){
  if(!game)return;
  const r=await supabase.from('stage_deadline_incidents').select('*').eq('game_id',game.id).eq('stage_no',stageNo).order('created_at',{ascending:false});
  if(!r.error)setRows((r.data||[]) as DeadlineIncident[]);
 }
 useEffect(()=>{setKind(recommended(stageNo));void load()},[game?.id,stageNo]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('deadline-control:'+game.id+':'+stageNo)
   .on('postgres_changes',{event:'*',schema:'public',table:'stage_deadline_incidents',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id,stageNo]);
 useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id)},[]);

 const deadline=stage?.deadline?new Date(stage.deadline).getTime():null;
 const delta=deadline===null?null:Math.floor((deadline-now)/1000);
 const overdue=delta!==null&&delta<0;
 const abs=delta===null?0:Math.abs(delta);
 const timeText=deadline===null?'Не установлен':(overdue?'Просрочено на ':'Осталось ')+
  (Math.floor(abs/86400)>0?Math.floor(abs/86400)+' дн. ':'')+
  String(Math.floor((abs%86400)/3600)).padStart(2,'0')+':'+String(Math.floor((abs%3600)/60)).padStart(2,'0');

 const active=useMemo(()=>rows.filter(x=>x.status==='active'),[rows]);
 const partyName=(id:string|null)=>parties.find(p=>p.id===id)?.name||'—';
 const userName=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';

 async function record(){
  if(!game||(!partyId&&!userId)||note.trim().length<5)return;
  const requiresMagnitude=kind!=='other';
  if(requiresMagnitude&&(!magnitude||!Number.isFinite(Number(magnitude))||Number(magnitude)<=0))return;
  setBusy(true);
  const r=await supabase.rpc('record_deadline_consequence',{
   p_game_id:game.id,p_stage_no:stageNo,p_party_id:partyId||null,p_user_id:userId||null,
   p_consequence_type:kind,p_magnitude:requiresMagnitude?Number(magnitude):null,p_note:note.trim()
  });
  if(r.error)setError(r.error.message);else{setMagnitude('');setNote('');await load()}
  setBusy(false);
 }
 async function revert(id:string){
  setBusy(true);const r=await supabase.rpc('revert_deadline_consequence',{p_incident_id:id});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }

 if(!game||!stage)return null;
 const guide=CONSEQUENCES[kind];
 const unitPlaceholder=guide.unit?guide.unit.charAt(0).toLocaleUpperCase('ru-RU')+guide.unit.slice(1):'';

 return <section className={'deadlineControl '+(overdue?'overdue':'')}>
  <header><div><small>ДЕДЛАЙН И ПОСЛЕДСТВИЯ</small><h3>{timeText}</h3><p>{stage.deadline?new Date(stage.deadline).toLocaleString('ru-RU'):'Преподаватель ещё не установил срок этапа.'}</p></div><div className="deadlineCount"><strong>{active.length}</strong><span>активных последствий</span></div></header>

  {active.length>0&&<div className="deadlineLedger">{active.map(x=><article key={x.id}><div><b>{CONSEQUENCES[x.consequence_type].label}</b><small>{x.party_id?partyName(x.party_id):userName(x.user_id)} · {new Date(x.created_at).toLocaleString('ru-RU')}</small><p>{x.note}</p></div><strong>{x.magnitude!=null?String(x.magnitude)+' '+CONSEQUENCES[x.consequence_type].unit:'зафиксировано'}</strong>{teacher&&<button disabled={busy} onClick={()=>void revert(x.id)}>Отменить</button>}</article>)}</div>}

  {teacher&&<details className="deadlineApply">
   <DisclosureSummary icon={Scale} title="Зафиксировать нарушение и последствие" description="Выберите адресата, последствие и укажите основание"/>
   <div className="deadlineApplyGrid">
    <label>Партия<select value={partyId} onChange={e=>{setPartyId(e.target.value);if(e.target.value)setUserId('')}}><option value="">Не выбрана</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>Студент<select value={userId} onChange={e=>{setUserId(e.target.value);if(e.target.value){setPartyId('');setKind('other')}}}><option value="">Не выбран</option>{members.filter(m=>m.kind==='student').map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label>
    <label>Тип последствия<select value={kind} onChange={e=>{setKind(e.target.value as keyof typeof CONSEQUENCES);if(e.target.value!=='other')setUserId('')}}>{Object.entries(CONSEQUENCES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></label>
    {kind!=='other'&&<label>Величина<input type="number" min={kind==='ghost_risk'||kind==='presidential_rating_loss'?'0.1':'1'} max={kind==='representation_loss'?450:kind==='regional_seat_loss'?89:kind==='presidential_rating_loss'?100:undefined} step={kind==='ghost_risk'||kind==='presidential_rating_loss'?'0.1':'1'} value={magnitude} onChange={e=>setMagnitude(e.target.value)} placeholder={unitPlaceholder}/></label>}
    <label className="deadlineReason">Основание<textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="Что именно не выполнено в установленный срок и почему применяется это последствие?"/></label>
    <div className="deadlineGuide"><b>{guide.label}</b><p>{guide.hint}</p></div>
    <button className="primary" disabled={busy||(!partyId&&!userId)||note.trim().length<5||(kind!=='other'&&(!partyId||!Number.isFinite(Number(magnitude))||Number(magnitude)<=0))} onClick={()=>void record()}>Зафиксировать последствие</button>
   </div>
  </details>}
 </section>;
}
