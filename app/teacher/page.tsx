'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {BookOpenText,Camera,ChevronLeft,ChevronRight,FileText,GraduationCap,GripVertical,Landmark,LayoutDashboard,LogOut,Menu,Radio,Settings2,UserRound,Vote as VoteIcon,Wallet} from 'lucide-react';
import {BrandIdentity} from '@/components/ui/BrandIdentity';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import TeacherGameSessions from '@/components/game/TeacherGameSessions';
import SignatureUpload from '@/components/game/SignatureUpload';
import ProfileAvatar from '@/components/game/ProfileAvatar';
import {cropPortrait} from '@/components/game/avatarCrop';
import {savePermanentTeacherAsset,teacherAssetUrl} from '@/components/game/teacherAccountAssets';
import {STAGE_OPERATIONS} from '@/components/game/stageOperations';
import './teacher-portal.css';

type Profile={full_name:string;bio:string|null;gender:'male'|'female'|'unspecified'|null;avatar_path:string|null;signature_path:string|null};
type Section='dashboard'|'stages'|'actions'|'parties'|'votes'|'documents'|'budget'|'teacher'|'profile';
const SECTIONS:{id:Section;label:string;icon:typeof LayoutDashboard}[]=[
 {id:'dashboard',label:'Обзор игры',icon:LayoutDashboard},
 {id:'stages',label:'Этапы и задачи',icon:BookOpenText},
 {id:'actions',label:'Политический процесс',icon:Radio},
 {id:'parties',label:'Партии',icon:Landmark},
 {id:'votes',label:'Голосования',icon:VoteIcon},
 {id:'documents',label:'Реестр НПА',icon:FileText},
 {id:'budget',label:'Бюджет',icon:Wallet},
 {id:'teacher',label:'Управление',icon:Settings2},
 {id:'profile',label:'Мой профиль',icon:UserRound}
];
function initials(name:string){return name.trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()||'П'}
export default function TeacherPortal(){
 const router=useRouter();
 const [userId,setUserId]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [profile,setProfile]=useState<Profile|null>(null),[name,setName]=useState(''),[bio,setBio]=useState('');
 const [gender,setGender]=useState<'male'|'female'|'unspecified'>('unspecified');
 const [avatarUrl,setAvatarUrl]=useState<string|null>(null),[signatureUrl,setSignatureUrl]=useState<string|null>(null);
 const [saveBusy,setSaveBusy]=useState(false),[photoBusy,setPhotoBusy]=useState(false),[notice,setNotice]=useState('');
 const [mobileOpen,setMobileOpen]=useState(false),[section,setSection]=useState<Section>('profile');
 const [stageNo,setStageNo]=useState<number|null>(null);
 const photoInput=useRef<HTMLInputElement>(null);
 const authorized=!!userId&&!!profile;
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const auth=await supabase.auth.getSession();
   if(auth.error)throw auth.error;
   const uid=auth.data.session?.user?.id;
   if(!uid||auth.data.session?.user.is_anonymous){router.replace('/?teacher=1');return}
   // All permissions come from the server; never infer a teacher from an email or user metadata.
   const permitted=await supabase.rpc('list_my_teacher_games');
   if(permitted.error)throw permitted.error;
   const data=permitted.data as {games?:unknown[]}|null;
   if(!Array.isArray(data?.games))throw Error('Доступ подтверждается только для преподавателя.');
   let result=await supabase.from('teacher_profiles').select('full_name,bio,gender,avatar_path,signature_path')
    .eq('user_id',uid).maybeSingle();
   if(result.error)throw result.error;
   if(!result.data){
    const created=await supabase.from('teacher_profiles').insert({user_id:uid,full_name:'Преподаватель'})
     .select('full_name,bio,gender,avatar_path,signature_path').single();
    if(created.error)throw created.error;
    result={...result,data:created.data};
   }
   const p=result.data as Profile;
   setUserId(uid);setProfile(p);setName(p.full_name);setBio(p.bio||'');setGender(p.gender||'unspecified');
   const [avatar,signature]=await Promise.all([teacherAssetUrl(p.avatar_path),teacherAssetUrl(p.signature_path)]);
   setAvatarUrl(avatar);setSignatureUrl(signature);
  }catch(e){setError(userError(e)||'Не удалось открыть постоянный профиль преподавателя.')}
  finally{setLoading(false)}
 },[router]);
 useEffect(()=>{void load()},[load]);
 async function saveProfile(){
  if(!authorized||saveBusy||name.trim().length<4)return;
  setSaveBusy(true);setNotice('');setError('');
  try{
   const update=await supabase.from('teacher_profiles')
    .update({full_name:name.trim(),bio:bio.trim()||null,gender,updated_at:new Date().toISOString()})
    .eq('user_id',userId).select('full_name,bio,gender,avatar_path,signature_path').single();
   if(update.error)throw update.error;
   setProfile(update.data as Profile);setNotice('Личные данные преподавателя сохранены.');
  }catch(e){setError(userError(e))}
  finally{setSaveBusy(false)}
 }
 async function saveSignature(file:File){
  if(!authorized)return false;
  setNotice('');setError('');
  try{
   const saved=await savePermanentTeacherAsset(userId,file,'signature');
   setSignatureUrl(saved.url);setProfile(p=>p?{...p,signature_path:saved.path}:p);
   setNotice('Подпись сохранена в постоянном профиле и доступна во всех играх.');
   return true;
  }catch(e){setError(userError(e));return false}
 }
 async function uploadPhoto(file:File|undefined){
  if(!file||!authorized||photoBusy)return;
  if(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)){
   setError('Фотография должна быть PNG, JPEG или WebP не более 5 МБ.');return;
  }
  setPhotoBusy(true);setError('');setNotice('');
  try{
   const cropped=await cropPortrait(file);
   const saved=await savePermanentTeacherAsset(userId,cropped,'avatar');
   setAvatarUrl(saved.url);setProfile(p=>p?{...p,avatar_path:saved.path}:p);
   setNotice('Фотография сохранена в постоянном профиле и доступна во всех играх.');
  }catch(e){setError(userError(e))}
  finally{setPhotoBusy(false)}
 }
 async function logout(){await supabase.auth.signOut();router.replace('/?teacher=1')}
 function choose(id:Section){setSection(id);setStageNo(null);setMobileOpen(false)}
 if(loading)return <main className="connectionPage"><section className="connectionCard" role="status"><BrandIdentity tagline/><h1>Открываем ГОС.ID</h1><p>Загружаем постоянный профиль преподавателя.</p></section></main>;
 if(!authorized)return <main className="connectionPage"><section className="connectionCard" role="alert"><BrandIdentity tagline/><h1>Не удалось открыть профиль преподавателя</h1><p>{error||'Не удалось подтвердить доступ.'}</p><button type="button" className="primary" onClick={()=>void load()}>Повторить</button></section></main>;
 const stages=Array.from({length:16},(_,i)=>({no:i+1,...STAGE_OPERATIONS[i+1]}));
 const label=SECTIONS.find(s=>s.id===section)?.label||'Мой профиль';
 return <div className="simShell teacherZeroShell">
  <a className="skipLink" href="#game-main">Перейти к содержимому</a>
  <aside className="simSidebar">
   <div className="sidebarBrand"><BrandIdentity tagline/></div>
   <section className="sidebarStage teacherZeroStage">
    <div className="sidebarStageNumber">00</div>
    <div><small>ПОСТОЯННАЯ СРЕДА</small><b>Нулевая игра</b></div>
    <span className="paused">Без сеанса</span>
   </section>
   <nav className="focusNav" aria-label="Разделы ГОС.ID"><div className="focusNavInner">
    {SECTIONS.map(item=><button type="button" key={item.id} className={section===item.id?'active':''} onClick={()=>choose(item.id)} aria-current={section===item.id?'page':undefined}>
     <span className="sidebarDragHandle" aria-hidden="true"><GripVertical size={15}/></span>
     <item.icon aria-hidden="true"/><span className="sidebarRouteLabel">{item.label}</span>
    </button>)}
   </div></nav>
   <div className="sidebarFooter"><div className="sidebarUser sidebarUserTeacher">
    <div className="simAvatar">{initials(name)}</div>
    <div className="simUserText"><b title={name}>{name}</b><span>Преподаватель</span></div>
    <button type="button" className="sidebarIconButton" title="Мои игры · Профиль" aria-label="Мои игры и профиль" onClick={()=>choose('profile')}><Landmark/></button>
    <button type="button" className="sidebarIconButton" aria-label="Выйти" onClick={()=>void logout()}><LogOut/></button>
   </div></div>
  </aside>
  <div className="simWorkspace">
   <header className="simTop">
    <div className="mobileBrand"><BrandIdentity tagline/></div>
    <nav className="topScreenHistory" aria-label="История разделов"><button className="screenHistoryButton" type="button" aria-label="Вернуться к профилю" disabled={section==='profile'} onClick={()=>choose('profile')}><ChevronLeft/></button><button className="screenHistoryButton" type="button" disabled aria-label="Следующий раздел"><ChevronRight/></button></nav>
    <div className="simTopCenter"><div className="topStageCopy"><small>ПОСТОЯННЫЙ КАБИНЕТ</small><strong>{label}</strong></div><div className="topIndicators"><span className="livePill off"><Radio aria-hidden="true"/><span className="livePillText">Игра не создана</span></span></div></div>
    <button type="button" className="teacherZeroMobileMenu" aria-expanded={mobileOpen} aria-label="Разделы" onClick={()=>setMobileOpen(v=>!v)}><Menu size={21}/></button>
   </header>
   {mobileOpen&&<nav className="teacherZeroMobileNavigation" aria-label="Разделы ГОС.ID">{SECTIONS.map(item=><button type="button" key={item.id} onClick={()=>choose(item.id)} aria-current={section===item.id?'page':undefined}><item.icon size={19}/>{item.label}</button>)}</nav>}
   <div className="simContentFlow"><main id="game-main" tabIndex={-1} className="simMain">
    {error&&<p className="teacherZeroError" role="alert">{error}</p>}
    {notice&&<p className="teacherZeroNotice" role="status">{notice}</p>}
    {section==='profile'?<div className="profilePage">
     <section className="profileHero">
      <div className="profilePhoto">
       <ProfileAvatar src={avatarUrl} name={profile.full_name} gender={gender}/>
       <input hidden type="file" accept="image/png,image/jpeg,image/webp" ref={photoInput} aria-label="Загрузить фотографию профиля" onChange={e=>{void uploadPhoto(e.target.files?.[0]);e.target.value=''}}/>
       <button type="button" className="profileCameraButton" aria-label="Изменить фотографию" title="Изменить фотографию" disabled={photoBusy} onClick={()=>photoInput.current?.click()}><Camera size={20}/></button>
      </div>
      <div className="profileIntro"><small>ЛИЧНЫЙ КАБИНЕТ</small><h1>{profile.full_name}</h1><p>Преподаватель</p>
       <div className="profileChips"><span>Преподаватель</span></div>
       <div className="profileHeroControls"><button type="button" onClick={()=>document.getElementById('teacher-game-sessions')?.scrollIntoView({behavior:'smooth',block:'start'})}><Landmark size={17}/>Мои игры · Создать игру</button></div>
      </div>
     </section>
     <div className="profileGrid teacherZeroProfileGrid">
      <article className="surface profileEditor" id="profile-setup-editor">
       <div className="surfaceHead"><div><small>О СЕБЕ</small><h2>Игровая визитка</h2></div></div>
       <label className="profileFullNameField">Фамилия, имя и отчество<input autoComplete="name" maxLength={180} value={name} onChange={e=>setName(e.target.value)}/></label>
       <p className="profileHint">Эти данные и личные файлы сохраняются за учётной записью и используются во всех играх.</p>
       <label className="teacherZeroGender">Пол для оформления аватара<select value={gender} onChange={e=>setGender(e.target.value as typeof gender)}><option value="unspecified">Не указан</option><option value="male">Мужской</option><option value="female">Женский</option></select></label>
       <textarea aria-label="О себе" rows={3} maxLength={350} value={bio} onChange={e=>setBio(e.target.value)}/>
       <div className="profileSaveRow"><button type="button" className="primary" disabled={saveBusy||name.trim().length<4} onClick={()=>void saveProfile()}>{saveBusy?'Сохраняем…':'Сохранить визитку'}</button><span>{bio.length}/350</span></div>
       <SignatureUpload account={{signatureUrl,saveSignature}}/>
      </article>
     </div>
     <TeacherGameSessions displayName={profile.full_name}/>
    </div>:section==='stages'?<section className="teacherZeroPanel surface">
     <small>ЭТАПЫ И ЗАДАЧИ</small><h1>Все 16 этапов</h1><p>Этапы доступны для просмотра. До создания игровой сессии участники, решения и результаты отсутствуют.</p>
     <div className="teacherEmptyStageGrid">{stages.map(item=><button type="button" key={item.no} className={stageNo===item.no?'selected':''} onClick={()=>setStageNo(v=>v===item.no?null:item.no)}><span>{String(item.no).padStart(2,'0')}</span><b>{item.title}</b><small>{stageNo===item.no?item.action:'Не запущен'}</small></button>)}</div>
    </section>:<section className="teacherZeroPanel surface">
      <small>ПОСТОЯННАЯ СРЕДА ГОС.ID</small><h1>{label}</h1>
      <p>Игровых данных нет: сеанс не создан или не выбран. Сведения о других играх сюда не переносятся.</p>
      <button type="button" className="primary" onClick={()=>choose('profile')}>Мои игры · Создать игру</button>
      {section==='dashboard'&&<div className="teacherEmptyQuickStats">{[['0','Участников'],['0','Документов'],['0','Голосований'],['0','Игровых событий']].map(([value,title])=><article key={title}><strong>{value}</strong><span>{title}</span></article>)}</div>}
    </section>}
   </main></div>
  </div>
 </div>;
}
