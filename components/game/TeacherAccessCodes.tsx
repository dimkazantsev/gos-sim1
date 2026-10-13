'use client';
import {useEffect,useState} from 'react';
import {Copy,KeyRound,RotateCw,ShieldCheck} from 'lucide-react';
import {supabase} from '@/lib/supabase';

type CodeRow={id:string;scope:'participant'|'group';group_name:string|null;active:boolean;created_at:string};
const LETTERS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(prefix:string){
 const bytes=new Uint8Array(12);
 crypto.getRandomValues(bytes);
 return prefix+'-'+Array.from(bytes,b=>LETTERS[b%LETTERS.length]).join('');
}
export default function TeacherAccessCodes({gameId}:{gameId:string}){
 const [currentGameCode,setCurrentGameCode]=useState('');
 const [newGameCode,setNewGameCode]=useState('');
 const [scope,setScope]=useState<'participant'|'group'>('participant');
 const [groupName,setGroupName]=useState('');
 const [newInvite,setNewInvite]=useState('');
 const [created,setCreated]=useState('');
 const [rows,setRows]=useState<CodeRow[]>([]);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 useEffect(()=>{setCurrentGameCode('');setNewGameCode('');setCreated('');},[gameId]);
 useEffect(()=>{
  let alive=true;
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
 async function refresh(){
  const r=await supabase.rpc('teacher_access_code_list',{p_game_id:gameId});
  if(r.error)throw r.error;
  setRows(Array.isArray(r.data)?r.data as CodeRow[]:[]);
 }
 async function copy(value:string){
  try{await navigator.clipboard.writeText(value);setNotice('Код скопирован. Передавайте его только адресатам.');}
  catch{setNotice('Автоматическое копирование недоступно. Выделите код и скопируйте вручную.')}
 }
 async function saveGameCode(){
  const code=newGameCode.trim().toUpperCase();
  if(busy||!code)return;
  if(!window.confirm('Смена кода игры потребует использовать новый код при следующем входе. Существующие игровые данные сохранятся. Продолжить?'))return;
  setBusy(true);setNotice('');
  try{
   const r=await supabase.rpc('teacher_update_game_code',{p_game_id:gameId,p_new_code:code});
   if(r.error)throw r.error;
   setCurrentGameCode(String(r.data));setNewGameCode('');
   setNotice('Код игры изменён. Сообщите новый код участникам.');
  }catch(e){setNotice('Код игры не изменён: '+(e instanceof Error?e.message:'Ошибка сервера'))}
  finally{setBusy(false)}
 }
 async function addCode(){
  if(busy||newInvite.trim().length<8||scope==='group'&&!groupName.trim())return;
  setBusy(true);setNotice('');
  try{
   const r=await supabase.rpc('teacher_create_access_code',{
    p_game_id:gameId,p_code:newInvite.trim(),p_scope:scope,
    p_group_name:scope==='group'?groupName.trim():null
   });
   if(r.error)throw r.error;
   setCreated(newInvite.trim());setNewInvite('');
   await refresh();
   setNotice('Код создан. Открытый текст показан только сейчас; в БД хранится его хеш.');
  }catch(e){setNotice('Код не создан: '+(e instanceof Error?e.message:'Ошибка сервера'))}
  finally{setBusy(false)}
 }
 async function revoke(row:CodeRow){
  if(busy||!row.active||!window.confirm('Отключить этот код для новых подключений? Уже присоединившиеся участники сохранят доступ.'))return;
  setBusy(true);setNotice('');
  try{const r=await supabase.rpc('teacher_revoke_access_code',{p_game_id:gameId,p_invite_id:row.id});if(r.error)throw r.error;await refresh();setNotice('Код отключён для новых входов.');}
  catch(e){setNotice('Не удалось отключить код: '+(e instanceof Error?e.message:'Ошибка сервера'))}
  finally{setBusy(false)}
 }
 return <section className="teacherAccessCodes" aria-label="Коды доступа к игре">
  <div className="teacherAccessHead"><KeyRound size={20} aria-hidden="true"/><div><h3>Коды доступа</h3><p>Общий код участников, код группы и код игры. Гостевой код настраивается ниже отдельно.</p></div></div>
  <div className="teacherCodeGrid">
   <div className="teacherCodeEditor">
    <label>Действующий код игры
     <span className="teacherCodeValue">{currentGameCode}</span>
    </label>
    <button type="button" disabled={busy} onClick={()=>void copy(currentGameCode)}><Copy size={16}/> Копировать</button>
    <label>Новый код игры
     <input autoComplete="off" maxLength={32} value={newGameCode} onChange={e=>setNewGameCode(e.target.value.toUpperCase())} placeholder="GOS-2026"/>
    </label>
    <div className="teacherCodeActions">
     <button type="button" disabled={busy} onClick={()=>setNewGameCode(generateCode('GOS').slice(0,32))}><RotateCw size={16}/> Сгенерировать</button>
     <button type="button" disabled={busy||!/^[A-Z0-9-]{4,32}$/.test(newGameCode)} onClick={()=>void saveGameCode()}>Сохранить код игры</button>
    </div>
   </div>
   <div className="teacherCodeEditor">
    <label>Тип пригласительного кода
     <select value={scope} onChange={e=>{setScope(e.target.value as 'participant'|'group');setCreated('')}}>
      <option value="participant">Общий код участников</option>
      <option value="group">Код конкретной группы</option>
     </select>
    </label>
    {scope==='group'&&<label>Название группы
     <input autoComplete="off" maxLength={80} value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Например, 1241"/>
    </label>}
    <label>Новый код
     <input autoComplete="off" value={newInvite} minLength={8} maxLength={80} onChange={e=>setNewInvite(e.target.value)} placeholder="Не менее 8 символов"/>
    </label>
    <div className="teacherCodeActions">
     <button type="button" disabled={busy} onClick={()=>setNewInvite(generateCode(scope==='group'?'GRP':'STD'))}><RotateCw size={16}/> Сгенерировать</button>
     <button type="button" disabled={busy||newInvite.trim().length<8||scope==='group'&&!groupName.trim()} onClick={()=>void addCode()}>Создать код</button>
    </div>
   </div>
  </div>
  {created&&<div className="teacherCodeCreated" role="status"><ShieldCheck size={18}/><div><b>Сохраните новый код:</b> <code>{created}</code><p>Повторно посмотреть секретный код нельзя.</p></div><button type="button" onClick={()=>void copy(created)}><Copy size={16}/> Копировать</button></div>}
  <div className="teacherCodeRows">
   <h4>Выданные коды участников</h4>
   {rows.length===0&&<p>Дополнительных кодов пока нет.</p>}
   {rows.map(row=><div key={row.id} className="teacherCodeRow">
    <div><b>{row.scope==='group'?'Группа: '+row.group_name:'Общий код участников'}</b><small>{row.active?'Активен':'Отключён'} · {new Date(row.created_at).toLocaleDateString('ru-RU')}</small></div>
    {row.active&&<button type="button" disabled={busy} onClick={()=>void revoke(row)}>Отключить</button>}
   </div>)}
  </div>
  {notice&&<p className="teacherCodeNotice" role="status">{notice}</p>}
 </section>;
}
