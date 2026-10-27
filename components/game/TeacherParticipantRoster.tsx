'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {RefreshCw,ShieldAlert,Trash2,UserX} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';

type Entry={user_id:string;full_name:string;kind:string;role_title:string|null;joined_at:string;roster_archived_at:string|null;access_action:'excluded'|'profile_erased'|null;blocked_at:string|null;last_seen_at:string|null};
type Action='exclude'|'erase_profile';
export default function TeacherParticipantRoster({g}:{g:ReturnTypeRepublic}){
 const gameId=g.game?.id;
 const [entries,setEntries]=useState<Entry[]>([]);
 const [search,setSearch]=useState('');
 const [filter,setFilter]=useState('current');
 const [status,setStatus]=useState('');
 const [loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false);
 const [selected,setSelected]=useState<{entry:Entry;action:Action}|null>(null);
 const [confirmation,setConfirmation]=useState('');
 const [dialogError,setDialogError]=useState('');
 const dialogRef=useRef<HTMLDialogElement>(null);
 const confirmationRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{
  const dialog=dialogRef.current;
  if(!selected||!dialog)return;
  if(!dialog.open)dialog.showModal();
  const frame=requestAnimationFrame(()=>confirmationRef.current?.focus());
  return()=>{cancelAnimationFrame(frame);if(dialog.open)dialog.close()};
 },[selected]);
 function openDialog(entry:Entry,action:Action){
  setSelected({entry,action});setConfirmation('');setDialogError('');
 }
 function closeDialog(){
  if(busy)return;
  setSelected(null);setConfirmation('');setDialogError('');
 }
 const refresh=useCallback(async()=>{
  if(!gameId||!g.teacher)return;
  setLoading(true);
  const result=await supabase.rpc('teacher_participant_roster',{p_game_id:gameId});
  if(result.error)setStatus('Не удалось получить список: '+userError(result.error));
  else {setEntries((result.data||[]) as Entry[]);setStatus('');}
  setLoading(false);
 },[gameId,g.teacher]);
 useEffect(()=>{void refresh();},[refresh]);
 const rows=useMemo(()=>entries.filter(e=>
  (filter==='all'||filter==='current'&&e.access_action!=='profile_erased'||filter==='removed'&&e.access_action==='profile_erased'||filter==='blocked'&&e.access_action==='excluded'||filter==='guest'&&e.kind==='observer'||filter===e.kind&&e.access_action!=='profile_erased')
  &&[e.full_name,e.role_title,e.user_id].some(v=>String(v||'').toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))
 ).sort((a,b)=>a.full_name.localeCompare(b.full_name,'ru')),[entries,filter,search]);
 async function submit(){
  if(!selected||!gameId||busy||confirmation!==selected.entry.full_name)return;
  setBusy(true);setStatus('');setDialogError('');
  try{
   const {error}=await supabase.rpc('teacher_manage_participant',{
    p_game_id:gameId,p_user_id:selected.entry.user_id,p_action:selected.action,p_confirm_name:confirmation
   });
   if(error){setDialogError('Операция не выполнена: '+userError(error));return;}
   setSelected(null);setConfirmation('');
   await refresh();
   setStatus('Изменения сохранены. Для участников с действующей сессией доступ прекращается при следующем запросе, защищённом серверной проверкой.');
  }catch(error){
   setDialogError('Не удалось выполнить операцию: '+userError(error));
  }finally{setBusy(false);}
 }
 if(!g.teacher||!gameId)return null;
 return <section className="surface teacherParticipantRoster" aria-label="Участники и доступ">
  <div className="surfaceHead teacherRosterHead"><div><small>ДОСТУП К ИГРЕ</small><h2>Участники и доступ</h2>
  <p>Все зарегистрированные пользователи текущей игры, включая исключённых. Исключение сохраняет историю; очистка профиля обезличивает запись, но не удаляет общую учётную запись для входа или исторические документы.</p></div><b className="teacherRosterCount">{entries.filter(e=>e.access_action!=='profile_erased').length}</b></div>
  <div className="teacherRosterToolbar">
   <input type="search" aria-label="Поиск участника" placeholder="ФИО, должность, идентификатор" value={search} onChange={e=>setSearch(e.target.value)}/>
   <select aria-label="Фильтр роли" value={filter} onChange={e=>setFilter(e.target.value)}>
    <option value="current">Текущий реестр</option><option value="all">Все записи</option><option value="removed">Удалённые записи</option><option value="student">Участники</option><option value="guest">Гости</option><option value="teacher">Преподаватели</option><option value="blocked">Исключённые</option>
   </select>
   <button type="button" className="secondary" disabled={loading||busy} onClick={()=>void refresh()}><RefreshCw size={16}/> Обновить</button>
  </div>
  {status&&<p role="status">{status}</p>}
  {loading&&<p role="status">Обновление списка…</p>}
  <div className="teacherRosterList">
   {rows.map(e=>{const protectedUser=e.kind==='teacher'||e.user_id===g.me?.user_id;return <article key={e.user_id} className="teacherRosterEntry">
    <div className="teacherRosterIdentity"><b>{e.full_name}</b><div><small>{e.kind==='teacher'?'Преподаватель':e.kind==='observer'||e.kind==='guest'?'Гость':'Участник'} · {e.role_title||'Без должности'}</small></div>
    <small>{e.access_action?'Доступ закрыт':e.last_seen_at&&Date.now()-new Date(e.last_seen_at).getTime()<90000?'В сети':'Не в сети'}
    {' · '}Последняя активность: {e.last_seen_at?new Date(e.last_seen_at).toLocaleString('ru-RU'):'Не зафиксирована'}</small></div>
    {!protectedUser&&<div className="teacherRosterActions">
     {!e.access_action&&<button type="button" className="secondary" disabled={busy} onClick={()=>openDialog(e,'exclude')}><UserX size={16}/> Исключить</button>}
     {e.access_action!=='profile_erased'&&<button type="button" className="danger" disabled={busy} onClick={()=>openDialog(e,'erase_profile')}><Trash2 size={16}/> Очистить профиль и доступ</button>}
    </div>}
   </article>})}
   {!loading&&rows.length===0&&<p>Совпадений нет.</p>}
  </div>
  {selected&&<dialog ref={dialogRef} aria-labelledby="teacher-roster-dialog-title" aria-describedby="teacher-roster-dialog-copy" className="teacherRosterDialog" onCancel={event=>{event.preventDefault();closeDialog()}}>
   <h3 id="teacher-roster-dialog-title"><ShieldAlert size={20}/> {selected.action==='exclude'?'Исключить участника':'Очистить профиль участника'}</h3>
   <p id="teacher-roster-dialog-copy"><b>{selected.entry.full_name}</b>. {selected.action==='exclude'?'Доступ к этой игре будет заблокирован; история и профиль сохранятся.':'Доступ будет заблокирован, имя и данные игрового профиля очищены. Исторические игровые записи и учётная запись для входа сохранятся.'}</p>
   <p className="teacherRosterTargetId">Идентификатор выбранной записи: <code>{selected.entry.user_id}</code></p>
   <label className="teacherRosterConfirm">Введите ФИО в точности: {selected.entry.full_name}<input ref={confirmationRef} autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
   {dialogError&&<p className="teacherRosterDialogError" role="alert">{dialogError}</p>}
   <div className="teacherRosterDialogActions">
    <button className="danger" type="button" disabled={busy||confirmation!==selected.entry.full_name} onClick={()=>void submit()}>{busy?'Выполняется…':'Подтвердить'}</button>
    <button type="button" disabled={busy} onClick={closeDialog}>Отмена</button>
   </div>
  </dialog>}
 </section>;
}
