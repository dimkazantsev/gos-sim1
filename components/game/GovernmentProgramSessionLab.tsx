'use client';
import StageModuleHeader from '../ui/StageModuleHeader';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';

type Session={id:string;game_id:string;session_no:number;title:string;time_limit_minutes:number;status:'draft'|'open'|'closed';chair_user_id:string|null;created_at:string;opened_at:string|null;closed_at:string|null};
type Item={id:string;session_id:string;program_id:string;agenda_no:number;report_minutes:number;status:'pending'|'presenting'|'decision'|'completed'|'withdrawn';vote_id:string|null;result_note:string|null;started_at:string|null;completed_at:string|null};
type Program={id:string;title:string;responsible_ministry:string;status:string;responsible_minister_id:string|null};

export default function GovernmentProgramSessionLab({g,onOpenVotes}:{g:ReturnTypeRepublic;onOpenVotes:(id?:string)=>void}){
 const {game,me,teacher,members,votes,setError}=g;
 const [sessions,setSessions]=useState<Session[]>([]);
 const [items,setItems]=useState<Item[]>([]);
 const [programs,setPrograms]=useState<Program[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [title,setTitle]=useState('');
 const [timeLimit,setTimeLimit]=useState(60);
 const [programId,setProgramId]=useState('');
 const [reportMinutes,setReportMinutes]=useState(7);
 const [busy,setBusy]=useState(false);
 const role=stageRoleTitles(g);
 const canManage=teacher||(role.includes('председател')&&role.includes('правительств'))||role.includes('президент');

 async function load(){
  if(!game)return;
  const [s,i,p]=await Promise.all([
   supabase.from('government_sessions').select('*').eq('game_id',game.id).order('session_no',{ascending:false}),
   supabase.from('government_program_agenda').select('*').eq('game_id',game.id).order('agenda_no'),
   supabase.from('state_programs').select('id,title,responsible_ministry,status,responsible_minister_id').eq('game_id',game.id).order('title')
  ]);
  const failure=[s,i,p].find(x=>x.error);if(failure?.error){setError(failure.error.message);return;}
  if(!s.error){const rows=(s.data||[]) as Session[];setSessions(rows);if(!selectedId&&rows[0])setSelectedId(rows[0].id)}
  if(!i.error)setItems((i.data||[]) as Item[]);
  if(!p.error)setPrograms((p.data||[]) as Program[]);
 }
 useGameTableSync(game?.id,['government_sessions','government_program_agenda','state_programs','game_votes','game_ballots','institution_session_registrations'],load,me?.user_id||'');

 if(!game||!me)return null;
 const activeGame=game;
 const selected=sessions.find(x=>x.id===selectedId)||sessions[0];
 const agenda=selected?items.filter(x=>x.session_id===selected.id).sort((a,b)=>a.agenda_no-b.agenda_no):[];
 const readyPrograms=programs.filter(p=>p.status==='ready');
 const current=agenda.find(x=>x.status==='presenting'||x.status==='decision');
 const name=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';
 const program=(id:string)=>programs.find(p=>p.id===id);
 const vote=(id:string|null)=>id?votes.find(v=>v.id===id):undefined;

 async function create(){
  setBusy(true);const r=await supabase.rpc('create_government_session',{p_game_id:activeGame.id,p_title:title.trim()||'Заседание Правительства',p_time_limit_minutes:timeLimit});
  if(r.error)setError(r.error.message);else{if(r.data)setSelectedId(String(r.data));setTitle('');await load()}setBusy(false);
 }
 async function add(){
  if(!selected||!programId)return;setBusy(true);const r=await supabase.rpc('add_program_to_government_agenda',{p_session_id:selected.id,p_program_id:programId,p_report_minutes:reportMinutes});
  if(r.error)setError(r.error.message);else{setProgramId('');await load()}setBusy(false);
 }
 async function open(){if(!selected)return;setBusy(true);const r=await supabase.rpc('open_government_session',{p_session_id:selected.id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function start(id:string){setBusy(true);const r=await supabase.rpc('start_government_program_report',{p_item_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function decision(id:string){setBusy(true);const r=await supabase.rpc('open_program_vote_from_agenda',{p_item_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function close(){if(!selected)return;setBusy(true);const r=await supabase.rpc('close_government_session',{p_session_id:selected.id});if(r.error)setError(r.error.message);else await load();setBusy(false)}

 return <section className="govSessionLab">
  <StageModuleHeader eyebrow="Этап 11 · Правительство" title="Заседание Правительства" description="Председатель формирует повестку и регламент. Министры представляют программы, члены Правительства регистрируются на заседание и голосуют; принятое решение оформляется постановлением." stats={[{label:"Заседание",value:selected?"№ "+selected.session_no:"Не создано",detail:selected?.status==="open"?"Идёт":selected?.status==="closed"?"Закрыто":"Подготовка повестки"},{label:"Регламент",value:selected?selected.time_limit_minutes+" мин.":"Не задан"}]}/>

  <div className="govSessionTabs">
   <div>{sessions.map(s=><button key={s.id} className={s.id===selected?.id?'active':''} onClick={()=>setSelectedId(s.id)}><b>№ {s.session_no}</b><span>{s.title}</span><em>{s.status==='open'?'идёт':s.status==='closed'?'закрыто':'проект'}</em></button>)}</div>
   {canManage&&<details className="govSessionCreate"><summary>＋ Новое заседание</summary><div><input aria-label="Название заседания" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название"/><label>Общий регламент, мин.<input type="number" min="5" max="240" value={timeLimit} onChange={e=>setTimeLimit(Number(e.target.value)||60)}/></label><button disabled={busy} onClick={()=>void create()}>Создать</button></div></details>}
  </div>

  {selected&&<>
   <div className="govSessionBar"><div><small>ПРЕДСЕДАТЕЛЬСТВУЮЩИЙ</small><b>{name(selected.chair_user_id)}</b><span>{agenda.length} вопросов в повестке</span></div>{canManage&&selected.status==='draft'&&<button className="primary" disabled={busy||agenda.length===0} onClick={()=>void open()}>Открыть заседание</button>}{canManage&&selected.status==='open'&&<button className="primary" disabled={busy||!!current} onClick={()=>void close()}>Закрыть заседание</button>}</div>

   {canManage&&selected.status==='draft'&&<div className="govAgendaBuilder"><select value={programId} onChange={e=>setProgramId(e.target.value)}><option value="">Выберите ГП, готовую к заседанию…</option>{readyPrograms.filter(p=>!agenda.some(i=>i.program_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.title} · {p.responsible_ministry}</option>)}</select><label>Доклад, мин.<input type="number" min="1" max="60" value={reportMinutes} onChange={e=>setReportMinutes(Number(e.target.value)||7)}/></label><button disabled={busy||!programId} onClick={()=>void add()}>Добавить в повестку</button></div>}

   <div className="govAgenda">
    {agenda.length===0?<div className="emptyState">В повестке пока нет государственных программ.</div>:agenda.map(i=>{const p=program(i.program_id),v=vote(i.vote_id);return <article className={'govAgendaItem '+i.status} key={i.id}><div className="govAgendaNo">{String(i.agenda_no).padStart(2,'0')}</div><div><small>{p?.responsible_ministry||'Ответственный исполнитель'}</small><h3>{p?.title||'Государственная программа'}</h3><p>Доклад: {i.report_minutes} мин. · ответственный министр: {name(p?.responsible_minister_id||null)}</p><div className="govAgendaTags"><span>{i.status==='pending'?'Ожидает':i.status==='presenting'?'Доклад':i.status==='decision'?'Решение Правительства':i.status==='completed'?'Рассмотрено':'Снято'}</span>{v&&<span className={v.status==='open'?'live':''}>{v.status==='open'?'● Голосование открыто':v.result_label||'Голосование закрыто'}</span>}</div>{i.result_note&&<blockquote>{i.result_note}</blockquote>}</div>
     {canManage&&selected.status==='open'&&<div className="govAgendaActions">{i.status==='pending'&&<button disabled={busy||!!current} onClick={()=>void start(i.id)}>Начать доклад</button>}{i.status==='presenting'&&<button className="primary" disabled={busy} onClick={()=>void decision(i.id)}>Перейти к решению →</button>}{i.status==='decision'&&<button onClick={()=>onOpenVotes(i.vote_id||undefined)}>Открыть голосование →</button>}</div>}
    </article>})}
   </div>

   <footer className="govSessionRule"><b>Процедура решения</b><p>Если требуется голосование, решение принимается большинством присутствующих при наличии кворума не менее половины состава Правительства; при равенстве голосов решающим является голос председательствующего. Система голосования уже учитывает эту модель.</p></footer>
  </>}
 </section>;
}
