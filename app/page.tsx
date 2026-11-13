'use client';
import {FormEvent,useEffect,useMemo,useRef,useState} from 'react';
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
 // A synchronous per-tab guard prevents double taps before React has re-rendered.
 // Do not rate-limit by public IP: an entire classroom can share one NAT.
 const entryInFlight=useRef(false);
 function lockEntry(){
  if(entryInFlight.current)return false;
  entryInFlight.current=true;setBusy(true);setError('');return true;
 }
 function unlockEntry(){entryInFlight.current=false;setBusy(false)}
 const [mode,setMode]=useState<'student'|'teacher'|'guest'>('student'),[createMode,setCreateMode]=useState(false);
 const [gameTitle,setGameTitle]=useState('Республика Политология'),[studentCode,setStudentCode]=useState(''),[fio,setFio]=useState(''),[group,setGroup]=useState(''),[gameCode,setGameCode]=useState(''),[invite,setInvite]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [showCode,setShowCode]=useState(false);
 const [blockedIdentity,setBlockedIdentity]=useState('');
 const [personalLogin,setPersonalLogin]=useState(true);
 const [rememberMe,setRememberMe]=useState(false);
 const [teacherLogin,setTeacherLogin]=useState(false);
 const [loginEmail,setLoginEmail]=useState(''),[loginPassword,setLoginPassword]=useState(''),[loginGameCode,setLoginGameCode]=useState(''),[recoverySent,setRecoverySent]=useState(false);
 const [savedGameCodes,setSavedGameCodes]=useState<string[]>([]);
 const [returningGames,setReturningGames]=useState<Array<{id:string;kind:'student'|'observer';code:string;title:string}>>([]);
 const [fromSharedLink,setFromSharedLink]=useState(false);
 const [reentryState,setReentryState]=useState<'idle'|'pending'|'error'>('idle');
 const [reentryError,setReentryError]=useState('');
 const reentryStarted=useRef(false);
 useEffect(()=>{
  try{
   const saved=window.localStorage.getItem('gos-id:remembered-login-email')||'';
   if(saved&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(saved)){setLoginEmail(saved);setRememberMe(true)}
  }catch{/* Private browsing does not prevent entering credentials. */}
 },[]);
 useEffect(()=>setFromSharedLink(!!incomingSectionSuffix()),[]);
 useEffect(()=>{
  const token=new URLSearchParams(window.location.hash.replace(/^#/,'')).get('reentry');
  if(!token||reentryStarted.current)return;
  reentryStarted.current=true;
  if(!/^[a-f0-9]{48}$/.test(token)){
   setReentryError('Ссылка восстановления повреждена. Попросите преподавателя создать новую.');
   setReentryState('error');return;
  }
  setReentryState('pending');
  void (async()=>{
   try{
    const {data}=await supabase.auth.getSession();
    if(!data.session?.user?.id){
     const created=await supabase.auth.signInAnonymously();
     if(created.error)throw created.error;
    }
    const redeemed=await supabase.rpc('redeem_participant_reentry',{p_token:token});
    if(redeemed.error)throw redeemed.error;
    if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(redeemed.data)))throw new Error('Сервер не подтвердил восстановление.');
    window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
    router.replace('/game/'+String(redeemed.data)+'?section=profile');
   }catch(reason){setReentryError(readableError(reason));setReentryState('error');}
  })();
 },[router]);
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
 useEffect(()=>{
  // Public game code only; the private participant invitation never appears in the URL.
  const search=new URLSearchParams(window.location.search);
  if(search.get('section')!=='profile')return;
  const code=search.get('gameCode')||'';
  if(/^[A-Z0-9.-]{2,80}$/i.test(code)){
   setGameCode(code.toUpperCase());
   setLoginGameCode(code.toUpperCase());
  }
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
    const linkedGame=new URLSearchParams(window.location.search).get('game')||'';
    const target=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(linkedGame)?linkedGame:'';
    let membership=supabase.from('game_members').select('game_id')
     .eq('user_id',userId).is('roster_archived_at',null);
    if(target)membership=membership.eq('game_id',target);
    const rows=await membership.limit(2);
    if(!active||rows.error)return;
    if(rows.data?.length===1){router.replace('/game/'+rows.data[0].game_id+incomingSectionSuffix());return}
    // A targeted invitation must never open a different saved game by mistake.
    if(target)return;
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
  e.preventDefault();if(!lockEntry())return;
  setBlockedIdentity('');
  try{
   const name=fio.trim(),code=gameCode.trim(),access=invite.trim(),students=studentCode.trim();
   if(name.length<2)throw new Error('Введите ФИО.');
   // Group-specific codes assign a group on the server; common codes still require a group.
   if(code.length<2)throw new Error('Введите код игры.');
   if(access.length<(mode==='guest'?6:4))throw new Error(mode==='guest'?'Код гостя должен содержать минимум 6 символов.':'Код доступа должен содержать минимум 4 символа.');
   if(mode==='teacher'&&createMode){if(students.length<4)throw new Error('Код студентов должен содержать минимум 4 символа.');if(students===access)throw new Error('Коды преподавателя и студентов должны отличаться.')}
   const auth=await supabase.auth.getSession();
   if(auth.error)throw auth.error;
   const session=auth.data.session;
   if(mode==='teacher'&&createMode&&(!session||session.user.is_anonymous)){setTeacherLogin(true);setPersonalLogin(true);setCreateMode(false);return}
   // Joining with different visible details never creates another account automatically.
   // Protect the teacher's authenticated account from being silently reused or renamed.
   if(mode==='teacher'&&(!session||session.user.is_anonymous)){
    throw new Error('Для входа преподавателя используйте подтверждённую почту и личный пароль. Приглашение дополнительного преподавателя не заменяет авторизацию.');
   }
   // A signed-in teacher cannot become a student/guest with the same auth.uid().
   // Switching roles starts a separate anonymous session automatically; the
   // original registered account and its assets remain unchanged on the server.
   let switchIdentity=false;
   if(mode!=='teacher'&&session){
    if(session.user.is_anonymous){
     // Anonymous accounts cannot be the protected teacher account. Avoid a
     // needless protected-profile lookup for every returning classroom player.
     switchIdentity=session.user.user_metadata?.full_name!==name
       ||window.sessionStorage.getItem('gos-id:last-entry-role')!==null
        &&window.sessionStorage.getItem('gos-id:last-entry-role')!==mode;
    }else{
     // A confirmed teacher must never reuse the permanent account as a student.
     const check=await supabase.from('teacher_profiles').select('user_id')
      .eq('user_id',session.user.id).maybeSingle();
     if(check.error)throw check.error;
     switchIdentity=!!check.data;
    }
   }
   if(switchIdentity){
    const result=await supabase.auth.signOut({scope:'local'});
    if(result.error)throw result.error;
   }
   if(!session||switchIdentity){
    const a=await supabase.auth.signInAnonymously({options:{data:{full_name:name}}});
    if(a.error)throw a.error;
   }
   if(mode==='teacher'&&createMode){
    const r=await supabase.rpc('create_teacher_game_session',{p_title:gameTitle.trim(),p_game_code:code,p_teacher_code:access,p_student_code:students,p_teacher_name:name});if(r.error)throw r.error;saveSuccessfulGameCode(code);router.push('/game/'+r.data+incomingSectionSuffix());
   }else{
    const r=await supabase.rpc('join_game_as_role',{p_game_code:code,p_invite_code:access,p_full_name:name,p_group_name:mode==='student'?group.trim():null,p_expected_kind:mode==='guest'?'observer':mode});if(r.error)throw r.error;saveSuccessfulGameCode(code);window.sessionStorage.setItem('gos-id:last-entry-role',mode);router.push('/game/'+r.data+incomingSectionSuffix());
   }
  }catch(e){
   const message=readableError(e);
   if(message.includes('Доступ к игре закрыт преподавателем')){
    // Read current identity only after the blocked login; no polling.
    const active=await supabase.auth.getSession();
    if(active.data.session?.user?.id)setBlockedIdentity(active.data.session.user.id);
   }
   setError(message);
  }finally{unlockEntry()}
 }

 // Re-enter by the already authenticated identity, not by name or a shared
 // classroom invitation. This works for anonymous sessions in the same browser
 // as well as permanent student accounts; it never creates a new Auth user.
 async function resumeExistingParticipant(){
  if(!lockEntry())return;
  setReturningGames([]);
  try{
   const {data:auth,error:authError}=await supabase.auth.getSession();
   if(authError)throw authError;
   const userId=auth.session?.user?.id;
   if(!userId){
    setMode('student');setTeacherLogin(false);setPersonalLogin(true);
    setError('В этом браузере нет действующей сессии. Войдите с личной почтой и паролем, чтобы вернуть свою игру.');
    return;
   }
   if(!auth.session!.user.is_anonymous){
    const {data:teacherProfile,error:teacherError}=await supabase.from('teacher_profiles')
     .select('user_id').eq('user_id',userId).maybeSingle();
    if(teacherError)throw teacherError;
    if(teacherProfile){
     setTeacherLogin(true);setPersonalLogin(true);
     setError('Это учётная запись преподавателя. Используйте отдельный кабинет преподавателя.');
     return;
    }
   }
   // Both related tables enforce membership RLS; revoked/archived accounts
   // must not appear. The teacher remains in the separate protected cabinet.
   const {data:rows,error:membersError}=await supabase.from('game_members')
    .select('game_id,kind,games!inner(title,game_code)')
    .eq('user_id',userId).in('kind',['student','observer'])
    .is('roster_archived_at',null).limit(20);
   if(membersError)throw membersError;
   const memberships=(rows??[]) as Array<{game_id:string;kind:'student'|'observer';games:Array<{title:string;game_code:string}>}>;
   const available=memberships.flatMap(row=>{
    const game=row.games?.[0];
    return game?.game_code&&row.game_id
     ?[{id:row.game_id,kind:row.kind,code:game.game_code,title:game.title||game.game_code}]
     :[];
   });
   if(available.length===1){
    saveSuccessfulGameCode(available[0].code);
    router.push('/game/'+available[0].id+incomingSectionSuffix());
   }else if(available.length>1){
    setReturningGames(available);
   }else{
    setTeacherLogin(false);setPersonalLogin(true);
    setError('Активных игр для этой учётной записи не найдено. Если Вы уже участвовали, войдите со своей личной почтой и паролем. Преподаватель входит через отдельный кабинет.');
   }
  }catch(e){setError(readableError(e))}
  finally{unlockEntry()}
 }

 function openAuthorizedGame(gameId:string){
  const section=incomingSectionSuffix();
  if(window.location.hostname?.endsWith('.github.io')){
   window.location.assign('/gos-sim1/?game='+encodeURIComponent(gameId)+(section?'&'+section.slice(1):''));
  }else router.push('/game/'+encodeURIComponent(gameId)+section);
 }
 function saveRememberPreference(){
  try{
   if(rememberMe)window.localStorage.setItem('gos-id:remembered-login-email',loginEmail.trim().toLowerCase());
   else window.localStorage.removeItem('gos-id:remembered-login-email');
  }catch{/* Access to storage is optional; the browser password manager is separate. */}
 }
 async function login(e:FormEvent){
  e.preventDefault();if(!lockEntry())return;
  let phase:'authentication'|'session'|'game'='authentication';
  try{
   if(typeof navigator!=='undefined'&&!navigator.onLine)throw new Error('Устройство не подключено к интернету. Проверьте сеть.');
   // Password authentication never uses an old stored refresh token.
   // A fresh client preserves the bounded retry only for transient Auth failures.
   let authError:unknown=null,session:null|{access_token:string;refresh_token:string}=null,userId='';
   const loginClient=createPasswordAuthClient();
   for(let attempt=0;attempt<2;attempt++){
    const auth=await loginClient.auth.signInWithPassword({email:loginEmail.trim().toLowerCase(),password:loginPassword});
    if(!auth.error&&auth.data.session){
     authError=null;
     session={access_token:auth.data.session.access_token,refresh_token:auth.data.session.refresh_token};
     userId=auth.data.session.user?.id||auth.data.user?.id||'';
     break;
    }
    authError=auth.error||new Error('Сервер авторизации не вернул сессию.');
    if(!isTransientAuthError(authError)||attempt===1)throw authError;
    await new Promise(resolve=>setTimeout(resolve,900));
   }
   if(authError||!session||!userId)throw authError||new Error('Не удалось подтвердить личность пользователя.');
   phase='session';
   for(let attempt=0;attempt<2;attempt++){
    const adopted=await supabase.auth.setSession(session);
    if(!adopted.error)break;
    if(!isTransientAuthError(adopted.error)||attempt===1)throw adopted.error;
    await new Promise(resolve=>setTimeout(resolve,900));
   }
   phase='game';
   // The teacher role is read from the protected profile, never inferred from
   // the email, the selected role on the landing page or mutable user_metadata.
   const profile=await supabase.from('teacher_profiles')
    .select('last_game_id').eq('user_id',userId).maybeSingle();
   if(profile.error)throw profile.error;
   if(profile.data){
    const index=await supabase.rpc('list_my_teacher_games');
    if(index.error)throw index.error;
    const teacherGames=((index.data as {games?:Array<{id:string;status:string}>}|null)?.games||[])
     .filter(game=>game?.id&&game.status!=='archived');
    if(teacherGames.length===0){
     saveRememberPreference();
     router.push('/teacher');
     return;
    }
    let remembered='';
    try{remembered=window.localStorage.getItem('gos-id:teacher-last-game')||''}catch{}
    const target=teacherGames.find(game=>game.id===profile.data.last_game_id)
     ||teacherGames.find(game=>game.id===remembered)||teacherGames[0];
    // This RPC verifies the server-side membership and does not grant arbitrary
    // teacher rights. The game list must also contain the selected game.
    const access=await supabase.rpc('ensure_my_game_access',{p_game:target.id});
    if(access.error)throw access.error;
    if(target.id!==profile.data.last_game_id){
     const saved=await supabase.from('teacher_profiles').update({last_game_id:target.id}).eq('user_id',userId);
     if(saved.error)throw saved.error;
    }
    try{window.localStorage.setItem('gos-id:teacher-last-game',target.id)}catch{}
    saveRememberPreference();
    openAuthorizedGame(target.id);
    return;
   }
   // Returning participants and guests use the same two-field form. Only
   // their own unarchived memberships are candidates for direct navigation.
   const membership=await supabase.from('game_members')
    .select('game_id,kind,joined_at').eq('user_id',userId)
    .in('kind',['student','observer']).is('roster_archived_at',null)
    .order('joined_at',{ascending:false}).limit(20);
   if(membership.error)throw membership.error;
   const games=membership.data||[];
   if(games.length===0)throw new Error('Для этой учётной записи не найдена активная игра. Обратитесь к преподавателю.');
   let preferred='';
   try{preferred=window.localStorage.getItem('gos-id:last-member-game:'+userId)||''}catch{}
   const selected=games.find(item=>item.game_id===preferred)||games[0];
   if(!selected?.game_id)throw new Error('Не удалось определить доступную игру.');
   try{window.localStorage.setItem('gos-id:last-member-game:'+userId,selected.game_id)}catch{}
   saveRememberPreference();
   openAuthorizedGame(selected.game_id);
  }catch(e){
   setError((phase==='authentication'?'Проверка учётной записи: ':phase==='session'?'Проверка сессии: ':'Открытие игровой сессии: ')+readableError(e));
  }finally{unlockEntry()}
 }
 async function recover(){
  if(!loginEmail.includes('@')){setError('Укажите почту, к которой привязана ваша учётная запись.');return}
  if(!lockEntry())return;setRecoverySent(false);
  try{
   // On GitHub Pages the recovery route is served by the Next.js application, not the static shell.
   const origin=(process.env.NEXT_PUBLIC_GAME_API_ORIGIN||
    (window.location.hostname.endsWith('.github.io')?'https://gos-sim1.vercel.app':window.location.origin)).replace(/[/]$/,'');
   const r=await supabase.auth.resetPasswordForEmail(loginEmail.trim().toLowerCase(),{redirectTo:origin+'/auth/update-password'});
   if(r.error)setError(readableError(r.error));else setRecoverySent(true);
  }catch(e){setError(readableError(e))}
  finally{unlockEntry()}
 }
 if(reentryState!=='idle')return <main className="participantReentryScreen">
  <section className="surface participantReentryCard" role={reentryState==='error'?'alert':'status'}>
   <div className="participantReentryBrand"><BrandIdentity tagline/></div>
   <h1>Восстановление доступа к игре</h1>
   <p>{reentryState==='pending'?'Проверяем персональную ссылку преподавателя и открываем Ваш профиль…':reentryError}</p>
   {reentryState==='pending'?<span className="spinner" aria-hidden="true"/>:<>
    <p>Если ссылка использована или срок её действия истёк, обратитесь к преподавателю за новой.</p>
    <button type="button" className="primary" onClick={()=>window.location.reload()}>Повторить проверку</button>
   </>}
  </section>
 </main>;
 return <main className="entryPage">
  <a className="skipLink" href="#entry-form">Перейти ко входу</a>
  <header className="entryHeader"><a className="wordmark" href="/" aria-label={BRAND_NAME+" — главная"}><BrandIdentity tagline/></a><span className="entryEdition">Лаборатория государственного управления <i>2026</i></span></header>
  <div className="entryGrid">
   <section className="entryStory" aria-labelledby="entry-title">
    <div className="entryEyebrow"><span/>Учебная игра · ГМУ</div>
    <h1 id="entry-title">Государство<br/>начинается<br/><em>с вашего решения.</em></h1>
    <p className="entryLead">Создавайте партии. Принимайте законы. Договаривайтесь о будущем. Пройдите путь от первого политического союза до управления целой республикой.</p>
    <div className="entryVisual"><CivicArtwork/><div className="entryVisualCaption"><span>{BRAND_NAME} // {BRAND_TAGLINE}</span><ArrowUpRight aria-hidden="true"/></div></div>
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
      {(mode==='student'||mode==='guest')&&<>
       <button type="button" className="entryPersonalSwitch entryResumeButton" disabled={busy} onClick={resumeExistingParticipant}><ArrowRight size={17}/> Я уже участвую — продолжить игру</button>
       {returningGames.length>1&&<div className="entryRememberedGameField" aria-label="Выбор своей игры">
        <strong>Ваши доступные игры</strong>
        {returningGames.map(game=><button key={game.id} type="button" className="entryPersonalSwitch" disabled={busy} onClick={()=>{
         saveSuccessfulGameCode(game.code);router.push('/game/'+game.id+incomingSectionSuffix());
        }}>{game.title} · {game.code} · {game.kind==='observer'?'Гость':'Участник'}</button>)}
       </div>}
      </>}
      {error&&<div className="errorBox" role="alert">{error}{blockedIdentity&&<p className="entryBlockedIdentity">Передайте преподавателю идентификатор для восстановления доступа: <code>{blockedIdentity}</code></p>}</div>}
      <button className="primary entrySubmit" disabled={busy}>{busy?<><LoaderCircle className="spin" aria-hidden="true"/>Подключаемся…</>:<>{mode==='teacher'&&createMode?'Создать игру':'Войти в игру'}<ArrowRight aria-hidden="true"/></>}</button>
     </fieldset>
     <GameEntryQr/>
     <div className="entryPrivacy"><LockKeyhole aria-hidden="true"/><p>ФИО будет видно участникам и преподавателю. Ваши действия сохраняются в протоколе игры.</p></div>
    </form>}
    {fromSharedLink&&<p className="entryLinkAdvice">Ссылка из Телеграма открывает нужный раздел без повторного входа только в браузере, где Вы уже авторизованы. Если Телеграм открыл отдельное окно, выберите в его меню «Открыть в браузере» и используйте ссылку там. Данные для входа по ссылке не передаются.</p>}
    {personalLogin&&<form id="entry-form" className="entryForm" onSubmit={login} aria-busy={busy}>
     <div className="entryFormIntro"><span className="overline">ЛИЧНАЯ УЧЁТНАЯ ЗАПИСЬ</span><h2>Войти с личным паролем</h2><p>Введите почту и личный пароль. ГОС.ID откроет игру, доступную Вашей учётной записи, с сохранением Ваших полномочий.</p></div>
     <button type="button" className="entryPersonalSwitch" onClick={()=>{setPersonalLogin(false);setTeacherLogin(false);setError('')}}><LockKeyhole size={16}/> Первый вход по приглашению</button>
     <fieldset disabled={busy}>
      <legend className="srOnly">Данные личной учётной записи</legend>
      <label className="entryField">Электронная почта<input required type="email" autoComplete={rememberMe?'username':'off'} value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} placeholder="Ваш адрес почты"/></label>
      <label className="entryField">Личный пароль<input required type="password" autoComplete={rememberMe?'current-password':'off'} value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} placeholder="Ваш личный пароль"/></label>
      <label className="entryRememberMe"><input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)}/><span>Запомнить меня</span></label>
      <p className="entryRememberHelp">Почта сохранится на этом устройстве. Пароль может запомнить только менеджер паролей браузера — ГОС.ID его не сохраняет.</p>
      {error&&<div className="errorBox" role="alert">{error}</div>}
      {recoverySent&&<div className="entryRecoveryNotice" role="status">Если этот адрес привязан к игре, письмо со ссылкой для смены пароля будет отправлено.</div>}
      <button type="submit" className="primary entrySubmit" disabled={busy}>{busy?'Проверка…':'Войти в мою игру'}<ArrowRight size={18}/></button>
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
