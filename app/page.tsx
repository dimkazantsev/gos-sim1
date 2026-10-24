'use client';
import {FormEvent,useEffect,useMemo,useState} from 'react';
import {ArrowUpRight,ArrowRight,Eye,EyeOff,GraduationCap,Landmark,LockKeyhole,LoaderCircle,ShieldCheck} from 'lucide-react';
import CivicArtwork from '@/components/ui/CivicArtwork';
import GameEntryQr from '@/components/ui/GameEntryQr';
import {BrandIdentity,BRAND_NAME,BRAND_TAGLINE} from '@/components/ui/BrandIdentity';
import {useRouter} from 'next/navigation';
import {createPasswordAuthClient,supabase} from '@/lib/supabase';
import {isTransientAuthError} from '@/lib/authTransport';
import {userError} from '@/lib/userError';
import {forgetRememberedGameCode,readRememberedGameCodes,rememberGameCode} from '@/lib/rememberedGameCodes';

function readableError(err:unknown){
 const raw=err&&typeof err==='object'&&'message' in err?String((err as {message?:unknown}).message??''):err instanceof Error?err.message:'';
 if(raw.includes('Invite codes must be at least 4 characters'))return 'Коды доступа должны содержать не менее 4 символов.';
 if(raw.includes('Teacher and student codes must be different'))return 'Код преподавателя и код студентов должны отличаться.';
 if(raw.includes('Group required'))return 'Укажите свою группу либо используйте код группы, выданный преподавателем.';
 if(raw.includes('Invalid game or invite code'))return 'Неверный код игры или код приглашения.';
 if(raw.includes('duplicate key value')||raw.includes('games_game_code_key'))return 'Игра с таким кодом уже существует. Укажите другой код игры.';
 return userError(err)||'Не удалось выполнить вход.';
}

/** Only allow known in-app destinations through the public entry page. */
function incomingSectionSuffix(){
 if(typeof window==='undefined'||typeof URLSearchParams==='undefined')return '';
 const source=new URLSearchParams(window.location.search);
 const section=source.get('section');
 if(!section||!['dashboard','stages','votes','documents','actions','parties','profile','events','budget','grades'].includes(section))return '';
 const clean=new URLSearchParams({section});
 const id=source.get('document'),vote=source.get('vote');
 const stage=Number(source.get('stage')||0);
 if(id&&/^[a-f0-9-]{36}$/i.test(id))clean.set('document',id);
 if(vote&&/^[a-f0-9-]{36}$/i.test(vote))clean.set('vote',vote);
 if(Number.isInteger(stage)&&stage>=1&&stage<=16)clean.set('stage',String(stage));
 if(source.get('openChat')==='1')clean.set('openChat','1');
 const channel=source.get('channel');
 if(channel&&/^[a-f0-9-]{36}$/i.test(channel))clean.set('channel',channel);
 if(source.get('tasks')==='1')clean.set('tasks','1');
 return '?'+clean.toString();
}

