'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Copy,Link2,RefreshCw,ShieldAlert,Trash2,UserX} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';

type Entry={user_id:string;full_name:string;kind:string;role_title:string|null;joined_at:string;roster_archived_at:string|null;access_action:'excluded'|'profile_erased'|null;blocked_at:string|null;last_seen_at:string|null};
type Action='exclude'|'erase_profile'|'restore'|'reentry_link';
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
 const [reentryName,setReentryName]=useState(''),[reentryGroup,setReentryGroup]=useState(''),[reentryUrl,setReentryUrl]=useState('');
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
  setSelected({entry,action});setConfirmation('');setDialogError('');setReentryUrl('');
  setReentryName(entry.full_name==='Удалённый участник'?'':entry.full_name);setReentryGroup('');
 }
 function closeDialog(){
  if(busy)return;
  setSelected(null);setConfirmation('');setDialogError('');setReentryUrl('');
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
   if(selected.action==='reentry_link'){
    const {data,error}=await supabase.rpc('teacher_issue_participant_reentry',{
     p_game_id:gameId,p_former_user_id:selected.entry.user_id,
     p_full_name:reentryName.trim(),p_group_name:reentryGroup.trim()
    });
    if(error)throw error;
    if(typeof data!=='string'||!/^[a-f0-9]{48}$/.test(data))throw new Error('Сервер не создал ссылку.');
    const base=window.location.hostname==='dimkazantsev.github.io'?'/gos-sim1/':'/';
    const link=new URL(base,window.location.origin);
    link.hash='reentry='+data;
    setReentryUrl(link.toString());
    setStatus('Персональная ссылка создана. Отправьте её только выбранному участнику.');
    return;
   }
   const {error}=await supabase.rpc('teacher_manage_participant',{
    p_game_id:gameId,p_user_id:selected.entry.user_id,p_action:selected.action,p_confirm_name:confirmation
   });
   if(error){setDialogError('Операция не выполнена: '+userError(error));return;}
   setSelected(null);setConfirmation('');
   await refresh();
   setStatus(selected.action==='restore'
    ?'Доступ восстановлен. Участник может войти под своей прежней учётной записью. Если профиль был очищен, его потребуется заполнить заново.'
    :'Изменения сохранены. Для участников с действующей сессией доступ прекращается при следующем запросе, защищённом серверной проверкой.');
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
     {e.access_action&&e.kind==='student'&&<button type="button" className="secondary" disabled={busy} onClick={()=>openDialog(e,'reentry_link')}><Link2 size={16}/> Персональная ссылка</button>}
     {e.access_action&&<button type="button" className="secondary" disabled={busy} onClick={()=>openDialog(e,'restore')}><RefreshCw size={16}/> Восстановить доступ</button>}
     {e.access_action!=='profile_erased'&&<button type="button" className="danger" disabled={busy} onClick={()=>openDialog(e,'erase_profile')}><Trash2 size={16}/> Очистить профиль и доступ</button>}
    </div>}
   </article>})}
   {!loading&&rows.length===0&&<p>Совпадений нет.</p>}
  </div>
  {selected&&<dialog ref={dialogRef} aria-labelledby="teacher-roster-dialog-title" aria-describedby="teacher-roster-dialog-copy" className="teacherRosterDialog" onCancel={event=>{event.preventDefault();closeDialog()}}>
   <h3 id="teacher-roster-dialog-title"><ShieldAlert size={20}/> {selected.action==='exclude'?'Исключить участника':selected.action==='restore'?'Восстановить доступ':selected.action==='reentry_link'?'Персональная ссылка восстановления':'Очистить профиль участника'}</h3>
   <p id="teacher-roster-dialog-copy"><b>{selected.entry.full_name}</b>. {selected.action==='exclude'
    ?'Доступ к этой игре будет заблокирован; история и профиль сохранятся.'
    :selected.action==='restore'
     ?'Прежней учётной записи будет вновь разрешён вход в эту игру. Удалённые персональные сведения не восстановятся автоматически; игровые результаты и история останутся без изменений.'
     :selected.action==='reentry_link'
      ?'Ссылка на 24 часа создана строго для выбранной исключённой записи. При утрате прежней сессии участник получит новый чистый профиль, а старые оценки и протоколы останутся в архиве.'
      :'Доступ будет заблокирован, имя и данные игрового профиля очищены. Исторические игровые записи и учётная запись для входа сохранятся.'}</p>
   <p className="teacherRosterTargetId">Идентификатор выбранной записи: <code>{selected.entry.user_id}</code></p>
   <label className="teacherRosterConfirm">Введите ФИО в точности: {selected.entry.full_name}<input ref={confirmationRef} autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
   {selected.action==='reentry_link'&&<div className="teacherReentryFields">
    <label>Фамилия, имя и отчество участника
     <input autoComplete="off" maxLength={200} value={reentryName} disabled={busy||!!reentryUrl} onChange={e=>setReentryName(e.target.value)} placeholder="Иванова Анна Сергеевна"/>
    </label>
    <label>Учебная группа
     <input autoComplete="off" maxLength={120} value={reentryGroup} disabled={busy||!!reentryUrl} onChange={e=>setReentryGroup(e.target.value)} placeholder="8.414"/>
    </label>
   </div>}
   {reentryUrl&&<div className="teacherReentryLinkResult">
    <b>Ссылка для одного участника (24 часа)</b>
    <input aria-label="Персональная ссылка восстановления" readOnly value={reentryUrl} onFocus={e=>e.target.select()}/>
    <button type="button" className="primary" onClick={()=>void navigator.clipboard.writeText(reentryUrl).then(()=>setStatus('Ссылка скопирована. Отправьте её лично участнику.'),()=>setDialogError('Выделите ссылку и скопируйте вручную.'))}><Copy size={16}/> Копировать ссылку</button>
    <small>Не публикуйте ссылку в общем чате: первый открывший её получит доступ к игре.</small>
   </div>}
   {dialogError&&<p className="teacherRosterDialogError" role="alert">{dialogError}</p>
   <div className="teacherRosterDialogActions">
    {!reentryUrl&&<button className={selected.action==='restore'||selected.action==='reentry_link'?'primary':'danger'} type="button" disabled={busy||confirmation!==selected.entry.full_name||selected.action==='reentry_link'&&(reentryName.trim().length<5||!reentryGroup.trim())} onClick={()=>void submit()}>{busy?'Выполняется…':selected.action==='restore'?'Восстановить доступ':selected.action==='reentry_link'?'Создать ссылку':'Подтвердить'}</button>
    <button type="button" disabled={busy} onClick={closeDialog}>Отмена</button>
   </div>
  </dialog>}
 </section>;
}
