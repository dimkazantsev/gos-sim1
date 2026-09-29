'use client';
import {useEffect,useMemo,useState} from 'react';
import {Activity,BookOpenText,CalendarClock,Check,ChevronDown,PauseCircle,PlayCircle,RefreshCw,Send,Settings2,ShieldCheck} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import StyledSelect from '../ui/StyledSelect';
import type {ReturnTypeRepublic} from './viewTypes';
type Settings={enabled:boolean;interval_hours:number;activity_weight:number;max_daily:number;trust_per_20:number;backlog_penalty:number;last_run_at:string|null};
type BankCase={id:string;case_key:string;title:string;situation:string;category:string;seriousness:string;allowed_roles:string[];status:string;source_note:string|null};
const DEFAULT:Settings={enabled:false,interval_hours:12,activity_weight:1,max_daily:2,trust_per_20:2,backlog_penalty:1,last_run_at:null};
export default function EventAutopilotPanel({g,onChanged}:{g:ReturnTypeRepublic;onChanged:()=>Promise<void>}){
 const {game,members,teacher}=g;
 const [settings,setSettings]=useState<Settings>(DEFAULT);
 const [bank,setBank]=useState<BankCase[]>([]);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [chosen,setChosen]=useState('');
 const [recipient,setRecipient]=useState('');
 const [openBank,setOpenBank]=useState(false);
 const [search,setSearch]=useState('');
 const [assigned,setAssigned]=useState<{case_id:string;recipient_id:string}[]>([]);
 const students=members.filter(m=>m.kind==='student');
 const visible=useMemo(()=>bank.filter(c=>[c.title,c.category,c.situation].join(' ').toLowerCase().includes(search.toLowerCase())),[bank,search]);
 const selected=bank.find(c=>c.id===chosen);
 const eligible=students.filter(m=>!selected?.allowed_roles?.length||selected.allowed_roles.some(role=>(m.role_title||'').toLowerCase().includes(role.toLowerCase())));
 const effectiveInterval=settings.activity_weight===0?settings.interval_hours:Math.max(4,settings.interval_hours/(1+settings.activity_weight*2));
 async function load(){
  if(!game)return;
  const [a,b,c]=await Promise.all([
   supabase.from('event_auto_settings').select('*').eq('game_id',game.id).maybeSingle(),
   supabase.from('event_cases').select('id,case_key,title,situation,category,seriousness,allowed_roles,status,source_note').eq('game_id',game.id).like('case_key','bank-%').order('category').order('title'),
   supabase.from('event_assignments').select('case_id,recipient_id').eq('game_id',game.id)
  ]);
  if(!a.error&&a.data)setSettings(a.data as Settings);
  if(!b.error)setBank((b.data||[]) as BankCase[]);
  if(!c.error)setAssigned(c.data||[]);
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{if(bank.length&&!bank.some(c=>c.id===chosen))setChosen(bank[0].id)},[bank,chosen]);
 async function save(next:Settings){
  if(!game||!teacher||busy)return;
  setBusy(true);setNotice('');
  const r=await supabase.rpc('configure_game_event_autopilot',{
   p_game_id:game.id,p_enabled:next.enabled,p_interval_hours:next.interval_hours,
   p_activity_weight:next.activity_weight,p_max_daily:next.max_daily,
   p_trust_per_20:next.trust_per_20,p_backlog_penalty:next.backlog_penalty
  });
  if(r.error){setNotice('Ошибка: '+r.error.message)}else{
   setSettings(next);setNotice(next.enabled?'Автоматическая отправка активирована.':'Настройки сохранены. Автоматическая отправка остановлена.');
   await load();await onChanged();
  }
  setBusy(false);
 }
 async function seed(){
  if(!game||busy)return;
  setBusy(true);setNotice('');
  const r=await supabase.rpc('seed_game_event_bank',{p_game_id:game.id});
  setNotice(r.error?'Ошибка: '+r.error.message:'Банк проверен. Новых ситуаций: '+(r.data??0));
  await load();await onChanged();setBusy(false);
 }
 async function run(){
  if(!game||busy)return;
  setBusy(true);setNotice('');
  const r=await supabase.rpc('run_game_event_autopilot',{p_game_id:game.id});
  if(r.error)setNotice('Ошибка: '+r.error.message);
  else setNotice('Назначено новых ситуаций: '+(r.data?.sent??0)+'. '+(r.data?.reason==='paused'?'Автоматическая отправка приостановлена.':r.data?.reason==='already_checked'?'Повторная проверка доступна через час.':''));
  await load();await onChanged();setBusy(false);
 }
 async function assign(){
  if(!game||!chosen||!recipient||busy||assigned.some(x=>x.case_id===chosen&&x.recipient_id===recipient))return;
  setBusy(true);setNotice('');
  const r=await supabase.from('event_assignments').insert({game_id:game.id,case_id:chosen,recipient_id:recipient,created_by:g.me?.user_id});
  setNotice(r.error?'Ошибка: '+r.error.message:'Ситуация назначена участнику.');
  await load();await onChanged();setBusy(false);
 }
 if(!teacher||!game)return null;
 return <section className="autoEventPanel" aria-label="Автоматические события и банк ситуаций">
  <header className="autoEventHeading"><div><small>РЕЖИССЁР · АВТОМАТИЧЕСКИЕ СОБЫТИЯ</small><h3>Автоматический сценарий</h3>
   <p>События подбираются по игровой должности и активности. Решения и изменение доверия записываются в общую базу.</p></div>
   <span className={'autoEventState '+(settings.enabled?'enabled':'paused')}>{settings.enabled?<PlayCircle size={16}/>:<PauseCircle size={16}/>} {settings.enabled?'Работает':'Пауза'}</span>
  </header>
  <div className="autoEventButtons">
   <button type="button" disabled={busy||settings.enabled} onClick={()=>void save({...settings,enabled:true})}><PlayCircle size={18}/> Запустить</button>
   <button type="button" disabled={busy||!settings.enabled} onClick={()=>void save({...settings,enabled:false})}><PauseCircle size={18}/> Пауза</button>
   <button type="button" disabled={busy||!settings.enabled} onClick={()=>void run()}><RefreshCw size={18}/> Проверить сейчас</button>
  </div>
  <div className="autoEventSettings">
   <StyledSelect label="Основной интервал" value={String(settings.interval_hours)} onChange={x=>setSettings(s=>({...s,interval_hours:Number(x)}))}
    options={[4,6,8,12,18,24,36,48,72].map(n=>({value:String(n),label:'Раз в '+n+' ч.'}))}/>
   <StyledSelect label="Учёт активности" value={String(settings.activity_weight)} onChange={x=>setSettings(s=>({...s,activity_weight:Number(x)}))}
    options={[{value:'0',label:'Отключён'},{value:'0.5',label:'Умеренный'},{value:'1',label:'Стандартный'},{value:'2',label:'Усиленный'}]}/>
   <StyledSelect label="Лимит за 24 часа" value={String(settings.max_daily)} onChange={x=>setSettings(s=>({...s,max_daily:Number(x)}))}
    options={[1,2,3].map(n=>({value:String(n),label:n+' '+(n===1?'событие':'события')}))}/>
   <StyledSelect label="За 20 решений, п.п." value={String(settings.trust_per_20)} onChange={x=>setSettings(s=>({...s,trust_per_20:Number(x)}))}
    options={[0,1,2,3,4].map(n=>({value:String(n),label:'+'+n+' п.п.'}))}/>
   <StyledSelect label="За 3 просроченные, п.п." value={String(settings.backlog_penalty)} onChange={x=>setSettings(s=>({...s,backlog_penalty:Number(x)}))}
    options={[0,0.5,1,1.5,2].map(n=>({value:String(n),label:'−'+n+' п.п.'}))}/>
  </div>
  <div className="autoEventFormula">
   <Activity size={18} aria-hidden="true"/><p>Интервал = Макс(4 ч.; базовый интервал / (1 + вес активности × Мин(2; часы отсутствия / 48))). Диапазон: от {Math.round(effectiveInterval*10)/10} до {settings.interval_hours} ч. Не более {settings.max_daily} событий за 24 часа и не более трёх нерешённых одновременно. Участникам, давно не заходившим в игру, чаще предлагаются необычные ситуации. За каждые 20 обработанных заданий — +{settings.trust_per_20} п.п. доверия; за каждые три задания старше 48 часов — −{settings.backlog_penalty} п.п. в сутки, но не более −3 п.п. в день.</p>
  </div>
  <button type="button" className="autoEventSave" disabled={busy} onClick={()=>void save(settings)}><Check size={17}/> {busy?'Сохранение…':'Сохранить настройки'}</button>
  <div className="autoEventBank">
   <button type="button" className="autoEventBankToggle" aria-expanded={openBank} onClick={()=>setOpenBank(!openBank)}>
    <BookOpenText size={19}/><span><b>Банк игровых ситуаций</b><small>{bank.length} авторских учебных кейсов</small></span><ChevronDown size={19}/>
   </button>
   {openBank&&<div className="autoEventBankBody">
    <div className="autoEventBankSearch"><input aria-label="Найти ситуацию" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Найти ситуацию по названию, сфере или тексту…"/><button type="button" disabled={busy} onClick={()=>void seed()}><RefreshCw size={16}/> Пополнить банк</button></div>
    <div className="autoEventBankLayout"><div className="autoEventBankList" role="list">{visible.map(c=><button type="button" role="listitem" key={c.id} className={chosen===c.id?'selected':''} onClick={()=>setChosen(c.id)}><b>{c.title}</b><small>{c.category} · {c.seriousness==='light'?'Повседневное':'Серьёзное'}</small></button>)}</div>
     <article className="autoEventCaseDetails">{selected?<><small>{selected.category} · {selected.seriousness==='light'?'Повседневное':'Серьёзное'}</small><h4>{selected.title}</h4><p>{selected.situation}</p><em>{selected.source_note||'Авторский учебный кейс'}</em>
       <div className="autoEventCaseAssign"><StyledSelect label="Назначить участнику" value={recipient} onChange={setRecipient} options={[{value:'',label:'Выберите участника'},...eligible.map(m=>({value:m.user_id,label:m.full_name,disabled:assigned.some(a=>a.case_id===chosen&&a.recipient_id===m.user_id)}))]}/>
       <button type="button" disabled={busy||!recipient||assigned.some(a=>a.case_id===chosen&&a.recipient_id===recipient)} onClick={()=>void assign()}><Send size={16}/> Назначить</button></div>
      </>:<p>Выберите ситуацию слева.</p>}</article></div>
   </div>}
  </div>
  {notice&&<p className="autoEventNotice" role="status">{notice}</p>}
 </section>;
}
