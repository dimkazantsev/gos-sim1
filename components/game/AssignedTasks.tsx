'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {ArrowLeft,CalendarDays,CheckCheck,ClipboardList,Send,UserRoundCheck} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {Member} from './types';
type Task={id:string;game_id:string;assigned_by:string;author_id:string;recipient_id:string;title:string;description:string;due_at:string;requires_confirmation:boolean;status:'open'|'completed'|'confirmed';created_at:string;completed_at:string|null;confirmed_at:string|null};
const dateInputValue=()=>{const date=new Date(Date.now()+86400000);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)};
export default function AssignedTasks({gameId,userId,teacher,members,onBack}:{gameId:string;userId:string;teacher:boolean;members:Member[];onBack:()=>void}){
 const eligible=useMemo(()=>members.filter(m=>m.game_id===gameId&&m.kind!=='observer'&&!m.roster_archived_at),[members,gameId]);
 const [tasks,setTasks]=useState<Task[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [author,setAuthor]=useState(userId),[recipient,setRecipient]=useState(''),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[dueAt,setDueAt]=useState(dateInputValue),[confirmation,setConfirmation]=useState(true);
 const name=(id:string)=>eligible.find(m=>m.user_id===id)?.full_name||'Участник';
 const load=useCallback(async()=>{const r=await supabase.from('game_assigned_tasks').select('id,game_id,assigned_by,author_id,recipient_id,title,description,due_at,requires_confirmation,status,created_at,completed_at,confirmed_at').eq('game_id',gameId).order('created_at',{ascending:false}).limit(200);if(r.error)setError(r.error.message);else{setTasks((r.data||[]) as Task[]);setError('')}setLoading(false)},[gameId]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{setAuthor(userId)},[userId]);
 async function create(event:React.FormEvent){event.preventDefault();if(busy||!recipient||!title.trim()||!description.trim()||!dueAt)return;setBusy(true);setError('');setNotice('');
  try{const r=await supabase.rpc('create_game_assigned_task',{p_game_id:gameId,p_author_id:teacher?author:userId,p_recipient_id:recipient,p_title:title.trim(),p_description:description.trim(),p_due_at:new Date(dueAt).toISOString(),p_requires_confirmation:confirmation});
   if(r.error)throw r.error;setNotice('Поручение назначено. Адресату с подключённым Telegram будет отправлено уведомление.');setTitle('');setDescription('');setRecipient('');await load();
  }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить поручение')}finally{setBusy(false)}
 }
 async function transition(id:string,mode:'complete'|'confirm'){if(busy)return;setBusy(true);setError('');setNotice('');
  try{const r=await supabase.rpc(mode==='complete'?'complete_game_assigned_task':'confirm_game_assigned_task',{p_task_id:id});if(r.error)throw r.error;setNotice(mode==='complete'?'Выполнение отмечено.':'Выполнение подтверждено.');await load()}
  catch(e){setError(e instanceof Error?e.message:'Не удалось обновить поручение')}finally{setBusy(false)}
 }
 return <section className="assignedTaskPage" aria-label="Поручения ГОС.ID">
  <header className="assignedTaskHero"><button type="button" onClick={onBack} className="assignedTaskBack"><ArrowLeft size={18}/> Вернуться в профиль</button><small>ГОС.ID · ПОРУЧЕНИЯ</small><h1>Назначить задачу</h1><p>Постановка, сроки и подтверждение выполнения поручений участниками республики.</p></header>
  {error&&<p role="alert" className="assignedTaskError">{error}</p>}
  {notice&&<p role="status" className="assignedTaskNotice">{notice}</p>}
  <form className="surface assignedTaskForm" onSubmit={e=>void create(e)}>
   <div className="surfaceHead"><div><small>НОВОЕ ПОРУЧЕНИЕ</small><h2>Постановка задачи</h2></div><ClipboardList size={25} aria-hidden="true"/></div>
   <div className="assignedTaskGrid">
    <label>От кого
     <select value={teacher?author:userId} disabled={!teacher} onChange={e=>setAuthor(e.target.value)} aria-label="Автор поручения">
      {eligible.filter(m=>teacher||m.user_id===userId).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name} · {m.role_title||'Участник'}</option>)}
     </select>
    </label>
    <label>Кому
     <select required value={recipient} onChange={e=>setRecipient(e.target.value)} aria-label="Адресат поручения">
      <option value="">Выберите участника</option>
      {eligible.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name} · {m.role_title||'Участник'}</option>)}
     </select>
    </label>
    <label className="assignedTaskWide">Название<input required value={title} maxLength={160} minLength={3} onChange={e=>setTitle(e.target.value)} placeholder="Например: подготовить проект федерального закона"/></label>
    <label className="assignedTaskWide">Описание<textarea required rows={5} maxLength={6000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Что необходимо сделать, ожидаемый результат, материалы и критерии исполнения"/></label>
    <label>Срок исполнения<input required type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value)} min={dateInputValue().slice(0,10)+'T00:00'}/></label>
    <label className="assignedTaskCheck"><input type="checkbox" checked={confirmation} onChange={e=>setConfirmation(e.target.checked)}/><span><b>Требуется подтверждение выполнения</b><small>Адресат отметит завершение; автор или преподаватель подтвердит результат.</small></span></label>
   </div>
   <div className="assignedTaskActions"><span><UserRoundCheck size={16}/> Фактический постановщик фиксируется системой.</span><button className="primary" disabled={busy||!recipient||!title.trim()||!description.trim()} type="submit"><Send size={17}/>{busy?'Сохраняем…':'Назначить задачу'}</button></div>
  </form>
  <section className="surface assignedTaskList"><div className="surfaceHead"><div><small>КОНТРОЛЬ ИСПОЛНЕНИЯ</small><h2>Назначенные поручения</h2></div><strong>{tasks.length}</strong></div>
   {loading?<p>Загружаем поручения…</p>:!tasks.length?<p className="muted">Поручений пока нет. Создайте первое в панели выше.</p>:<div className="assignedTaskCards">{tasks.map(t=><article key={t.id} className={'assignedTaskCard '+t.status}>
    <div className="assignedTaskCardTitle"><h3>{t.title}</h3><span>{t.status==='confirmed'?'✓ Подтверждено':t.status==='completed'?'⏳ На подтверждении':'● В работе'}</span></div>
    <p>{t.description}</p>
    <dl><div><dt>От кого</dt><dd>{name(t.author_id)}</dd></div><div><dt>Кому</dt><dd>{name(t.recipient_id)}</dd></div><div><dt>Назначил</dt><dd>{name(t.assigned_by)}</dd></div><div><dt>Срок</dt><dd><CalendarDays size={14}/> {new Date(t.due_at).toLocaleString('ru-RU',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</dd></div><div><dt>Подтверждение</dt><dd>{t.requires_confirmation?'Обязательно':'Не требуется'}</dd></div></dl>
    {t.status==='open'&&t.recipient_id===userId&&<button type="button" onClick={()=>void transition(t.id,'complete')} disabled={busy}><CheckCheck size={17}/> Отметить выполненным</button>}
    {t.status==='completed'&&(teacher||t.author_id===userId||t.assigned_by===userId)&&<button type="button" onClick={()=>void transition(t.id,'confirm')} disabled={busy}><CheckCheck size={17}/> Подтвердить выполнение</button>}
   </article>)}</div>}
  </section>
 </section>;
}
