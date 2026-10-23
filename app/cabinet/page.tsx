'use client';

import {FormEvent,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowRight,ArrowLeft,Plus,LogOut,Landmark,LockKeyhole} from 'lucide-react';
import {BrandIdentity,BRAND_NAME,BRAND_TAGLINE} from '@/components/ui/BrandIdentity';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {rememberGameCode} from '@/lib/rememberedGameCodes';
import './cabinet.css';

type ManagedGame={
 id:string;title:string;game_code:string;status:string;created_at:string;
};
type TeacherGames={allowed:boolean;admin:boolean;games:ManagedGame[]};
const statusLabels:Record<string,string>={lobby:'Подготовка',active:'Идёт игра',paused:'Приостановлена',completed:'Завершена',archived:'Архив'};

export default function TeacherCabinet(){
 const router=useRouter();
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 const [error,setError]=useState(''),[data,setData]=useState<TeacherGames|null>(null);
 const [createOpen,setCreateOpen]=useState(false);
 const [fullName,setFullName]=useState('');
 const [title,setTitle]=useState(''),[gameCode,setGameCode]=useState(''),[teacherCode,setTeacherCode]=useState(''),[studentCode,setStudentCode]=useState('');
 useEffect(()=>{
  let active=true;
  void (async()=>{
   try{
    const userResult=await supabase.auth.getUser();
    if(!active)return;
    if(userResult.error||!userResult.data.user){router.replace('/?teacher=1');return}
    const name=userResult.data.user.user_metadata?.full_name;
    if(typeof name==='string')setFullName(name);
    const result=await supabase.rpc('get_my_teacher_games');
    if(!active)return;
    if(result.error)throw result.error;
    if(!result.data?.allowed)throw new Error('Доступ разрешён только преподавателю или администратору.');
    setData(result.data as TeacherGames);
   }catch(err){if(active)setError(userError(err)||'Не удалось открыть кабинет.')}
   finally{if(active)setLoading(false)}
  })();
  return()=>{active=false};
 },[router]);
 async function createGame(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(saving)return;
  setError('');
  if(!title.trim()||!fullName.trim()||gameCode.trim().length<2){setError('Заполните название, код игры и ФИО преподавателя.');return}
  if(teacherCode.length<4||studentCode.length<4||teacherCode===studentCode){
   setError('Приглашения должны содержать не менее четырёх символов и различаться.');return
  }
  setSaving(true);
  try{
   const result=await supabase.rpc('create_teacher_game_session',{
    p_title:title.trim(),p_game_code:gameCode.trim().toUpperCase(),
    p_teacher_code:teacherCode,p_student_code:studentCode,p_teacher_name:fullName.trim()
   });
   if(result.error)throw result.error;
   if(!result.data)throw new Error('Сервер не подтвердил создание игры.');
   rememberGameCode(gameCode.trim());
   router.push('/game/'+String(result.data));
  }catch(err){setError(userError(err)||'Не удалось создать игру.')}
  finally{setSaving(false)}
 }
 async function leave(){
  await supabase.auth.signOut();
  router.replace('/');
 }
 return <main className="entryPage teacherCabinetPage">
  <header className="entryHeader">
   <div className="wordmark"><BrandIdentity tagline/></div>
   <button type="button" className="teacherCabinetExit" onClick={()=>void leave()}><LogOut size={17}/> Выйти</button>
  </header>
  <section className="teacherCabinetMain">
   <div className="teacherCabinetHeading">
    <span className="overline">ГОС.ID · ЛИЧНЫЙ КАБИНЕТ</span>
    <h1>Кабинет преподавателя</h1>
    <p>Управляйте своими играми и создавайте новые. Для входа в кабинет код игры не требуется.</p>
   </div>
   {loading&&<div className="entryForm teacherCabinetNotice" role="status">Проверяем учётную запись и доступные игры…</div>}
   {!loading&&error&&<div className="errorBox" role="alert">{error}</div>}
   {!loading&&data&&<div className="teacherCabinetLayout">
    <section className="entryForm teacherCabinetGames" aria-label="Мои игры">
     <div className="teacherCabinetSectionHead">
      <div><span className="overline">УПРАВЛЕНИЕ</span><h2>Мои игры</h2></div>
      <button type="button" className="primary teacherCabinetAdd" onClick={()=>{setCreateOpen(x=>!x);setError('')}} aria-expanded={createOpen}>
       {createOpen?<ArrowLeft size={17}/>:<Plus size={17}/>} {createOpen?'Скрыть форму':'Создать игру'}
      </button>
     </div>
     {data.games.length===0
      ?<div className="teacherCabinetEmpty"><Landmark size={28}/><h3>Пока нет игр</h3><p>Создайте первую игру: задайте название, её код и приглашения для преподавателя и участников.</p></div>
      :<div className="teacherCabinetList">{data.games.map(game=><div className="teacherCabinetGame" key={game.id}>
       <div><h3>{game.title}</h3><span>Код игры: {game.game_code} · {statusLabels[game.status]||game.status}</span></div>
       <button type="button" onClick={()=>router.push('/game/'+game.id)}>Открыть <ArrowRight size={17}/></button>
      </div>)}</div>}
    </section>
    {createOpen&&<form className="entryForm teacherCabinetNewGame" onSubmit={e=>void createGame(e)} aria-busy={saving}>
     <div className="entryFormIntro"><span className="overline">НОВЫЙ СЕАНС</span><h2>Создать игру</h2><p>Коды нужны для приглашения участников, а не для входа в кабинет.</p></div>
     <fieldset disabled={saving}>
      <label className="entryField">Название игры<input value={title} onChange={e=>setTitle(e.target.value)} minLength={2} maxLength={160} required placeholder="Название учебной игры"/></label>
      <label className="entryField">Код игры<input value={gameCode} onChange={e=>setGameCode(e.target.value)} minLength={2} maxLength={40} required autoCapitalize="characters" autoComplete="off" placeholder="Например, ИГРА-2026"/></label>
      <label className="entryField">ФИО преподавателя<input value={fullName} onChange={e=>setFullName(e.target.value)} minLength={2} required autoComplete="name" placeholder="Фамилия Имя Отчество"/></label>
      <label className="entryField">Приглашение преподавателя<input type="password" value={teacherCode} onChange={e=>setTeacherCode(e.target.value)} minLength={4} required autoComplete="new-password" placeholder="Код доступа преподавателя"/></label>
      <label className="entryField">Приглашение участников<input type="password" value={studentCode} onChange={e=>setStudentCode(e.target.value)} minLength={4} required autoComplete="new-password" placeholder="Код доступа участников"/></label>
      <button className="primary entrySubmit" type="submit" disabled={saving}>{saving?'Создаём игру…':'Создать и открыть игру'}<ArrowRight size={18}/></button>
     </fieldset>
    </form>}
    <p className="teacherCabinetSecurity"><LockKeyhole size={16}/> Создание и просмотр игр доступны только учётным записям с подтверждёнными полномочиями преподавателя или администратора.</p>
   </div>}
   {!loading&&!data&&<button type="button" className="teacherCabinetExit" onClick={()=>router.replace('/?teacher=1')}><ArrowLeft size={17}/> Вернуться ко входу</button>}
  </section>
  <footer className="entryFooter"><span>{BRAND_NAME} · {BRAND_TAGLINE}</span><span>Управление учебными играми</span></footer>
 </main>
}
