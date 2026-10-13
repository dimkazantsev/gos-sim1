'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Ban,CheckCircle2,RefreshCw,Search,ShieldAlert,ShieldCheck,UserMinus,UsersRound} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type Action='chat'|'posts'|'documents'|'votes'|'cases';
type AccessMode='active'|'blocked'|'removed';
type EditMode='restore'|'restrict'|'block'|'remove';
type MemberRow={
 user_id:string;full_name:string;group_name:string|null;role_title:string|null;
 joined_at:string;mode:AccessMode;restricted_actions:Action[];expires_at:string|null;
 reason:string;changed_at:string|null
};
const features:{value:Action;label:string;description:string}[]=[
 {value:'chat',label:'Чат',description:'Отправка и изменение сообщений'},
 {value:'posts',label:'Политический процесс',description:'Создание и изменение публикаций'},
 {value:'documents',label:'Документы',description:'Создание и изменение НПА'},
 {value:'votes',label:'Голосование',description:'Подача и изменение бюллетеней'},
 {value:'cases',label:'Ситуации',description:'Принятие решений по ситуациям'}
];
function currentMode(row:MemberRow):EditMode{
 if(row.mode==='removed')return 'remove';
 if(row.expires_at&&new Date(row.expires_at).getTime()<=Date.now())return 'restore';
 return row.mode==='blocked'?'block':row.restricted_actions.length?'restrict':'restore';
}
function accessLabel(row:MemberRow){
 const state=currentMode(row);
 return state==='remove'?'Исключён':state==='block'?'Заблокирован':state==='restrict'?'Ограничены функции':'Доступен';
}
export default function TeacherParticipants({g}:{g:ReturnTypeRepublic}){
 const gameId=g.game?.id||'';
 const [rows,setRows]=useState<MemberRow[]>([]);
 const [loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [search,setSearch]=useState('');
 const [selected,setSelected]=useState('');
 const [mode,setMode]=useState<EditMode>('restrict');
 const [actions,setActions]=useState<Action[]>([]);
 const [duration,setDuration]=useState('7');
 const [reason,setReason]=useState('');
 const [message,setMessage]=useState('');
 const refresh=useCallback(async()=>{
  if(!gameId)return;
  const r=await supabase.rpc('teacher_member_access_list',{p_game_id:gameId});
  if(r.error)throw r.error;
  setRows(Array.isArray(r.data)?r.data as MemberRow[]:[]);
 },[gameId]);
 useEffect(()=>{
  let alive=true;
  setRows([]);setSelected('');setError('');
  if(!gameId)return;
  setLoading(true);
  void supabase.rpc('teacher_member_access_list',{p_game_id:gameId}).then(r=>{
   if(!alive)return;
   if(r.error)setError('Не удалось загрузить реестр: '+r.error.message);
   else setRows(Array.isArray(r.data)?r.data as MemberRow[]:[]);
   setLoading(false);
  });
  return()=>{alive=false};
 },[gameId]);
 const filtered=useMemo(()=>rows.filter(r=>[r.full_name,r.group_name||'',r.role_title||''].some(s=>s.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))),[rows,search]);
 const member=rows.find(r=>r.user_id===selected);
 function choose(row:MemberRow){
  setSelected(row.user_id);
  const m=currentMode(row);
  setMode(m==='remove'?'restore':m==='restore'?'restrict':m);
  setActions(row.restricted_actions||[]);
  setReason('');
  setDuration('7');setMessage('');setError('');
 }
 async function save(){
  if(!member||busy||!gameId)return;
  const serverMode:AccessMode=mode==='remove'?'removed':mode==='block'?'blocked':'active';
  const chosen=mode==='restrict'?actions:[];
  if(mode==='restrict'&&!chosen.length){setError('Выберите хотя бы одну функцию для ограничения.');return}
  if(mode!=='restore'&&reason.trim().length<3){setError('Укажите основание не короче трёх символов.');return}
  if(mode==='remove'&&!window.confirm('Исключить «'+member.full_name+'» из игры? Доступ прекратится, но документы, история и оценки сохранятся.'))return;
  if(mode==='block'&&!window.confirm('Заблокировать доступ «'+member.full_name+'»?'))return;
  const expires=mode==='remove'||mode==='restore'||duration==='forever'?null:new Date(Date.now()+Number(duration)*86400000).toISOString();
  setBusy(true);setError('');setMessage('');
  try{
   const r=await supabase.rpc('teacher_set_member_access',{
    p_game_id:gameId,p_user_id:member.user_id,p_mode:serverMode,
    p_actions:chosen,p_expires_at:expires,p_reason:mode==='restore'?'':reason.trim()
   });
   if(r.error)throw r.error;
   await refresh();
   setMessage('Изменение сохранено. Доступ контролируется сервером, предыдущие игровые данные не удалены.');
   setSelected('');void g.refresh();
  }catch(e){setError(e instanceof Error?e.message:'Не удалось изменить доступ')}
  finally{setBusy(false)}
 }
 if(!g.teacher||!gameId)return null;
 return <section className="teacherParticipants" aria-label="Управление участниками">
  <header className="teacherParticipantsHeader">
   <div><small>ДОСТУП И ДИСЦИПЛИНА</small><h2><UsersRound size={22}/> Участники игры</h2>
    <p>Исключение и блокировка прекращают доступ. Ограничение функций запрещает соответствующие действия на сервере. История, оценки и опубликованные материалы сохраняются.</p></div>
   <button type="button" disabled={busy||loading} onClick={()=>{setLoading(true);void refresh().catch(e=>setError(String(e))).finally(()=>setLoading(false))}}><RefreshCw size={16}/> Обновить</button>
  </header>
  <div className="teacherParticipantsTools">
   <label><Search size={17} aria-hidden="true"/><input type="search" placeholder="Поиск по ФИО, группе или должности" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <span>{filtered.length} из {rows.length}</span>
  </div>
  {loading&&<p role="status">Загрузка участников…</p>}
  <div className="teacherParticipantsList">
   {filtered.map(row=><div className="teacherParticipantRow" key={row.user_id}>
    <div className="teacherParticipantIdentity">
     <strong>{row.full_name}</strong>
     <small>{row.group_name||'Группа не указана'} · {row.role_title||'Должность не назначена'}</small>
     <span className={'teacherParticipantStatus '+(currentMode(row)==='restore'?'':'isRestricted')}>{accessLabel(row)}</span>
    </div>
    <button type="button" disabled={busy} onClick={()=>choose(row)}>{currentMode(row)==='restore'?<ShieldCheck size={16}/>:<ShieldAlert size={16}/>} Управлять</button>
   </div>)}
   {!loading&&!filtered.length&&<p>Участники по заданному условию не найдены.</p>}
  </div>
  {member&&<div className="teacherParticipantEditor" aria-label={'Настройка доступа: '+member.full_name}>
   <div className="teacherParticipantEditorTop"><h3>{member.full_name}</h3><button type="button" onClick={()=>{setSelected('');setError('')}}>Закрыть</button></div>
   <p>Текущее состояние: <strong>{accessLabel(member)}</strong>{member.expires_at&&currentMode(member)!=='restore'?' · до '+new Date(member.expires_at).toLocaleString('ru-RU'):''}</p>
   <fieldset disabled={busy}>
    <legend>Действие преподавателя</legend>
    <div className="teacherParticipantModes">
     <label><input type="radio" name="member-access" checked={mode==='restrict'} onChange={()=>setMode('restrict')}/><Ban size={15}/> Ограничить функции</label>
     <label><input type="radio" name="member-access" checked={mode==='block'} onChange={()=>setMode('block')}/><ShieldAlert size={15}/> Заблокировать вход</label>
     <label><input type="radio" name="member-access" checked={mode==='remove'} onChange={()=>setMode('remove')}/><UserMinus size={15}/> Исключить из игры</label>
     <label><input type="radio" name="member-access" checked={mode==='restore'} onChange={()=>setMode('restore')}/><CheckCircle2 size={15}/> Восстановить доступ</label>
    </div>
    {mode==='restrict'&&<div className="teacherParticipantFeatures">
     <b>Какие функции запретить</b>
     {features.map(feature=><label key={feature.value}><input type="checkbox" checked={actions.includes(feature.value)} onChange={e=>setActions(prev=>e.target.checked?[...prev,feature.value]:prev.filter(v=>v!==feature.value))}/><span><strong>{feature.label}</strong><small>{feature.description}</small></span></label>)}
    </div>}
    {(mode==='restrict'||mode==='block')&&<label className="teacherParticipantField">Срок ограничения
     <select value={duration} onChange={e=>setDuration(e.target.value)}>
      <option value="1">1 день</option><option value="7">7 дней</option><option value="30">30 дней</option><option value="forever">Бессрочно</option>
     </select>
    </label>}
    {mode!=='restore'&&<label className="teacherParticipantField">Основание решения
     <textarea rows={2} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Укажите конкретное нарушение или основание"/></label>}
    {mode==='remove'&&<p className="teacherParticipantWarning">Исключение прекращает доступ без удаления истории участника. Восстановление выполняется здесь же.</p>}
    <div className="teacherParticipantSave"><button type="button" disabled={busy||mode==='restrict'&&!actions.length||mode!=='restore'&&reason.trim().length<3} onClick={()=>void save()}>{busy?'Сохранение…':'Подтвердить изменение'}</button><button type="button" onClick={()=>setSelected('')}>Отмена</button></div>
   </fieldset>
  </div>}
  {error&&<p className="teacherParticipantError" role="alert">{error}</p>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
