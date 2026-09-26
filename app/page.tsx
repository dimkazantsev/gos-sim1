'use client';
import {FormEvent,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import {supabase} from '@/lib/supabase';

function readableError(err:unknown){
 const raw=err&&typeof err==='object'&&'message' in err?String((err as {message?:unknown}).message??''):err instanceof Error?err.message:'';
 if(raw.includes('Invite codes must be at least 4 characters'))return 'Коды доступа должны содержать не менее 4 символов.';
 if(raw.includes('Teacher and student codes must be different'))return 'Код преподавателя и код студентов должны отличаться.';
 if(raw.includes('Invalid game or invite code'))return 'Неверный код игры или код участника.';
 if(raw.includes('duplicate key value')||raw.includes('games_game_code_key'))return 'Игра с таким кодом уже существует. Укажите другой код игры.';
 return raw||'Не удалось выполнить вход.';
}

export default function Home(){
 const router=useRouter();
 const [mode,setMode]=useState<'student'|'teacher'>('student'),[createMode,setCreateMode]=useState(false);
 const [gameTitle,setGameTitle]=useState('Республика Политология'),[studentCode,setStudentCode]=useState(''),[fio,setFio]=useState(''),[group,setGroup]=useState(''),[gameCode,setGameCode]=useState(''),[invite,setInvite]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const heading=useMemo(()=>mode==='teacher'&&createMode?'Создание новой игровой сессии':mode==='teacher'?'Вход преподавателя':'Вход участника',[mode,createMode]);

 async function submit(e:FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{
   const name=fio.trim(),code=gameCode.trim(),access=invite.trim(),students=studentCode.trim();
   if(name.length<2)throw new Error('Введите ФИО.');
   if(code.length<2)throw new Error('Введите код игры.');
   if(access.length<4)throw new Error('Код доступа должен содержать минимум 4 символа.');
   if(mode==='teacher'&&createMode){if(students.length<4)throw new Error('Код студентов должен содержать минимум 4 символа.');if(students===access)throw new Error('Коды преподавателя и студентов должны отличаться.')}
   const session=(await supabase.auth.getSession()).data.session;
   if(!session){const a=await supabase.auth.signInAnonymously({options:{data:{full_name:name}}});if(a.error)throw a.error}
   if(mode==='teacher'&&createMode){
    const r=await supabase.rpc('create_game_session',{p_title:gameTitle.trim(),p_game_code:code,p_teacher_code:access,p_student_code:students,p_teacher_name:name});if(r.error)throw r.error;router.push('/game/'+r.data);
   }else{
    const r=await supabase.rpc('join_game_with_code',{p_game_code:code,p_invite_code:access,p_full_name:name,p_group_name:mode==='student'?group.trim()||null:null});if(r.error)throw r.error;router.push('/game/'+r.data);
   }
  }catch(e){setError(readableError(e))}finally{setBusy(false)}
 }

 return <main className="loginPage"><div className="gridGlow"/><section className="landingShell">
  <div className="landingIntro"><div className="introBadge">учебная многопользовательская симуляция</div><div className="logoRow"><div className="logo">G//S</div><div><small>POLITICAL & PUBLIC ADMINISTRATION LAB</small><h1>GOS//SIM</h1></div></div><h2>«Республика Политология» — цифровая среда моделирования ПАУ/ГПУ</h2><p className="landingText">От создания партий и выборов до Правительства, законотворчества, федерального бюджета, местного самоуправления и кризисного управления.</p>
   <div className="featureGrid"><article><span>◫</span><div><b>16 игровых этапов</b><p>Вся логика курса перенесена в последовательный интерактивный сценарий.</p></div></article><article><span>✓</span><div><b>Процедуры и голосования</b><p>Кворум 2/3, фракционные решения, мандаты и ghost voting.</p></div></article><article><span>✦</span><div><b>Режиссёрская преподавателя</b><p>Время, кризисы, события, ВСН, роли, партии и показатели государства.</p></div></article><article><span>⌁</span><div><b>Командная коммуникация</b><p>Общий штаб и закрытые фракционные каналы с аудио и видео.</p></div></article></div>
   <div className="infoStrip"><div><label>Курс</label><strong>ГПУ / ПАУ</strong></div><div><label>Формат</label><strong>Командная симуляция</strong></div><div><label>Оценивание</label><strong>ВСН · 0–3</strong></div></div>
  </div>
  <form className="loginCard" onSubmit={submit}><div><small className="muted">РЕЖИМ ДОСТУПА</small><h3 className="formTitle">{heading}</h3><p className="muted">ФИО сохраняется в профиле и игровом протоколе сессии.</p></div>
   <div className="seg"><button type="button" className={mode==='student'?'active':''} onClick={()=>{setMode('student');setCreateMode(false);setError('')}}>Студент</button><button type="button" className={mode==='teacher'?'active':''} onClick={()=>{setMode('teacher');setError('')}}>Преподаватель</button></div>
   {mode==='teacher'&&<div className="seg"><button type="button" className={!createMode?'active':''} onClick={()=>setCreateMode(false)}>Войти</button><button type="button" className={createMode?'active':''} onClick={()=>setCreateMode(true)}>Создать игру</button></div>}
   <label>ФИО<input value={fio} onChange={e=>setFio(e.target.value)} placeholder="Иванов Иван Иванович" required/></label>
   {mode==='teacher'&&createMode&&<label>Название игры<input value={gameTitle} onChange={e=>setGameTitle(e.target.value)} required/></label>}
   <label>Код игры<input value={gameCode} onChange={e=>setGameCode(e.target.value)} placeholder="GPU-2026" required/></label>
   {mode==='student'&&<label>Учебная группа<input value={group} onChange={e=>setGroup(e.target.value)} placeholder="Например: 1241"/></label>}
   <label>{mode==='teacher'?'Код преподавателя':'Код участника'}<input type="password" minLength={4} value={invite} onChange={e=>setInvite(e.target.value)} required/><small className="muted">Минимум 4 символа.</small></label>
   {mode==='teacher'&&createMode&&<label>Код для студентов<input type="password" minLength={4} value={studentCode} onChange={e=>setStudentCode(e.target.value)} required/><small className="muted">Не должен совпадать с кодом преподавателя.</small></label>}
   {error&&<div className="errorBox">{error}</div>}
   <button className="primary" disabled={busy}>{busy?'Подключение…':mode==='teacher'&&createMode?'Создать игровую сессию':'Войти в государство'}</button>
   <div className="loginTips"><div><label>Внутри платформы</label><ul><li>16 этапов курса;</li><li>партии, фракции и роли;</li><li>голосования и решения;</li><li>ВСН и кризисные сценарии.</li></ul></div><div><label>Учебный режим</label><p>Платформа предназначена для проведения деловой игры в рамках учебного курса и фиксирует действия участников внутри сессии.</p></div></div>
  </form>
 </section></main>
}