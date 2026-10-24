'use client';
import {FormEvent,useCallback,useEffect,useState} from 'react';
import {Archive,ArrowRight,Plus,RefreshCcw} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {rememberGameCode} from '@/lib/rememberedGameCodes';
import {userError} from '@/lib/userError';
import './teacher-game-sessions.css';
import TeacherAccessCodes from './TeacherAccessCodes';

type Game={id:string;title:string;status:string;created_at:string;is_owner:boolean};
type Index={games:Game[];is_admin:boolean};
const LAST='gos-id:teacher-last-game';
const CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generated(prefix:string){
 const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
 return prefix+'-'+Array.from(bytes,n=>CHARS[n%CHARS.length]).join('');
}
function openGame(id:string){
 try{window.localStorage.setItem(LAST,id)}catch{}
 if(window.location.hostname.endsWith('.github.io'))window.location.assign('/gos-sim1/?game='+encodeURIComponent(id));
 else window.location.assign('/game/'+encodeURIComponent(id));
}
export default function TeacherGameSessions({displayName='Преподаватель',onGamesChanged}:{
 displayName?:string;onGamesChanged?:(games:Game[])=>void;
}){
 const [index,setIndex]=useState<Index|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [formOpen,setFormOpen]=useState(false);
 const [title,setTitle]=useState('Новая республика');
 const [gameCode,setGameCode]=useState(''),[teacherCode,setTeacherCode]=useState(''),[studentCode,setStudentCode]=useState('');
 const refresh=useCallback(async()=>{
  const response=await supabase.rpc('list_my_teacher_games');
  if(response.error){setError(userError(response.error));return}
  const value=response.data as Index;
  if(!value||!Array.isArray(value.games)){setError('Не удалось загрузить игровые сеансы.');return}
  setIndex(value);onGamesChanged?.(value.games);
 },[onGamesChanged]);
 useEffect(()=>{void refresh()},[refresh]);
 async function create(e:FormEvent){
  e.preventDefault();if(busy)return;
  const code=gameCode.trim().toUpperCase(),teach=teacherCode.trim(),student=studentCode.trim();
  if(!title.trim()||!/^[A-Z0-9-]{4,32}$/.test(code)||teach.length<8||student.length<8||teach===student){
   setError('Укажите название, код игры и два различных приглашения длиной не менее 8 символов.');return;
  }
  setBusy(true);setError('');
  try{
   const auth=await supabase.auth.getSession();
   if(!auth.data.session?.user)throw Error('Войдите в личную учётную запись.');
   const r=await supabase.rpc('create_teacher_game_session',{
    p_title:title.trim(),p_game_code:code,p_teacher_code:teach,p_student_code:student,
    p_teacher_name:displayName.trim()||'Преподаватель'
   });
   if(r.error)throw r.error;
   rememberGameCode(code);
   setFormOpen(false);
   setGameCode('');setTeacherCode('');setStudentCode('');
   await refresh();setNotice('Игра создана. Все коды доступны ниже в любое время.');setBusy(false);
  }catch(e){setError(userError(e)||'Не удалось создать игру.');setBusy(false)}
 }
 async function enter(id:string){
  if(busy)return;setBusy(true);setError('');
  const r=await supabase.rpc('ensure_my_game_access',{p_game:id});
  if(r.error){setError(userError(r.error));setBusy(false);return}
  const auth=await supabase.auth.getSession();
  if(auth.data.session?.user)await supabase.from('teacher_profiles').update({last_game_id:id}).eq('user_id',auth.data.session.user.id);
  openGame(id);
 }
 async function archive(g:Game){
  if(busy||!window.confirm('Перенести «'+g.title+'» в архив? Оценки, протоколы, участники и документы останутся сохранены.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const r=await supabase.rpc('archive_my_teacher_game',{p_game:g.id});
   if(r.error)throw r.error;
   setNotice('Игра перенесена в архив без удаления данных.');
   await refresh();
  }catch(e){setError(userError(e))}
  finally{setBusy(false)}
 }
 return <section id="teacher-game-sessions" className="gosTeacherSessions surface" aria-label="Игры и учебные сеансы">
  <header className="gosTeacherSessionsHeader">
   <div><small>ЛИЧНЫЙ КАБИНЕТ</small><h2>Игры и учебные сеансы</h2><p>Игры создаются и переключаются здесь. Постоянный профиль преподавателя не удаляется вместе с ними.</p></div>
   <div className="gosTeacherSessionsActions">
    <button type="button" className="secondary" disabled={busy} onClick={()=>void refresh()} aria-label="Обновить список игр"><RefreshCcw size={17}/>Обновить</button>
    <button type="button" className="primary" aria-expanded={formOpen} disabled={busy} onClick={()=>setFormOpen(v=>!v)}><Plus size={17}/>{formOpen?'Свернуть':'Создать игру'}</button>
   </div>
  </header>
  {error&&<p className="gosTeacherSessionsError" role="alert">{error}</p>}
  {notice&&<p className="gosTeacherSessionsNotice" role="status">{notice}</p>}
  {formOpen&&<form className="gosTeacherCreateForm" onSubmit={e=>void create(e)}>
   <h3>Новая игровая сессия</h3>
   <label>Название игры<input required maxLength={150} value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <div className="gosTeacherCreateGameCode">
    <label htmlFor="gos-teacher-game-code">Код игры</label>
    <input id="gos-teacher-game-code" required autoComplete="off" maxLength={32} value={gameCode} onChange={e=>setGameCode(e.target.value.toUpperCase())} placeholder="GOS-2026"/>
    <button type="button" className="secondary" onClick={()=>setGameCode(generated('GOS'))}>Сгенерировать код игры</button>
   </div>
   <div className="gosTeacherCreateCodes">
    <div className="gosTeacherCreateCodeField">
     <label htmlFor="gos-teacher-invite-code">Приглашение дополнительного преподавателя</label>
     <input id="gos-teacher-invite-code" type="text" required minLength={8} maxLength={80} autoComplete="off" value={teacherCode} onChange={e=>setTeacherCode(e.target.value)}/>
     <button type="button" className="secondary" onClick={()=>setTeacherCode(generated('TCH'))}>Сгенерировать код</button>
     <p className="gosTeacherCreateCodeHint">Это не пароль владельца. Дополнительному преподавателю потребуется подтверждённая учётная запись.</p>
    </div>
    <div className="gosTeacherCreateCodeField">
     <label htmlFor="gos-student-invite-code">Приглашение участника</label>
     <input id="gos-student-invite-code" type="text" required minLength={8} maxLength={80} autoComplete="off" value={studentCode} onChange={e=>setStudentCode(e.target.value)}/>
     <button type="button" className="secondary" onClick={()=>setStudentCode(generated('STD'))}>Сгенерировать код</button>
     <p className="gosTeacherCreateCodeHint">Предназначено только для участников игры и не даёт прав преподавателя.</p>
    </div>
   </div>
   <button type="submit" className="primary" disabled={busy}>{busy?'Создание…':'Создать и открыть игру'}</button>
  </form>}
  {!index&&<p className="gosTeacherSessionsEmpty" role="status">Получаем список игр…</p>}
  {index&&index.games.length===0&&<p className="gosTeacherSessionsEmpty">Игровых сеансов пока нет. Создайте первую игру здесь — без повторной регистрации преподавателя.</p>}
  {index&&index.games.length>0&&<div className="gosTeacherSessionList">
   {index.games.map(game=><div key={game.id} className="gosTeacherSessionUnit"><article className="gosTeacherSessionRow">
    <div><b>{game.title}</b><span>{game.status==='archived'?'В архиве':game.status==='running'?'Идёт игра':'Подготовка'} · {new Date(game.created_at).toLocaleDateString('ru-RU')}</span></div>
    <div className="gosTeacherSessionControls">
     <button type="button" className="secondary" disabled={busy} onClick={()=>void enter(game.id)}>Открыть <ArrowRight size={16}/></button>
     {game.status!=='archived'&&<button type="button" className="secondary" disabled={busy} onClick={()=>void archive(game)}><Archive size={16}/>В архив</button>}
    </div>
   </article>{game.is_owner&&<TeacherAccessCodes gameId={game.id}/>}</div>)}
  </div>}
 </section>;
}
