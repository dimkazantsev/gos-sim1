'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {BookOpenText,FileText,Landmark,LayoutDashboard,LogOut,Menu,Settings2,ShieldCheck,UserRound,Users,Vote as VoteIcon,Wallet,Radio} from 'lucide-react';
import {BrandIdentity} from '@/components/ui/BrandIdentity';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import TeacherGameSessions from '@/components/game/TeacherGameSessions';
import {STAGE_OPERATIONS} from '@/components/game/stageOperations';
import './teacher-portal.css';

type Game={id:string;title:string;status:string;created_at:string};
type TeacherIndex={games:Game[];is_admin:boolean};
type Profile={full_name:string;bio:string|null;last_game_id:string|null};
const LAST_GAME_KEY='gos-id:teacher-last-game';
type Section='dashboard'|'stages'|'votes'|'documents'|'parties'|'budget'|'teacher'|'profile';
const SECTIONS:{id:Section;label:string;icon:typeof LayoutDashboard}[]=[
 {id:'dashboard',label:'Обзор игры',icon:LayoutDashboard},
 {id:'stages',label:'Этапы и задачи',icon:BookOpenText},
 {id:'parties',label:'Партии и фракции',icon:Landmark},
 {id:'votes',label:'Голосования',icon:VoteIcon},
 {id:'documents',label:'Реестр НПА',icon:FileText},
 {id:'budget',label:'Бюджет',icon:Wallet},
 {id:'teacher',label:'Управление',icon:Settings2},
 {id:'profile',label:'Мой профиль',icon:UserRound}
];
export default function TeacherPortal(){
 const router=useRouter(),redirecting=useRef(false);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const [profile,setProfile]=useState<Profile|null>(null);
 const [name,setName]=useState(''),[bio,setBio]=useState('');
 const [saving,setSaving]=useState(false),[mobileOpen,setMobileOpen]=useState(false);
 const [section,setSection]=useState<Section>('stages');
 const [stageNo,setStageNo]=useState<number|null>(null);
 function openGame(id:string){
  if(redirecting.current)return;
  redirecting.current=true;
  try{window.localStorage.setItem(LAST_GAME_KEY,id)}catch{}
  if(window.location.hostname.endsWith('.github.io'))window.location.replace('/gos-sim1/?game='+encodeURIComponent(id));
  else router.replace('/game/'+encodeURIComponent(id));
 }
 const refresh=useCallback(async()=>{
  setError('');setLoading(true);
  try{
   const auth=await supabase.auth.getSession();
   if(auth.error)throw auth.error;
   if(!auth.data.session?.user){router.replace('/?teacher=1');return}
   const response=await supabase.rpc('list_my_teacher_games');
   if(response.error)throw response.error;
   const value=response.data as TeacherIndex;
   if(!value||!Array.isArray(value.games))throw Error('Не удалось проверить права преподавателя.');
   const info=await supabase.from('teacher_profiles').select('full_name,bio,last_game_id')
    .eq('user_id',auth.data.session.user.id).maybeSingle();
   if(info.error)throw info.error;
   const p=info.data as Profile|null;
   if(p){setProfile(p);setName(p.full_name||'');setBio(p.bio||'')}
   if(value.games.length){
    let last='';try{last=window.localStorage.getItem(LAST_GAME_KEY)||''}catch{}
    const selected=value.games.find(g=>g.id===last)||value.games.find(g=>g.id===p?.last_game_id)
      ||value.games.find(g=>g.status!=='archived')||value.games[0];
    const access=await supabase.rpc('ensure_my_game_access',{p_game:selected.id});
    if(access.error)throw access.error;
    openGame(selected.id);return;
   }
  }catch(e){setError(userError(e)||'Не удалось открыть постоянную игровую среду.')}
  finally{setLoading(false)}
 },[router]);
 useEffect(()=>{void refresh()},[refresh]);
 async function saveProfile(){
  if(!profile||saving||name.trim().length<4)return;
  setSaving(true);setError('');
  try{
   const auth=await supabase.auth.getSession();
   if(!auth.data.session?.user)throw Error('Требуется личный вход.');
   const data=await supabase.from('teacher_profiles')
    .update({full_name:name.trim(),bio:bio.trim()||null,updated_at:new Date().toISOString()})
    .eq('user_id',auth.data.session.user.id).select('full_name,bio,last_game_id').single();
   if(data.error)throw data.error;setProfile(data.data as Profile);
  }catch(e){setError(userError(e))}
  finally{setSaving(false)}
 }
 async function logout(){await supabase.auth.signOut();router.replace('/?teacher=1')}
 function choose(id:Section){setSection(id);setStageNo(null);setMobileOpen(false)}
 if(loading)return <main className="connectionPage"><section className="connectionCard" role="status"><BrandIdentity tagline/><h1>Открываем игровую среду ГОС.ID</h1><p>Проверяем личный вход и доступные игры.</p></section></main>;
 if(error&&!profile)return <main className="connectionPage"><section className="connectionCard" role="alert"><BrandIdentity tagline/><h1>Не удалось открыть игру</h1><p>{error}</p><button className="primary" onClick={()=>void refresh()}>Повторить</button></section></main>;
 const stages=Array.from({length:16},(_,i)=>({no:i+1,...STAGE_OPERATIONS[i+1]}));
 return <div className="teacherEmptyShell">
  <aside className="teacherEmptySidebar" aria-label="Разделы ГОС.ID">
   <div className="sidebarBrand"><BrandIdentity tagline/></div>
   <div className="teacherEmptyScope"><small>ТЕКУЩАЯ ИГРА</small><b>Игровая среда</b><span>Сеанс не создан</span></div>
   <nav className="teacherEmptyNav">{SECTIONS.map(item=><button type="button" key={item.id} className={section===item.id?'active':''} onClick={()=>choose(item.id)} aria-current={section===item.id?'page':undefined}>
    <item.icon size={19} aria-hidden="true"/>{item.label}
   </button>)}</nav>
   <div className="teacherEmptyAccount"><div className="simAvatar">{(name||'П').slice(0,1)}</div><div><b title={name}>{name||'Преподаватель'}</b><small>Преподаватель</small></div><button type="button" onClick={()=>choose('profile')} title="Открыть профиль" aria-label="Открыть профиль"><UserRound size={17}/></button><button type="button" onClick={()=>void logout()} title="Выйти" aria-label="Выйти"><LogOut size={17}/></button></div>
  </aside>
  <div className="teacherEmptyWorkspace">
   <header className="teacherEmptyTop">
    <div className="teacherEmptyMobileBrand"><BrandIdentity tagline/></div>
    <button type="button" className="teacherEmptyMobileMenu" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(v=>!v)} aria-label="Открыть разделы"><Menu size={20}/></button>
    <div className="teacherEmptyTopText"><small>ГОС.ID · ПОСТОЯННЫЙ КАБИНЕТ</small><b>{SECTIONS.find(x=>x.id===section)?.label}</b></div>
    <span className="teacherEmptyState"><ShieldCheck size={16}/>Профиль сохранён</span>
   </header>
   {mobileOpen&&<nav className="teacherEmptyMobileNavigation" aria-label="Мобильная навигация">{SECTIONS.map(item=><button type="button" key={item.id} onClick={()=>choose(item.id)}><item.icon size={17}/>{item.label}</button>)}</nav>}
   <main className="teacherEmptyMain">
    {error&&<p className="teacherEmptyError" role="alert">{error}</p>}
    {section==='profile'?<section className="teacherEmptyProfile">
     <div className="teacherEmptyIntro"><small>ЛИЧНАЯ УЧЁТНАЯ ЗАПИСЬ</small><h1>Мой профиль</h1><p>Постоянные данные преподавателя сохраняются даже без созданных игр. Новые игры и сессии создаются здесь.</p></div>
     <div className="teacherEmptyProfileFields">
      <label>Фамилия, имя и отчество<input value={name} onChange={e=>setName(e.target.value)} maxLength={180}/></label>
      <label>О себе<textarea rows={4} value={bio} onChange={e=>setBio(e.target.value)} maxLength={5000}/></label>
      <button type="button" className="primary" disabled={saving||name.trim().length<4} onClick={()=>void saveProfile()}>{saving?'Сохранение…':'Сохранить постоянный профиль'}</button>
     </div>
     <TeacherGameSessions displayName={name}/>
    </section>:section==='stages'?<section className="teacherEmptyStages">
     <div className="teacherEmptyIntro"><small>ЭТАПЫ И ЗАДАЧИ</small><h1>Все 16 этапов</h1><p>Игровые этапы доступны для ознакомления. После создания сессии они откроются в рабочем режиме с участниками, документами и голосованиями.</p></div>
     <div className="teacherEmptyStageGrid">{stages.map(item=><button type="button" key={item.no} className={stageNo===item.no?'selected':''} onClick={()=>setStageNo(stageNo===item.no?null:item.no)}>
      <span>{String(item.no).padStart(2,'0')}</span><b>{item.title}</b><small>{stageNo===item.no?item.action:'Не запущен'}</small>
     </button>)}</div>
    </section>:<section className="teacherEmptyOverview">
     <div className="teacherEmptyIntro"><small>ГОС.ID · ИГРОВАЯ СРЕДА</small><h1>{SECTIONS.find(x=>x.id===section)?.label}</h1><p>Игровых данных пока нет. Постоянный кабинет и структура всех 16 этапов доступны независимо от создания учебной игры.</p></div>
     <div className="teacherEmptyOverviewActions"><button type="button" className="primary" onClick={()=>choose('stages')}><BookOpenText size={18}/>Все этапы</button><button type="button" className="secondary" onClick={()=>choose('profile')}><Users size={18}/>Создать игру в профиле</button></div>
     <div className="teacherEmptyQuickStats"><article><strong>16</strong><span>Этапов</span></article><article><strong>0</strong><span>Участников</span></article><article><strong>0</strong><span>Голосований</span></article><article><strong>0</strong><span>Документов</span></article></div>
    </section>}
   </main>
  </div>
 </div>;
}
