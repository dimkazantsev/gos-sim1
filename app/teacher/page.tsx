'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {ArrowRight,BookOpenText,LogOut,PlusCircle,RefreshCcw,ShieldCheck} from 'lucide-react';
import {BRAND_NAME,BrandIdentity} from '@/components/ui/BrandIdentity';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {STAGE_OPERATIONS} from '@/components/game/stageOperations';
import './teacher-portal.css';

type GameRow={id:string;title:string;status:string;created_at:string};
type TeacherIndex={is_admin:boolean;games:GameRow[]};
type TeacherProfile={full_name:string;bio:string|null;gender:string|null;avatar_path:string|null;signature_path:string|null;last_game_id?:string|null};
const LAST_GAME_KEY='gos-id:teacher-last-game';
export default function TeacherPortal(){
 const router=useRouter();
 const [index,setIndex]=useState<TeacherIndex|null>(null);
 const [loading,setLoading]=useState(true);
 const [opening,setOpening]=useState<string|null>(null);
 const [error,setError]=useState('');
 const [profile,setProfile]=useState<TeacherProfile|null>(null);
 const [name,setName]=useState(''),[bio,setBio]=useState('');
 const [savingProfile,setSavingProfile]=useState(false);
 const navigating=useRef(false);
 const selecting=typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('choose')==='1';
 function rememberAndGo(id:string){
  if(navigating.current)return;
  navigating.current=true;
  try{window.localStorage.setItem(LAST_GAME_KEY,id)}catch{}
  if(window.location.hostname.endsWith('.github.io'))window.location.assign('/gos-sim1/?game='+encodeURIComponent(id));
  else router.replace('/game/'+encodeURIComponent(id));
 }
 const refresh=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const auth=await supabase.auth.getSession();
   if(auth.error)throw auth.error;
   if(!auth.data.session?.user){router.replace('/?teacher=1');return}
   const response=await supabase.rpc('list_my_teacher_games');
   if(response.error)throw response.error;
   const payload=response.data as TeacherIndex|null;
   if(!payload||!Array.isArray(payload.games))throw Error('Сервер не вернул список игр.');
   setIndex(payload);
   const saved=await supabase.from('teacher_profiles').select('full_name,bio,gender,avatar_path,signature_path,last_game_id')
    .eq('user_id',auth.data.session.user.id).maybeSingle();
   if(!saved.error&&saved.data){
    const p=saved.data as TeacherProfile;setProfile(p);setName(p.full_name||'');setBio(p.bio||'');
   }
   if(!selecting&&payload.games.length){
    let last='';try{last=window.localStorage.getItem(LAST_GAME_KEY)||''}catch{}
    const game=payload.games.find(x=>x.id===last)||payload.games.find(x=>x.id===saved.data?.last_game_id)||payload.games.find(x=>x.status!=='archived')||payload.games[0];
    const access=await supabase.rpc('ensure_my_game_access',{p_game:game.id});
    if(access.error)throw access.error;
    rememberAndGo(game.id);
    return;
   }
  }catch(e){setError(userError(e)||'Не удалось открыть кабинет преподавателя.');setIndex(null)}
  finally{setLoading(false)}
 },[router,selecting]);
 useEffect(()=>{void refresh()},[refresh]);
 async function openGame(id:string){
  if(opening)return;
  setOpening(id);setError('');
  try{
   // Only a backend-authorized teacher/admin can use this function; never
   // trust local UI state or the selected game ID as an access grant.
   const r=await supabase.rpc('ensure_my_game_access',{p_game:id});
   if(r.error)throw r.error;
   const auth=await supabase.auth.getSession();
   if(auth.data.session?.user){
    const preference=await supabase.from('teacher_profiles').update({last_game_id:id})
      .eq('user_id',auth.data.session.user.id);
    if(preference.error)console.warn('Не удалось сохранить последнюю выбранную игру');
   }
   rememberAndGo(id);
  }catch(e){setError(userError(e)||'Нет доступа к выбранной игре.');setOpening(null)}
 }
 async function archiveGame(id:string){
  if(opening||!window.confirm('Архивировать игру? Все документы, этапы, оценки и результаты сохранятся, а действия участников будут остановлены.'))return;
  setOpening(id);setError('');
  try{
   const result=await supabase.rpc('archive_my_teacher_game',{p_game:id});
   if(result.error)throw result.error;
   await refresh();
  }catch(e){setError(userError(e)||'Не удалось архивировать игру.')}
  finally{setOpening(null)}
 }
 async function savePermanentProfile(){
  if(!profile||savingProfile)return;setSavingProfile(true);setError('');
  try{
   const auth=await supabase.auth.getSession();if(!auth.data.session?.user)throw Error('Требуется вход');
   const r=await supabase.from('teacher_profiles').update({full_name:name.trim(),bio:bio.trim()||null,updated_at:new Date().toISOString()})
    .eq('user_id',auth.data.session.user.id).select('full_name,bio,gender,avatar_path,signature_path').single();
   if(r.error)throw r.error;setProfile(r.data as TeacherProfile);
  }catch(e){setError(userError(e)||'Не удалось сохранить профиль преподавателя.')}
  finally{setSavingProfile(false)}
 }
 async function signOut(){
  setOpening('logout');
  const r=await supabase.auth.signOut();
  if(r.error){setError(userError(r.error)||'Не удалось выйти.');setOpening(null);return}
  router.replace('/?teacher=1');
 }
 return <main className="teacherPortal">
  <header className="teacherPortalHeader">
   <Link href="/" className="teacherPortalWordmark" aria-label={BRAND_NAME+' — главная'}><BrandIdentity tagline/></Link>
   <button type="button" onClick={()=>void signOut()} disabled={!!opening} className="teacherPortalLogout"><LogOut size={17}/> Выйти</button>
  </header>
  <div className="teacherPortalContent">
   <div className="teacherPortalEyebrow"><ShieldCheck size={16}/> ЛИЧНАЯ УЧЁТНАЯ ЗАПИСЬ</div>
   <h1>Кабинет преподавателя</h1>
   <p className="teacherPortalIntro">{!index?'Восстанавливаем личный профиль и последнюю игру.':index.games.length?'Выберите игру. При обычном входе последняя игра открывается сразу.':'Постоянный профиль доступен без созданных игр. Данные Вашей учётной записи сохраняются независимо от игровых сессий.'}</p>
   <div className="teacherPortalActions">
    <button type="button" onClick={()=>void refresh()} disabled={loading||!!opening}><RefreshCcw size={17}/> Обновить</button>
    <Link className="teacherPortalPrimary" href="/?teacher=create"><PlusCircle size={18}/> Создать игру</Link>
   </div>
   {error&&<p className="teacherPortalError" role="alert">{error}</p>}
   {loading&&<p role="status" className="teacherPortalMessage">Загружаем доступные игры…</p>}
   {!loading&&index&&<>
    <div className="teacherPortalSectionHead">
     <h2>Мои игры</h2>
     <span>{index.games.length} {index.games.length===1?'игра':'игр'}</span>
    </div>
    {!index.games.length&&<div className="teacherPortalEmpty"><BookOpenText size={34}/><h3>Активных игр пока нет</h3>
     <p>Личная учётная запись, профиль и структура всех этапов доступны без игрового сеанса.</p>
     <Link href="/?teacher=create">Создать игру <ArrowRight size={17}/></Link>
    </div>}
    {!!index.games.length&&<div className="teacherPortalGames">
     {index.games.map(game=><article key={game.id} className="teacherPortalGame">
      <div className="teacherPortalGameTop"><span className="teacherPortalGameStatus">{game.status==='archived'?'Архив':game.status==='active'?'Активна':'Игра'}</span>
       <time dateTime={game.created_at}>{Number.isNaN(Date.parse(game.created_at))?'':new Date(game.created_at).toLocaleDateString('ru-RU')}</time></div>
      <h3>{game.title}</h3>
      <button type="button" className="teacherPortalGameOpen" onClick={()=>void openGame(game.id)} disabled={!!opening}>
       {opening===game.id?'Открываем…':'Открыть игру'} <ArrowRight size={17}/>
      </button>
      {game.status!=='archived'&&<button type="button" className="teacherPortalArchive" disabled={!!opening} onClick={()=>void archiveGame(game.id)}>Архивировать без удаления данных</button>}
     </article>)}
    </div>}
    {!index.games.length&&<section className="teacherPermanentStages" aria-label="Все этапы ГОС.ID">
      <h2>Этапы ГОС.ID</h2>
      <div className="teacherPermanentStageGrid">{Array.from({length:16},(_,i)=>i+1).map(no=><div key={no}>
       <span>{String(no).padStart(2,'0')}</span><b>{STAGE_OPERATIONS[no].title}</b>
      </div>)}</div>
     </section>}
    {profile&&<section className="teacherPermanentProfile" aria-label="Постоянный профиль преподавателя">
     <h2>Постоянный профиль</h2>
     <p>Профиль сохраняется независимо от игровых сеансов. Изменения ФИО и биографии доступны здесь даже без игры.</p>
     <label>Фамилия, имя и отчество<input value={name} onChange={e=>setName(e.target.value)} maxLength={180}/></label>
     <label>Биография<textarea value={bio} onChange={e=>setBio(e.target.value)} rows={3} maxLength={5000}/></label>
     <button type="button" disabled={savingProfile||name.trim().length<4} onClick={()=>void savePermanentProfile()}>{savingProfile?'Сохранение…':'Сохранить профиль'}</button>
    </section>}
   </>}
   {!loading&&!index&&<Link className="teacherPortalBack" href="/?teacher=1">Вернуться ко входу преподавателя</Link>}
  </div>
 </main>;
}
