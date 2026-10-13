'use client';
import {useCallback,useEffect,useState} from 'react';
import {Copy,KeyRound,RotateCw,ShieldCheck,Trash2} from 'lucide-react';
import {supabase} from '@/lib/supabase';

type Scope='participant'|'group'|'guest';
type InventoryScope=Scope|'teacher';
type CodeRow={id:string;scope:InventoryScope;group_name:string|null;active:boolean;created_at:string};
const LETTERS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(prefix:string){
 const bytes=new Uint8Array(12);
 crypto.getRandomValues(bytes);
 return prefix+'-'+Array.from(bytes,b=>LETTERS[b%LETTERS.length]).join('');
}
const labels:Record<Scope,string>={
 participant:'Приглашение участника',
 group:'Приглашение группы',
 guest:'Приглашение гостя'
};
const inventoryLabels:Record<InventoryScope,string>={...labels,teacher:'Приглашение преподавателя'};
const hints:Record<Scope,string>={
 participant:'Позволяет участнику присоединиться к игре. При входе нужно указать группу.',
 group:'Привязывает нового участника к указанной группе автоматически.',
 guest:'Предоставляет только просмотр разрешённых разделов без участия в решениях.'
};
export default function TeacherAccessCodes({gameId}:{gameId:string}){
 const [currentGameCode,setCurrentGameCode]=useState('');
 const [newGameCode,setNewGameCode]=useState('');
 const [scope,setScope]=useState<Scope>('participant');
 const [groupName,setGroupName]=useState('');
 const [newInvite,setNewInvite]=useState('');
 const [created,setCreated]=useState('');
 const [createdKind,setCreatedKind]=useState<Scope>('participant');
 const [rows,setRows]=useState<CodeRow[]>([]);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{
  const r=await supabase.rpc('teacher_access_code_list',{p_game_id:gameId});
  if(r.error)throw r.error;
  setRows(Array.isArray(r.data)?r.data as CodeRow[]:[]);
 },[gameId]);
 useEffect(()=>{
  let alive=true;
  setCurrentGameCode('');setNewGameCode('');setCreated('');setRows([]);setNotice('');
  async function load(){
   const [r,c]=await Promise.all([
    supabase.rpc('teacher_access_code_list',{p_game_id:gameId}),
    supabase.from('games').select('game_code').eq('id',gameId).single()
   ]);
   if(!alive)return;
   if(c.error||r.error){setNotice('Не удалось загрузить коды доступа: '+(c.error?.message||r.error?.message));return;}
   setCurrentGameCode(c.data?.game_code||'');
   setRows(Array.isArray(r.data)?r.data as CodeRow[]:[]);
  }
  void load();return()=>{alive=false};
 },[gameId]);
 async function copy(value:string){
  try{await navigator.clipboard.writeText(value);setNotice('Код скопирован. Передавайте его только адресатам.');}
  catch{setNotice('Копирование недоступно. Выделите код и скопируйте вручную.')}
 }
 async function saveGameCode(){
  const code=newGameCode.trim().toUpperCase();
  if(busy||!code)return;
  if(!window.confirm('Изменить код игры? При следующем входе потребуется новый код. Участники и их данные сохранятся.'))return;
  setBusy(true);setNotice('');
  try{
   const r=await supabase.rpc('teacher_update_game_code',{p_game_id:gameId,p_new_code:code});
   if(r.error)throw r.error;
   setCurrentGameCode(String(r.data));setNewGameCode('');
   setNotice('Код игры изменён. Сообщите его участникам.');
  }catch(e){setNotice('Код игры не изменён: '+(e instanceof Error?e.message:'Ошибка сервера'))}
  finally{setBusy(false)}
 }
 async function addCode(){
  const secret=newInvite.trim();
  if(busy||secret.length<(scope==='guest'?6:8)||scope==='group'&&!groupName.trim())return;
  setBusy(true);setNotice('');setCreated('');
  try{
   const r=scope==='guest'
    ?await supabase.rpc('create_observer_invite',{p_game_id:gameId,p_code:secret})
    :await supabase.rpc('teacher_create_access_code',{
      p_game_id:gameId,p_code:secret,p_scope:scope,
      p_group_name:scope==='group'?groupName.trim():null
     });
   if(r.error)throw r.error;
   setCreated(secret);setCreatedKind(scope);setNewInvite('');
   await refresh();
   setNotice('Приглашение создано. Код показан один раз, в базе хранится только его хеш.');
  }catch(e){setNotice('Не удалось создать приглашение: '+(e instanceof Error?e.message:'Ошибка сервера'))}
  finally{setBusy(false)}
 }
 async function revoke(row:CodeRow){
  if(busy||!row.active||!window.confirm('Отключить приглашение? Новые подключения по нему станут недоступны. Ранее присоединившиеся сохранят доступ.'))return;
  setBusy(true);setNotice('');
  try{
   const r=await supabase.rpc('teacher_revoke_access_code',{p_game_id:gameId,p_invite_id:row.id});
   if(r.error)throw r.error;
   await refresh();setNotice('Приглашение отключено для новых подключений.');
  }catch(e){setNotice('Не удалось отключить приглашение: '+(e instanceof Error?e.message:'Ошибка сервера'))}
  finally{setBusy(false)}
 }
 async function remove(row:CodeRow){
  if(busy||row.active||!window.confirm('Удалить отключённое приглашение из реестра? Это не удалит участников или результаты игры.'))return;
  setBusy(true);setNotice('');
  try{
   const r=await supabase.rpc('teacher_delete_access_code',{p_game_id:gameId,p_invite_id:row.id});
   if(r.error)throw r.error;
   await refresh();setNotice('Отключённое приглашение удалено.');
  }catch(e){setNotice('Не удалось удалить приглашение: '+(e instanceof Error?e.message:'Ошибка сервера'))}
  finally{setBusy(false)}
 }
 return <section className="teacherAccessCodes" aria-label="Коды доступа к игре">
  <div className="teacherAccessHead"><KeyRound size={20} aria-hidden="true"/><div><h3>Доступ к игре</h3><p>Код игры и приглашения для участников, групп и гостей. Приглашение преподавателя также указано в списке и защищено от отключения. Личный пароль задаётся в профиле.</p></div></div>
  <div className="teacherCodeGrid">
   <div className="teacherCodeEditor">
    <h4>Код игры</h4>
    <p className="teacherAccessExplanation">Определяет конкретную игру. Для первого входа вместе с ним требуется приглашение; для повторного входа — личный пароль.</p>
    <label>Действующий код игры
     <span className="teacherCodeValue">{currentGameCode||'Загрузка…'}</span>
    </label>
    <button type="button" disabled={busy||!currentGameCode} onClick={()=>void copy(currentGameCode)}><Copy size={16}/> Копировать</button>
    <label>Новый код игры
     <input autoComplete="off" maxLength={32} value={newGameCode} onChange={e=>setNewGameCode(e.target.value.toUpperCase())} placeholder="Например, GOS-2026"/>
    </label>
    <div className="teacherCodeActions">
     <button type="button" disabled={busy} onClick={()=>setNewGameCode(generateCode('GOS'))}><RotateCw size={16}/> Сгенерировать</button>
     <button type="button" disabled={busy||!/^[A-Z0-9-]{4,32}$/.test(newGameCode)} onClick={()=>void saveGameCode()}>Сохранить</button>
    </div>
   </div>
   <div className="teacherCodeEditor">
    <h4>Новое приглашение</h4>
    <label>Кому предназначено
     <select value={scope} onChange={e=>{setScope(e.target.value as Scope);setNewInvite('');setCreated('')}}>
      <option value="participant">{labels.participant}</option>
      <option value="group">{labels.group}</option>
      <option value="guest">{labels.guest}</option>
     </select>
    </label>
    <p className="teacherAccessExplanation">{hints[scope]}</p>
    {scope==='group'&&<label>Название группы
     <input autoComplete="off" maxLength={80} value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Например, 8.414"/>
    </label>}
    <label>Код приглашения
     <input autoComplete="off" value={newInvite} minLength={scope==='guest'?6:8} maxLength={80} onChange={e=>setNewInvite(e.target.value)} placeholder={scope==='guest'?'Не менее 6 символов':'Не менее 8 символов'}/>
    </label>
    <div className="teacherCodeActions">
     <button type="button" disabled={busy} onClick={()=>setNewInvite(generateCode(scope==='group'?'GRP':scope==='guest'?'GST':'STD'))}><RotateCw size={16}/> Сгенерировать</button>
     <button type="button" disabled={busy||newInvite.trim().length<(scope==='guest'?6:8)||scope==='group'&&!groupName.trim()} onClick={()=>void addCode()}>Создать приглашение</button>
    </div>
   </div>
  </div>
  {created&&<div className="teacherCodeCreated" role="status"><ShieldCheck size={18}/><div><b>Сохраните: {labels[createdKind].toLowerCase()}</b> <code>{created}</code><p>Повторно посмотреть секретное значение нельзя.</p></div><button type="button" onClick={()=>void copy(created)}><Copy size={16}/> Копировать</button></div>}
  <div className="teacherCodeRows">
   <div className="teacherAccessListHead"><h4>Все приглашения ({rows.length})</h4><button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setNotice(String(e)))}><RotateCw size={15}/> Обновить</button></div>
   {rows.length===0&&<p>Приглашений пока нет. Коды, созданные при запуске игры, также отображаются здесь без раскрытия секретного значения.</p>}
   {rows.map(row=><div key={row.id} className="teacherCodeRow">
    <div><b>{inventoryLabels[row.scope]}{row.scope==='group'&&row.group_name?': '+row.group_name:''}</b><small>{row.active?'Активно':'Отключено'} · {new Date(row.created_at).toLocaleDateString('ru-RU')} · Код защищён хешированием</small></div>
    {row.scope==='teacher'?<span className="teacherCodeProtected">Защищённый доступ</span>:row.active?<button type="button" disabled={busy} onClick={()=>void revoke(row)}>Отключить</button>:
     <button type="button" disabled={busy} onClick={()=>void remove(row)}><Trash2 size={15}/> Удалить</button>}
   </div>)}
  </div>
  {notice&&<p className="teacherCodeNotice" role="status">{notice}</p>}
 </section>;
}
