'use client';
import {useCallback,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowRight,BookOpenText,LogOut,PlusCircle,RefreshCcw,ShieldCheck} from 'lucide-react';
import {BRAND_NAME,BrandIdentity} from '@/components/ui/BrandIdentity';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import './teacher-portal.css';

type GameRow={id:string;title:string;status:string;created_at:string};
type TeacherIndex={is_admin:boolean;games:GameRow[]};
export default function TeacherPortal(){
 const router=useRouter();
 const [index,setIndex]=useState<TeacherIndex|null>(null);
 const [loading,setLoading]=useState(true);
 const [opening,setOpening]=useState<string|null>(null);
 const [error,setError]=useState('');
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
  }catch(e){setError(userError(e)||'Не удалось открыть кабинет преподавателя.');setIndex(null)}
  finally{setLoading(false)}
 },[router]);
 useEffect(()=>{void refresh()},[refresh]);
 async function openGame(id:string){
  if(opening)return;
  setOpening(id);setError('');
  try{
   // Only a backend-authorized teacher/admin can use this function; never
   // trust local UI state or the selected game ID as an access grant.
   const r=await supabase.rpc('ensure_my_game_access',{p_game:id});
   if(r.error)throw r.error;
   router.push('/game/'+encodeURIComponent(id));
  }catch(e){setError(userError(e)||'Нет доступа к выбранной игре.');setOpening(null)}
 }
 async function signOut(){
  setOpening('logout');
  const r=await supabase.auth.signOut();
  if(r.error){setError(userError(r.error)||'Не удалось выйти.');setOpening(null);return}
  router.replace('/?teacher=1');
 }
 return <main className="teacherPortal">
  <header className="teacherPortalHeader">
   <a href="/" className="teacherPortalWordmark" aria-label={BRAND_NAME+' — главная'}><BrandIdentity tagline/></a>
   <button type="button" onClick={()=>void signOut()} disabled={!!opening} className="teacherPortalLogout"><LogOut size={17}/> Выйти</button>
  </header>
  <div className="teacherPortalContent">
   <div className="teacherPortalEyebrow"><ShieldCheck size={16}/> ЛИЧНАЯ УЧЁТНАЯ ЗАПИСЬ</div>
   <h1>Кабинет преподавателя</h1>
   <p className="teacherPortalIntro">Вход по личной почте и паролю. Коды игр и приглашения для доступа к кабинету не требуются.</p>
   <div className="teacherPortalActions">
    <button type="button" onClick={()=>void refresh()} disabled={loading||!!opening}><RefreshCcw size={17}/> Обновить список</button>
    <a className="teacherPortalPrimary" href="/?teacher=create"><PlusCircle size={18}/> Создать игру</a>
   </div>
   {error&&<p className="teacherPortalError" role="alert">{error}</p>}
   {loading&&<p role="status" className="teacherPortalMessage">Загружаем доступные игры…</p>}
   {!loading&&index&&<>
    <div className="teacherPortalSectionHead">
     <h2>Мои игры</h2>
     <span>{index.games.length} {index.games.length===1?'игра':'игр'}</span>
    </div>
    {!index.games.length&&<div className="teacherPortalEmpty"><BookOpenText size={34}/><h3>Игр пока нет</h3>
     <p>Кабинет доступен независимо от запущенных сеансов. Создайте новую учебную игру, когда она понадобится.</p>
     <a href="/?teacher=create">Создать первую игру <ArrowRight size={17}/></a>
    </div>}
    {!!index.games.length&&<div className="teacherPortalGames">
     {index.games.map(game=><article key={game.id} className="teacherPortalGame">
      <div className="teacherPortalGameTop"><span className="teacherPortalGameStatus">{game.status==='archived'?'Архив':game.status==='active'?'Активна':'Игра'}</span>
       <time dateTime={game.created_at}>{Number.isNaN(Date.parse(game.created_at))?'':new Date(game.created_at).toLocaleDateString('ru-RU')}</time></div>
      <h3>{game.title}</h3>
      <button type="button" className="teacherPortalGameOpen" onClick={()=>void openGame(game.id)} disabled={!!opening}>
       {opening===game.id?'Открываем…':'Открыть игру'} <ArrowRight size={17}/>
      </button>
     </article>)}
    </div>}
   </>}
   {!loading&&!index&&<a className="teacherPortalBack" href="/?teacher=1">Вернуться ко входу преподавателя</a>}
  </div>
 </main>;
}