export default function Home(){
 const router=useRouter();
 const [mode,setMode]=useState<'student'|'teacher'|'guest'>('student'),[createMode,setCreateMode]=useState(false);
 const [gameTitle,setGameTitle]=useState('Республика Политология'),[studentCode,setStudentCode]=useState(''),[fio,setFio]=useState(''),[group,setGroup]=useState(''),[gameCode,setGameCode]=useState(''),[invite,setInvite]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [showCode,setShowCode]=useState(false);
 const [personalLogin,setPersonalLogin]=useState(false);
 const [teacherLogin,setTeacherLogin]=useState(false);
 const [loginEmail,setLoginEmail]=useState(''),[loginPassword,setLoginPassword]=useState(''),[loginGameCode,setLoginGameCode]=useState(''),[recoverySent,setRecoverySent]=useState(false);
 const [savedGameCodes,setSavedGameCodes]=useState<string[]>([]);
 const [fromSharedLink,setFromSharedLink]=useState(false);
 useEffect(()=>setFromSharedLink(!!incomingSectionSuffix()),[]);
 useEffect(()=>{
  const requested=new URLSearchParams(window.location.search).get('teacher');
  if(requested==='1'){setTeacherLogin(true);setPersonalLogin(true);setMode('teacher')}
  if(requested==='create'){setTeacherLogin(true);setPersonalLogin(true);setMode('teacher');setCreateMode(false)}
 },[]);
 useEffect(()=>{
  const codes=readRememberedGameCodes();
  setSavedGameCodes(codes);
  setLoginGameCode(current=>current||codes[0]||'');
 },[]);
 function saveSuccessfulGameCode(code:string){
  setSavedGameCodes(rememberGameCode(code));
 }
 // The public entry always remains available, including for authenticated teachers.
 // Only an explicit password sign-in or an in-game action opens /teacher.
 // Telegram links arrive at the public entry page. Reuse a session that
 // already exists IN THIS BROWSER; never put bearer tokens in Telegram URLs.
 useEffect(()=>{
  if(!incomingSectionSuffix())return;
  let active=true;
  void (async()=>{
   try{
    const {data:auth,error:authError}=await supabase.auth.getSession();
    if(!active||authError||!auth.session?.user?.id)return;
    const userId=auth.session.user.id;
    const rows=await supabase.from('game_members').select('game_id')
     .eq('user_id',userId).is('roster_archived_at',null).limit(2);
    if(!active||rows.error)return;
    if(rows.data?.length===1){router.replace('/game/'+rows.data[0].game_id+incomingSectionSuffix());return}
    // Multiple games require a game selection; do not open a random game.
    const saved=readRememberedGameCodes();
    if(saved.length!==1)return;
    const resume=await supabase.rpc('resume_member_game',{p_game_code:saved[0]});
    if(active&&!resume.error&&resume.data)router.replace('/game/'+String(resume.data)+incomingSectionSuffix());
   }catch{/* A missing session or unavailable server must preserve normal login. */}
  })();
  return()=>{active=false};
 },[router]);
 const heading=useMemo(()=>mode==='teacher'&&createMode?'Новое государство':mode==='teacher'?'Начнём занятие':mode==='guest'?'Гостевой просмотр':'Вход участника',[mode,createMode]);

 async function submit(e:FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{
   const name=fio.trim(),code=gameCode.trim(),access=invite.trim(),students=studentCode.trim();
   if(name.length<2)throw new Error('Введите ФИО.');
   // Group-specific codes assign a group on the server; common codes still require a group.
   if(code.length<2)throw new Error('Введите код игры.');
   if(access.length<(mode==='guest'?6:4))throw new Error(mode==='guest'?'Код гостя должен содержать минимум 6 символов.':'Код доступа должен содержать минимум 4 символа.');
   if(mode==='teacher'&&createMode){if(students.length<4)throw new Error('Код студентов должен содержать минимум 4 символа.');if(students===access)throw new Error('Коды преподавателя и студентов должны отличаться.')}
   const session=(await supabase.auth.getSession()).data.session;
   if(mode==='teacher'&&createMode&&(!session||session.user.is_anonymous)){setTeacherLogin(true);setPersonalLogin(true);setCreateMode(false);return}
   if(!session){const a=await supabase.auth.signInAnonymously({options:{data:{full_name:name}}});if(a.error)throw a.error}
   if(mode==='teacher'&&createMode){
    const r=await supabase.rpc('create_teacher_game_session',{p_title:gameTitle.trim(),p_game_code:code,p_teacher_code:access,p_student_code:students,p_teacher_name:name});if(r.error)throw r.error;saveSuccessfulGameCode(code);router.push('/game/'+r.data+incomingSectionSuffix());
   }else{
    const r=await supabase.rpc('join_game_with_code',{p_game_code:code,p_invite_code:access,p_full_name:name,p_group_name:mode==='student'?group.trim():null});if(r.error)throw r.error;saveSuccessfulGameCode(code);router.push('/game/'+r.data+incomingSectionSuffix());
   }
  }catch(e){setError(readableError(e))}finally{setBusy(false)}
 }

 async function login(e:FormEvent){
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  let phase:'authentication'|'session'|'game'='authentication';
  try{
   if(typeof navigator!=='undefined'&&!navigator.onLine)throw new Error('Устройство не подключено к интернету. Проверьте сеть.');
   // Explicit password login must not depend on a stored refresh token.
   // getSession() may auto-refresh an old local session before checking the
   // credentials entered in this form, so a transient refresh-token 504 can
   // incorrectly block a valid password login.
   let authError:unknown=null,session:null|{access_token:string;refresh_token:string}=null;
   const loginClient=createPasswordAuthClient();
   for(let attempt=0;attempt<2;attempt++){
    const auth=await loginClient.auth.signInWithPassword({email:loginEmail.trim().toLowerCase(),password:loginPassword});
    if(!auth.error&&auth.data.session){
     authError=null;
     session={access_token:auth.data.session.access_token,refresh_token:auth.data.session.refresh_token};
     break;
    }
    authError=auth.error||new Error('Сервер авторизации не вернул сессию.');
    if(!isTransientAuthError(authError)||attempt===1)throw authError;
    await new Promise(resolve=>setTimeout(resolve,900));
   }
   if(authError||!session)throw authError||new Error('Сервер авторизации не вернул сессию.');
   phase='session';
   for(let attempt=0;attempt<2;attempt++){
    const adopted=await supabase.auth.setSession(session);
    if(!adopted.error)break;
    if(!isTransientAuthError(adopted.error)||attempt===1)throw adopted.error;
    await new Promise(resolve=>setTimeout(resolve,900));
   }
   phase='game';
   if(teacherLogin){
    router.push('/teacher');
    return;
   }
   // PostgREST can temporarily return 503 while rebuilding its schema cache.
   // Resume is idempotent, unlike join_game_with_code which records an audit event.
   let resumedGameId='';
   for(let attempt=0;attempt<3;attempt++){
    const r=await supabase.rpc('resume_member_game',{p_game_code:loginGameCode.trim()});
    if(!r.error){
     if(!r.data)throw new Error('Сервер не подтвердил участие в игре.');
     resumedGameId=String(r.data);break;
    }
    const detail=[r.error.code,r.error.message].filter(Boolean).join(' ');
    const retry=/PGRST00[0-3]|schema cache|temporarily unavailable|Нет ответа от сервера|fetch failed|network/i.test(detail)||r.error.code==='503'||r.error.code==='504';
    if(!retry||attempt===2)throw r.error;
    await new Promise(resolve=>setTimeout(resolve,800*(attempt+1)));
   }
   saveSuccessfulGameCode(loginGameCode);
    router.push('/game/'+resumedGameId+incomingSectionSuffix());
  }catch(e){
   const message=readableError(e);
   setError((phase==='authentication'?'Проверка учётной записи: ':phase==='session'?'Проверка сессии: ':'Открытие игровой сессии: ')+message);
  }finally{setBusy(false)}
 }
 async function recover(){
  if(!loginEmail.includes('@')){setError('Укажите почту, к которой привязана ваша учётная запись.');return}
  setBusy(true);setError('');setRecoverySent(false);
  try{
   // On GitHub Pages the recovery route is served by the Next.js application, not the static shell.
   const origin=(process.env.NEXT_PUBLIC_GAME_API_ORIGIN||
    (window.location.hostname.endsWith('.github.io')?'https://gos-sim1.vercel.app':window.location.origin)).replace(/[/]$/,'');
   const r=await supabase.auth.resetPasswordForEmail(loginEmail.trim().toLowerCase(),{redirectTo:origin+'/auth/update-password'});
   if(r.error)setError(readableError(r.error));else setRecoverySent(true);
  }catch(e){setError(readableError(e))}
  finally{setBusy(false)}
 }
 return <main className="entryPage">
  <a className="skipLink" href="#entry-form">Перейти ко входу</a>
  <header className="entryHeader"><a className="wordmark" href="/" aria-label={BRAND_NAME+" — главная"}><BrandIdentity tagline/></a><span className="entryEdition">Лаборатория государственного управления <i>2026</i></span></header>
  <div className="entryGrid">
   <section className="entryStory" aria-labelledby="entry-title">
    <div className="entryEyebrow"><span/>Учебная игра · ГМУ</div>
    <h1 id="entry-title">Государство<br/>начинается<br/><em>с вашего решения.</em></h1>
    <p className="entryLead">Создавайте партии. Принимайте законы. Договаривайтесь о будущем. Пройдите путь от первого политического союза до управления целой республикой.</p>
    <div className="entryVisual"><CivicArtwork/><div className="entryVisualCaption"><span>РЕСПУБЛИКА ПОЛИТОЛОГИЯ</span><ArrowUpRight aria-hidden="true"/></div></div>
    <div className="entryFacts"><div><b>16</b><span>этапов игры</span></div><div><Landmark aria-hidden="true"/><span>Реальные институты.<br/>Учебные решения.</span></div><div><GraduationCap aria-hidden="true"/><span>Практика государственного<br/>и муниципального управления</span></div></div>
   </section>
   <section className="entryAccess" aria-labelledby="entry-heading">
    {!personalLogin&&<form id="entry-form" className="entryForm" onSubmit={submit} aria-busy={busy}>
     <div className="entryFormIntro"><span className="overline">{mode==='teacher'&&createMode?'СОЗДАТЬ УЧЕБНУЮ ИГРУ':'ПРИСОЕДИНИТЬСЯ К ИГРЕ'}</span><h2 id="entry-heading">{heading}</h2><p>{mode==='teacher'?(createMode?'Задайте название и коды доступа для вашей группы.':'Откройте занятие с помощью кода игры и кода преподавателя.'):'Введите код игры и приглашение, полученные от преподавателя. Для повторного входа используйте личный пароль.'}</p></div>
     <fieldset disabled={busy}>
      <legend className="srOnly">Роль и данные для входа</legend>
      <div className="entryRoles" aria-label="Ваша роль"><button type="button" aria-pressed={mode==='student'} className={mode==='student'?'active':''} onClick={()=>{setMode('student');setCreateMode(false);setError('')}}><GraduationCap aria-hidden="true"/>Участник</button><button type="button" aria-pressed={mode==='teacher'} className={mode==='teacher'?'active':''} onClick={()=>{setMode('teacher');setError('')}}><Landmark aria-hidden="true"/>Преподаватель</button><button type="button" aria-pressed={mode==='guest'} className={mode==='guest'?'active':''} onClick={()=>{setMode('guest');setCreateMode(false);setError('')}}><Eye aria-hidden="true"/>Гость</button><button type="button" onClick={()=>{setTeacherLogin(mode==='teacher');setPersonalLogin(true);setError('')}}><LockKeyhole aria-hidden="true"/>Войти с личным паролем</button></div>
      {mode==='teacher'&&!createMode&&<button type="button" className="entryPersonalSwitch" onClick={()=>{setTeacherLogin(true);setPersonalLogin(true);setError('')}}><ShieldCheck size={17}/> Войти в кабинет преподавателя без кода игры</button>}
      {mode==='teacher'&&<div className="entryMode"><button type="button" aria-pressed={!createMode} className={!createMode?'active':''} onClick={()=>{setCreateMode(false);setError('')}}>Войти в игру</button><button type="button" aria-pressed={createMode} className={createMode?'active':''} onClick={()=>{setTeacherLogin(true);setPersonalLogin(true);setCreateMode(false);setError('')}}>Создать игру в профиле</button></div>}
      <label className="entryField">Ваше ФИО<input name="fullName" autoComplete="name" value={fio} onChange={e=>setFio(e.target.value)} placeholder="Иванов Иван Иванович" minLength={2} required/></label>
      {mode==='teacher'&&createMode&&<label className="entryField">Название игры<input name="gameTitle" value={gameTitle} onChange={e=>setGameTitle(e.target.value)} required/></label>}
      <div className={'entryFieldRow '+(mode==='teacher'?'single':'')}><label className="entryField">Код игры<input name="gameCode" autoComplete="off" autoCapitalize="none" spellCheck={false} value={gameCode} onChange={e=>setGameCode(e.target.value)} placeholder="Например, 8.414" minLength={2} required/><small>Идентификатор конкретной игры, сообщённый преподавателем.</small></label>{mode==='student'&&<label className="entryField">Группа<input name="group" value={group} onChange={e=>setGroup(e.target.value)} placeholder="Для общего приглашения; при приглашении группы заполнять не нужно"/></label>}</div>
      <div className="entryField"><label htmlFor="invite-code">{mode==='teacher'?'Приглашение преподавателя':mode==='guest'?'Приглашение гостя':'Приглашение участника'}</label><span className="entrySecret"><input id="invite-code" name="inviteCode" autoComplete={createMode?'new-password':'current-password'} type={showCode?'text':'password'} minLength={mode==='guest'?6:4} value={invite} onChange={e=>setInvite(e.target.value)} required aria-describedby="code-hint"/><button type="button" onClick={()=>setShowCode(!showCode)} aria-label={showCode?'Скрыть код':'Показать код'} aria-pressed={showCode}>{showCode?<EyeOff/>:<Eye/>}</button></span><small id="code-hint">{mode==='teacher'?(createMode?'Придумайте код из 4 или более символов.':'Используйте код преподавателя, заданный при создании игры.'):mode==='guest'?'Предоставляет просмотр разрешённых разделов без участия в принятии решений.':mode==='student'?'Приглашение участника разрешает вход; приглашение группы автоматически привяжет группу.':'Отдельное приглашение, полученное от преподавателя.'}</small></div>
      {mode==='teacher'&&createMode&&<div className="entryField"><label htmlFor="student-code">Начальное приглашение участников</label><input id="student-code" name="studentCode" type="password" autoComplete="new-password" minLength={4} value={studentCode} onChange={e=>setStudentCode(e.target.value)} required aria-describedby="student-code-hint"/><small id="student-code-hint">Не должен совпадать с кодом преподавателя.</small></div>}
      {error&&<div className="errorBox" role="alert">{error}</div>}
      <button className="primary entrySubmit" disabled={busy}>{busy?<><LoaderCircle className="spin" aria-hidden="true"/>Подключаемся…</>:<>{mode==='teacher'&&createMode?'Создать игру':'Войти в игру'}<ArrowRight aria-hidden="true"/></>}</button>
     </fieldset>
     <GameEntryQr/>
     <div className="entryPrivacy"><LockKeyhole aria-hidden="true"/><p>ФИО будет видно участникам и преподавателю. Ваши действия сохраняются в протоколе игры.</p></div>
    </form>}
    {fromSharedLink&&<p className="entryLinkAdvice">Ссылка из Телеграма открывает нужный раздел без повторного входа только в браузере, где Вы уже авторизованы. Если Телеграм открыл отдельное окно, выберите в его меню «Открыть в браузере» и используйте ссылку там. Данные для входа по ссылке не передаются.</p>}
    {personalLogin&&<form id="entry-form" className="entryForm" onSubmit={login} aria-busy={busy}>
     <div className="entryFormIntro"><span className="overline">{teacherLogin?'КАБИНЕТ ПРЕПОДАВАТЕЛЯ':'ЛИЧНАЯ УЧЁТНАЯ ЗАПИСЬ'}</span><h2>{teacherLogin?'Вход преподавателя':'Вход по паролю'}</h2><p>{teacherLogin?'Войдите по подтверждённой почте и личному паролю. Код игры не нужен: доступные игры будут в Вашем кабинете.':'Используйте подтверждённую почту и пароль, указанные в игровом профиле. Ваши мандаты и действия сохранятся.'}</p></div>
     <button type="button" className="entryPersonalSwitch" onClick={()=>{setPersonalLogin(false);setTeacherLogin(false);setError('')}}><LockKeyhole size={16}/> Вернуться ко входу по коду</button>
     <fieldset disabled={busy}>
      <legend className="srOnly">Данные личной учётной записи</legend>
      <button type="button" className="entryPersonalSwitch" aria-pressed={teacherLogin} onClick={()=>{setTeacherLogin(!teacherLogin);setError('')}}><Landmark size={16}/>{teacherLogin?'Вход участника в конкретную игру':'Войти как преподаватель — без кода игры'}</button>
      {!teacherLogin&&<div className="entryField entryRememberedGameField">
       <label htmlFor="personal-game-code">Код игры</label>
       <input id="personal-game-code" name="gameCode" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} required minLength={2} value={loginGameCode} onChange={e=>setLoginGameCode(e.target.value)} placeholder="Код Вашей игры"/>
       {savedGameCodes.length>1&&<label className="entryRememberedGameSelect">Ранее открытые игры
        <select aria-label="Выбрать сохранённый код игры" value={savedGameCodes.includes(loginGameCode)?loginGameCode:''} onChange={e=>setLoginGameCode(e.target.value)}>
         <option value="">Выберите сохранённый код</option>
         {savedGameCodes.map(code=><option key={code} value={code}>{code}</option>)}
        </select>
       </label>}
       <div className="entryRememberedGameHint">
        <small>Код автоматически сохраняется в этом браузере после успешного входа. На другом устройстве его нужно ввести один раз.</small>
        {savedGameCodes.includes(loginGameCode)&&<button type="button" className="entryForgetGameCode" disabled={busy} onClick={()=>{
         setSavedGameCodes(forgetRememberedGameCode(loginGameCode));
         setLoginGameCode('');
        }}>Забыть код</button>}
       </div>
      </div>}
      <label className="entryField">Электронная почта<input required type="email" autoComplete="username" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} placeholder="Ваш адрес почты"/></label>
      <label className="entryField">Личный пароль<input required type="password" autoComplete="current-password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} placeholder="Ваш личный пароль"/></label>
      {error&&<div className="errorBox" role="alert">{error}</div>}
      {recoverySent&&<div className="entryRecoveryNotice" role="status">Если этот адрес привязан к игре, письмо со ссылкой для смены пароля будет отправлено.</div>}
      <button type="submit" className="primary entrySubmit" disabled={busy}>{busy?'Проверка…':teacherLogin?'Войти в кабинет преподавателя':'Войти в мою игру'}<ArrowRight size={18}/></button>
      <button type="button" className="entryForgot" disabled={busy} onClick={()=>void recover()}>Забыли пароль? Отправить ссылку для восстановления</button>
     </fieldset>
     <GameEntryQr/>
    </form>}
    <div className="entryAccessNote"><span>01 — 16</span><p>Здесь каждое решение<br/>меняет ход игры.</p><ArrowUpRight aria-hidden="true"/></div>
   </section>
  </div>
  <footer className="entryFooter"><span>{BRAND_NAME} · {BRAND_TAGLINE}</span><span>Деловая игра по ПАУ / ГПУ</span><span>Учебная модель государственных институтов</span></footer>
 </main>;
}
