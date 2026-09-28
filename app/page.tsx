'use client';
import {FormEvent,useMemo,useState} from 'react';
import {ArrowUpRight,ArrowRight,Eye,EyeOff,GraduationCap,Landmark,LockKeyhole,LoaderCircle} from 'lucide-react';
import CivicArtwork from '@/components/ui/CivicArtwork';
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
 const [showCode,setShowCode]=useState(false);
 const heading=useMemo(()=>mode==='teacher'&&createMode?'Новое государство':mode==='teacher'?'Начнём занятие':'Ваш ход. Входите.',[mode,createMode]);

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

 return <main className="entryPage">
  <a className="skipLink" href="#entry-form">Перейти ко входу</a>
  <header className="entryHeader"><a className="wordmark" href="/" aria-label="GOS SIM — главная"><span className="brandMark" aria-hidden="true">g<span>//</span>s</span><b>GOS<span>//</span>SIM</b></a><span className="entryEdition">Лаборатория государственного управления <i>2026</i></span></header>
  <div className="entryGrid">
   <section className="entryStory" aria-labelledby="entry-title">
    <div className="entryEyebrow"><span/>Учебная игра · ГМУ</div>
    <h1 id="entry-title">Государство<br/>начинается<br/><em>с вашего решения.</em></h1>
    <p className="entryLead">Создавайте партии. Принимайте законы. Договаривайтесь о будущем. Пройдите путь от первого политического союза до управления целой республикой.</p>
    <div className="entryVisual"><CivicArtwork/><div className="entryVisualCaption"><span>РЕСПУБЛИКА ПОЛИТОЛОГИЯ</span><ArrowUpRight aria-hidden="true"/></div></div>
    <div className="entryFacts"><div><b>16</b><span>этапов игры</span></div><div><Landmark aria-hidden="true"/><span>Реальные институты.<br/>Учебные решения.</span></div><div><GraduationCap aria-hidden="true"/><span>Практика государственного<br/>и муниципального управления</span></div></div>
   </section>
   <section className="entryAccess" aria-labelledby="entry-heading">
    <form id="entry-form" className="entryForm" onSubmit={submit} aria-busy={busy}>
     <div className="entryFormIntro"><span className="overline">{mode==='teacher'&&createMode?'СОЗДАТЬ УЧЕБНУЮ ИГРУ':'ПРИСОЕДИНИТЬСЯ К ИГРЕ'}</span><h2 id="entry-heading">{heading}</h2><p>{mode==='teacher'?(createMode?'Задайте название и коды доступа для вашей группы.':'Откройте занятие с помощью кода игры и кода преподавателя.'):'Введите данные, которые вы получили от преподавателя.'}</p></div>
     <fieldset disabled={busy}>
      <legend className="srOnly">Роль и данные для входа</legend>
      <div className="entryRoles" aria-label="Ваша роль"><button type="button" aria-pressed={mode==='student'} className={mode==='student'?'active':''} onClick={()=>{setMode('student');setCreateMode(false);setError('')}}><GraduationCap aria-hidden="true"/>Участник</button><button type="button" aria-pressed={mode==='teacher'} className={mode==='teacher'?'active':''} onClick={()=>{setMode('teacher');setError('')}}><Landmark aria-hidden="true"/>Преподаватель</button></div>
      {mode==='teacher'&&<div className="entryMode"><button type="button" aria-pressed={!createMode} className={!createMode?'active':''} onClick={()=>{setCreateMode(false);setError('')}}>Войти в игру</button><button type="button" aria-pressed={createMode} className={createMode?'active':''} onClick={()=>{setCreateMode(true);setError('')}}>Создать игру</button></div>}
      <label className="entryField">Ваше ФИО<input name="fullName" autoComplete="name" value={fio} onChange={e=>setFio(e.target.value)} placeholder="Иванов Иван Иванович" minLength={2} required/></label>
      {mode==='teacher'&&createMode&&<label className="entryField">Название игры<input name="gameTitle" value={gameTitle} onChange={e=>setGameTitle(e.target.value)} required/></label>}
      <div className={'entryFieldRow '+(mode==='teacher'?'single':'')}><label className="entryField">Код игры<input name="gameCode" autoComplete="off" autoCapitalize="none" spellCheck={false} value={gameCode} onChange={e=>setGameCode(e.target.value)} placeholder="GPU-2026" minLength={2} required/></label>{mode==='student'&&<label className="entryField">Группа <small>необязательно</small><input name="group" value={group} onChange={e=>setGroup(e.target.value)} placeholder="Например, 1241"/></label>}</div>
      <div className="entryField"><label htmlFor="invite-code">{mode==='teacher'?'Код преподавателя':'Код участника'}</label><span className="entrySecret"><input id="invite-code" name="inviteCode" autoComplete={createMode?'new-password':'current-password'} type={showCode?'text':'password'} minLength={4} value={invite} onChange={e=>setInvite(e.target.value)} required aria-describedby="code-hint"/><button type="button" onClick={()=>setShowCode(!showCode)} aria-label={showCode?'Скрыть код':'Показать код'} aria-pressed={showCode}>{showCode?<EyeOff/>:<Eye/>}</button></span><small id="code-hint">{mode==='teacher'?(createMode?'Придумайте код из 4 или более символов.':'Используйте код преподавателя, заданный при создании игры.'):'Отдельный код доступа, полученный от преподавателя.'}</small></div>
      {mode==='teacher'&&createMode&&<div className="entryField"><label htmlFor="student-code">Код для студентов</label><input id="student-code" name="studentCode" type="password" autoComplete="new-password" minLength={4} value={studentCode} onChange={e=>setStudentCode(e.target.value)} required aria-describedby="student-code-hint"/><small id="student-code-hint">Не должен совпадать с кодом преподавателя.</small></div>}
      {error&&<div className="errorBox" role="alert">{error}</div>}
      <button className="primary entrySubmit" disabled={busy}>{busy?<><LoaderCircle className="spin" aria-hidden="true"/>Подключаемся…</>:<>{mode==='teacher'&&createMode?'Создать игру':'Войти в игру'}<ArrowRight aria-hidden="true"/></>}</button>
     </fieldset>
     <div className="entryPrivacy"><LockKeyhole aria-hidden="true"/><p>ФИО будет видно участникам и преподавателю. Ваши действия сохраняются в протоколе игры.</p></div>
    </form>
    <div className="entryAccessNote"><span>01 — 16</span><p>Здесь каждое решение<br/>меняет ход игры.</p><ArrowUpRight aria-hidden="true"/></div>
   </section>
  </div>
  <footer className="entryFooter"><span>GOS//SIM · Республика Политология</span><span>Деловая игра по ПАУ / ГПУ</span><span>Учебная модель государственных институтов</span></footer>
 </main>;
}
