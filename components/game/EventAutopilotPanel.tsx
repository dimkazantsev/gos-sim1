'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,BookOpenText,CalendarClock,Check,ChevronDown,ChevronLeft,ChevronRight,PauseCircle,PlayCircle,RefreshCw,Send,Settings2,ShieldCheck} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import EventComic from './EventComic';
import type {EventComicScene} from './types';
import StyledSelect from '../ui/StyledSelect';
import type {ReturnTypeRepublic} from './viewTypes';
type Settings={enabled:boolean;interval_hours:number;activity_weight:number;max_daily:number;trust_per_20:number;backlog_penalty:number;last_run_at:string|null};
type BankCase={comic_scene?:EventComicScene|null;id:string;case_key:string;title:string;situation:string;category:string;seriousness:string;allowed_roles:string[];audience:'single'|'all'|'group';status:string;source_note:string|null};
const DEFAULT:Settings={enabled:false,interval_hours:12,activity_weight:1,max_daily:2,trust_per_20:2,backlog_penalty:1,last_run_at:null};
export default function EventAutopilotPanel({g,onChanged}:{g:ReturnTypeRepublic;onChanged:()=>Promise<void>}){
 const {game,members,teacher}=g;
 const [settings,setSettings]=useState<Settings>(DEFAULT);
 const [bank,setBank]=useState<BankCase[]>([]);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [chosen,setChosen]=useState('');
 const [recipient,setRecipient]=useState('');
 const [groupRecipients,setGroupRecipients]=useState<string[]>([]);
 const bankRail=useRef<HTMLDivElement>(null);
 const [openBank,setOpenBank]=useState(false);
 const [search,setSearch]=useState('');
 const [assigned,setAssigned]=useState<{case_id:string;recipient_id:string}[]>([]);
 const students=members.filter(m=>m.kind==='student');
 const visible=useMemo(()=>bank.filter(c=>[c.title,c.category,c.situation].join(' ').toLowerCase().includes(search.toLowerCase())),[bank,search]);
 const selected=bank.find(c=>c.id===chosen);
 const eligible=students;
 const effectiveInterval=settings.activity_weight===0?settings.interval_hours:Math.max(4,settings.interval_hours/(1+settings.activity_weight*2));
 async function load(){
  if(!game)return;
  const [a,b,c0,d]=await Promise.all([
   supabase.from('event_auto_settings').select('*').eq('game_id',game.id).maybeSingle(),
   supabase.from('event_cases').select('id,case_key,title,situation,category,seriousness,allowed_roles,audience,status,source_note,comic_scene').eq('game_id',game.id).like('case_key','bank-%').eq('status','ready').order('category').order('title'),
   supabase.from('event_assignments').select('case_id,recipient_id').eq('game_id',game.id),
   supabase.from('event_case_outcomes').select('case_id').eq('game_id',game.id)
  ]);
  if(!a.error&&a.data)setSettings(a.data as Settings);
  if(!b.error&&!d.error){const closed=new Set((d.data||[]).map(o=>o.case_id));setBank(((b.data||[]) as BankCase[]).filter(c=>!closed.has(c.id)&&!(c.audience==='single'&&(c0.data||[]).some(a=>a.case_id===c.id))))}
  if(!c0.error)setAssigned(c0.data||[]);
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
  const ids=selected?.audience==='group'?groupRecipients:[recipient];
  if(!game||!chosen||busy||!teacher||ids.some(id=>!eligible.some(m=>m.user_id===id))||(selected?.audience==='group'?ids.length<2||ids.length>3:!recipient))return;
  setBusy(true);setNotice('');
  const r=await supabase.rpc('assign_event_case',{p_case_id:chosen,p_recipients:ids});
  setNotice(r.error?'Ошибка: '+r.error.message:'Назначено новых заданий: '+r.data+'.');
  await load();await onChanged();setBusy(false);
 }
 async function assignAll(){
  if(!game||!chosen||!teacher||busy||selected?.audience!=='all')return;
  const pending=students.filter(m=>!assigned.some(a=>a.case_id===chosen&&a.recipient_id===m.user_id));
  if(!pending.length){setNotice('Ситуация уже направлена всем участникам.');return}
  if(!window.confirm('Назначить ситуацию «'+selected.title+'» всем '+pending.length+' участникам?'))return;
  setBusy(true);setNotice('');
  const r=await supabase.rpc('assign_event_case',{p_case_id:chosen,p_recipients:students.map(m=>m.user_id)});
  setNotice(r.error?'Ошибка: '+r.error.message:'Назначено новых заданий: '+r.data+'.');
  await load();await onChanged();setBusy(false);
 }
 if(!teacher||!game)return null;
 return <section className="autoEventPanel" aria-label="Автоматические события и банк ситуаций">
  <header className="autoEventHeading"><div><small>Автоматические события</small><h3>Автоматический сценарий</h3>
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
   <StyledSelect label="За 20 полезных итогов, п.п." value={String(settings.trust_per_20)} onChange={x=>setSettings(s=>({...s,trust_per_20:Number(x)}))}
    options={[0,1,2,3,4].map(n=>({value:String(n),label:'+'+n+' п.п.'}))}/>
   <StyledSelect label="За 3 просроченные, п.п." value={String(settings.backlog_penalty)} onChange={x=>setSettings(s=>({...s,backlog_penalty:Number(x)}))}
    options={[0,0.5,1,1.5,2].map(n=>({value:String(n),label:'−'+n+' п.п.'}))}/>
  </div>
  <div className="autoEventFormula">
   <Activity size={18} aria-hidden="true"/><p>Интервал = Макс(4 ч.; базовый интервал / (1 + вес активности × Мин(2; часы отсутствия / 48))). Диапазон: от {Math.round(effectiveInterval*10)/10} до {settings.interval_hours} ч. Не более {settings.max_daily} событий за 24 часа и не более трёх нерешённых одновременно. Участникам, давно не заходившим в игру, чаще предлагаются необычные ситуации. За каждые 20 общих решений в интересах общества — +{settings.trust_per_20} п.п. доверия; за каждые три задания старше 48 часов — −{settings.backlog_penalty} п.п. в сутки, но не более −3 п.п. в день.</p>
  </div>
  <button type="button" className="autoEventSave" disabled={busy} onClick={()=>void save(settings)}><Check size={17}/> {busy?'Сохранение…':'Сохранить настройки'}</button>
  <div className="autoEventBank">
   <button type="button" className="autoEventBankToggle" aria-expanded={openBank} onClick={()=>setOpenBank(!openBank)}>
    <BookOpenText size={19}/><span><b>Банк игровых ситуаций</b><small>{bank.length} авторских учебных кейсов</small></span><ChevronDown size={19}/>
   </button>
   {openBank&&<div className="autoEventBankBody">
    <div className="autoEventBankSearch"><input aria-label="Найти ситуацию" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Найти ситуацию по названию, сфере или тексту…"/><button type="button" disabled={busy} onClick={()=>void seed()}><RefreshCw size={16}/> Сверить банк</button></div>
    <p className="eventRailHint">Выберите карточку. Ленту можно прокручивать влево и вправо.</p><div className="autoEventBankLayout"><nav className="eventRailControls" aria-label="Листать карточки"><span>Выберите ситуацию в ленте</span><button type="button" aria-label="Предыдущие карточки" onClick={()=>bankRail.current?.scrollBy({left:-bankRail.current.clientWidth*.8,behavior:'smooth'})}><ChevronLeft size={20}/></button><button type="button" aria-label="Следующие карточки" onClick={()=>bankRail.current?.scrollBy({left:bankRail.current.clientWidth*.8,behavior:'smooth'})}><ChevronRight size={20}/></button></nav><div className="autoEventBankList" role="group" aria-label="Выбор ситуации" tabIndex={0} ref={bankRail}>{visible.map(c=><button type="button" key={c.id} className={chosen===c.id?'selected':''} aria-label={'Открыть ситуацию «'+c.title+'»'} aria-pressed={chosen===c.id} onClick={()=>{setChosen(c.id);setRecipient('');setGroupRecipients([])}}><EventComic title={c.title} category={c.category} caseKey={c.case_key} scene={c.comic_scene} compact silent/><b>{c.title}</b><p className="eventBankSummary">{c.situation}</p><small>{c.category} · {c.seriousness==='light'?'Повседневное':'Серьёзное'}{c.audience==='all'?' · Вся аудитория':''}</small></button>)}</div>
     <article className="autoEventCaseDetails">{selected?<><EventComic title={selected.title} category={selected.category} caseKey={selected.case_key} scene={selected.comic_scene}/><small>{selected.category} · {selected.seriousness==='light'?'Повседневное':'Серьёзное'}{selected.audience==='all'?' · Вся аудитория':''}</small><h4>{selected.title}</h4><p>{selected.situation}</p><em>{selected.source_note||'Авторский учебный кейс'}</em>
       {selected.audience==='all'?<div className="autoEventCaseAssign">
        <p>Ситуация для всей аудитории. При назначении каждый участник получает личное задание, а результаты объединяются в статистике.</p>
        <button type="button" disabled={busy||!students.length||students.every(m=>assigned.some(a=>a.case_id===chosen&&a.recipient_id===m.user_id))}
          onClick={()=>void assignAll()}><Send size={16}/> Назначить всей аудитории</button></div>
       :selected.audience==='group'?<div className="autoEventCaseAssign"><p>Выберите 2–3 участников для совместного голосования.</p><div className="eventGroupRecipients">{eligible.map(m=><label key={m.user_id}><input type="checkbox" checked={groupRecipients.includes(m.user_id)} disabled={!groupRecipients.includes(m.user_id)&&groupRecipients.length>=3} onChange={e=>setGroupRecipients(old=>e.target.checked?[...old,m.user_id]:old.filter(id=>id!==m.user_id))}/>{m.full_name}</label>)}</div><button type="button" disabled={busy||groupRecipients.length<2} onClick={()=>void assign()}><Send size={16}/> Назначить группе</button></div>
       :<div className="autoEventCaseAssign"><StyledSelect label="Назначить участнику" value={recipient} onChange={setRecipient} options={[{value:'',label:'Выберите участника'},...eligible.map(m=>({value:m.user_id,label:m.full_name,disabled:assigned.some(a=>a.case_id===chosen&&a.recipient_id===m.user_id)}))]}/>
       <button type="button" disabled={busy||!recipient||!eligible.some(m=>m.user_id===recipient)||assigned.some(a=>a.case_id===chosen&&a.recipient_id===recipient)} onClick={()=>void assign()}><Send size={16}/> Назначить</button></div>}
      </>:<p>Выберите карточку в ленте ниже.</p>}</article></div>
   </div>}
  </div>
  {notice&&<p className="autoEventNotice" role="status">{notice}</p>}
 </section>;
}
