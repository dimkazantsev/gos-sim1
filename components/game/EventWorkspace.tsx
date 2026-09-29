'use client';
import {useEffect,useState} from 'react';
import {CalendarDays,CheckCircle2,UsersRound,Vote as VoteIcon} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
type CaseRow={id:string;game_id:string;case_key:string;title:string;situation:string;category:string;seriousness:'serious'|'light';audience:'single'|'group'|'all';allowed_roles:string[];status:string;source_url:string|null};
type Assignment={id:string;case_id:string;game_id:string;recipient_id:string;status:string};
type Decision={id:string;case_id:string;actor_id:string;choice:string};
export default function EventWorkspace({g,readOnly=false}:{g:ReturnTypeRepublic;readOnly?:boolean}){
 const {game,me,members,teacher}=g;
 const [cases,setCases]=useState<CaseRow[]>([]);
 const [assignments,setAssignments]=useState<Assignment[]>([]);
 const [decisions,setDecisions]=useState<Decision[]>([]);
 const [title,setTitle]=useState('');
 const [situation,setSituation]=useState('');
 const [category,setCategory]=useState('Государственное управление');
 const [roleFilter,setRoleFilter]=useState('');
 const [seriousness,setSeriousness]=useState<'serious'|'light'>('serious');
 const [audience,setAudience]=useState<'single'|'group'|'all'>('single');
 const [selected,setSelected]=useState<string[]>([]);
 const [saving,setSaving]=useState(false);
 const [notice,setNotice]=useState('');
 const [busyId,setBusyId]=useState<string|null>(null);
 async function reload(){
  if(!game||!me)return;
  const [a,b,c]=await Promise.all([
   supabase.from('event_cases').select('*').eq('game_id',game.id).order('created_at',{ascending:false}).limit(200),
   supabase.from('event_assignments').select('*').eq('game_id',game.id),
   supabase.from('event_decisions').select('*').eq('game_id',game.id)
  ]);
  if(a.error){setNotice(a.error.message);return}
  setCases((a.data||[]) as CaseRow[]);
  if(!b.error)setAssignments((b.data||[]) as Assignment[]);
  if(!c.error)setDecisions((c.data||[]) as Decision[]);
 }
 useEffect(()=>{
  if(!game?.id||!me?.user_id)return;
  void reload();
  const channel=supabase.channel('event-workspace:'+game.id+':'+me.user_id)
   .on('postgres_changes',{event:'*',schema:'public',table:'event_assignments',filter:'game_id=eq.'+game.id},()=>void reload())
   .on('postgres_changes',{event:'*',schema:'public',table:'event_decisions',filter:'game_id=eq.'+game.id},()=>void reload())
   .subscribe();
  return()=>{void supabase.removeChannel(channel)};
 },[game?.id,me?.user_id]);
 const students=members.filter(m=>m.kind==='student');
 const roles=[...new Set(students.map(m=>m.role_title?.trim()).filter((r):r is string=>!!r))].sort((a,b)=>a.localeCompare(b,'ru'));
 const recipients=roleFilter&&audience!=='all'?students.filter(m=>m.role_title===roleFilter):students;
 const mine=assignments.filter(a=>a.recipient_id===me?.user_id);
 const pending=mine.filter(a=>a.status==='pending');
 const eligible=audience==='all'?students.map(m=>m.user_id):selected;
 const canSend=title.trim().length>=6&&situation.trim().length>=20&&
  (audience==='all'?students.length>0:audience==='single'?selected.length===1:selected.length>=2&&selected.length<=3);
 async function create(){
  if(!game||!me||!teacher||saving||!canSend||readOnly)return;
  setSaving(true);setNotice('');
  const key='manual-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  const r=await supabase.from('event_cases').insert({
   game_id:game.id,case_key:key,title:title.trim(),situation:situation.trim(),category,
   seriousness,audience,allowed_roles:roleFilter?[roleFilter]:[],status:'ready',created_by:me.user_id
  }).select('id').single();
  if(r.error||!r.data){setNotice(r.error?.message||'Не удалось создать событие.');setSaving(false);return}
  const a=await supabase.from('event_assignments').insert(eligible.map(recipient_id=>({
   game_id:game.id,case_id:r.data.id,recipient_id,created_by:me.user_id
  })));
  if(a.error){await supabase.from('event_cases').delete().eq('id',r.data.id);setNotice(a.error.message)}
  else{setNotice('Событие направлено участникам: '+eligible.length);setTitle('');setSituation('');setSelected([]);await reload()}
  setSaving(false);
 }
 async function answer(assignment:Assignment,choice:'accept'|'reject'){
  if(busyId||readOnly)return;
  setBusyId(assignment.id);setNotice('');
  const r=await supabase.rpc('submit_event_decision',{p_assignment_id:assignment.id,p_choice:choice,p_rationale:null});
  if(r.error)setNotice(r.error.message);else await reload();
  setBusyId(null);
 }
 if(!game||!me)return null;
 return <section className="eventWorkspace" aria-label="Event — ситуационные решения">
  <header><div><small>EVENT · ИГРОВЫЕ СИТУАЦИИ</small><h2>События и решения</h2><p>Индивидуальные задания, совместные решения 2–3 участников и общее голосование. Библиотека из 500 кейсов и модель эффектов будут подключены после проверки содержания.</p></div><span><CalendarDays size={17} aria-hidden="true"/>{teacher?cases.length+' событий':pending.length+' ожидают решения'}</span></header>
  {teacher&&<div className="eventComposerPanel">
   <h3>Направить новое событие</h3>
   <div className="eventEditorGrid">
    <label>Название<input value={title} maxLength={180} onChange={e=>setTitle(e.target.value)} placeholder="Краткий заголовок ситуации"/></label>
    <label>Сфера<select value={category} onChange={e=>setCategory(e.target.value)}>{['Государственное управление','Экономика','Международные отношения','Образование','Здравоохранение','Экология','Муниципальное управление','Культура и протокол','Социальная политика'].map(s=><option key={s}>{s}</option>)}</select></label>
    <label>Тип<select value={seriousness} onChange={e=>setSeriousness(e.target.value as 'serious'|'light')}><option value="serious">Серьёзное</option><option value="light">Повседневное / необычное</option></select></label>
    <label>Роль получателя<select value={roleFilter} onChange={e=>{setRoleFilter(e.target.value);setSelected([])}}><option value="">Любая должность</option>{roles.map(role=><option key={role} value={role}>{role}</option>)}</select></label>
    <label>Формат<select value={audience} onChange={e=>{setAudience(e.target.value as 'single'|'group'|'all');setSelected([])}}><option value="single">Одному участнику</option><option value="group">Совместно, 2–3 человека</option><option value="all">Всем студентам</option></select></label>
    <label className="eventWide">Описание ситуации<textarea rows={4} value={situation} maxLength={5000} onChange={e=>setSituation(e.target.value)} placeholder="Какое решение нужно принять или отклонить?"/></label>
   </div>
   {audience!=='all'&&<div className="eventRecipients"><strong>Получатели · {selected.length}/{audience==='single'?1:3}</strong><div>{recipients.map(m=><label key={m.user_id}><input type="checkbox" checked={selected.includes(m.user_id)} disabled={!selected.includes(m.user_id)&&selected.length>=(audience==='single'?1:3)} onChange={e=>setSelected(old=>e.target.checked?[...old,m.user_id]:old.filter(x=>x!==m.user_id))}/>{m.full_name}<small>{m.role_title||'Студент'}</small></label>)}</div></div>}
   <footer><span>{audience==='all'?'Получатели: вся аудитория':'Выбрано: '+selected.length}</span><button type="button" onClick={()=>void create()} disabled={!canSend||saving||readOnly}>{saving?'Отправка…':'Назначить событие'}</button></footer>
  </div>}
  <div className="eventList"><h3>{teacher?'Назначенные ситуации':'Мои события'}</h3>
   {(teacher?cases:cases.filter(c=>mine.some(a=>a.case_id===c.id))).length===0?<div className="journalEmpty">Назначенных ситуаций пока нет.</div>:
   (teacher?cases:cases.filter(c=>mine.some(a=>a.case_id===c.id))).map(c=>{
    const assigned=assignments.filter(a=>a.case_id===c.id),responded=decisions.filter(d=>d.case_id===c.id);
    const my=assigned.find(a=>a.recipient_id===me.user_id);
    return <article key={c.id} className="eventCaseCard">
     <div className="eventCaseTop"><span>{c.category}</span><span>{c.seriousness==='serious'?'Серьёзная':'Повседневная'} · {c.audience==='all'?'Все':c.audience==='group'?'Совместно':'Личная'}</span></div>
     <h4>{c.title}</h4><p>{c.situation}</p>
     <div className="eventCaseFooter"><span><UsersRound size={15} aria-hidden="true"/>{assigned.length} назначено</span><span><CheckCircle2 size={15} aria-hidden="true"/>{responded.length} ответили</span>
      {my?.status==='pending'&&!teacher?<div className="eventDecisionButtons"><button disabled={!!busyId||readOnly} onClick={()=>void answer(my,'reject')}>Отклонить</button><button disabled={!!busyId||readOnly} onClick={()=>void answer(my,'accept')}>Принять</button></div>:my&&!teacher?<span><VoteIcon size={14}/>Ответ учтён: {my.status==='accepted'?'Принято':'Отклонено'}</span>:null}
     </div>
    </article>;
   })}</div>
  {notice&&<p className="eventNotice" role="status">{notice}</p>}
 </section>;
}
