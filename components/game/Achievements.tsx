'use client';
import Image from 'next/image';
import {useEffect,useId,useRef,useState} from 'react';
import {Award,CheckCircle2,ChevronDown,LockKeyhole,Sparkles,Trophy,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {publicAchievementPreview} from './achievementPreview';

export type Achievement={id:string;title:string;description:string;hidden:boolean;earned_at:string|null;progress:number;checked_at?:string|null};

// The daily snapshot becomes available at 04:00 in Novosibirsk (21:00 UTC).
export function achievementRefreshDay(now=Date.now()){
 return new Date(now+3*60*60*1000).toISOString().slice(0,10);
}

export function watchAchievementMorningRefresh(refresh:()=>void){
 let day=achievementRefreshDay(),timer:ReturnType<typeof setTimeout>,disposed=false;
 function schedule(){
  const next=Date.parse(achievementRefreshDay()+'T21:00:00Z');
  timer=setTimeout(check,next-Date.now()+15000+Math.floor(Math.random()*45000));
 }
 function check(){
  clearTimeout(timer);
  if(disposed)return;
  const current=achievementRefreshDay();
  if(document.visibilityState==='visible'&&current!==day){day=current;refresh()}
  schedule();
 }
 function visible(){
  if(document.visibilityState!=='visible'||achievementRefreshDay()===day)return;
  clearTimeout(timer);timer=setTimeout(check,15000+Math.floor(Math.random()*45000));
 }
 schedule();document.addEventListener('visibilitychange',visible);
 return()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible)};
}

function medalSrc(id:string){
 return (process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'')+'/medals/'+id+'.svg?v=20261003';
}

export function Medal({id,title,earned=true}:{id:string;title:string;earned?:boolean}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[id,earned]);
 return <span className={'achievementMedal '+(earned?'is-earned':'is-locked')}>
  {failed?<Award className="achievementMedalFallback" aria-label={title}/>:<Image unoptimized src={medalSrc(id)} alt={title} width={512} height={512} loading="lazy" onError={()=>setFailed(true)}/>}
 </span>;
}

function boundedProgress(value:number){
 if(!Number.isFinite(value))return 0;
 return Math.max(0,Math.min(100,value));
}

export function AwardShelf({gameId,userId,showCatalog=true,previewOnly=false,defaultCollapsed=false}:{gameId:string;userId:string;showCatalog?:boolean;previewOnly?:boolean;defaultCollapsed?:boolean}){
 const [items,setItems]=useState<Achievement[]>([]);
 const [filter,setFilter]=useState<'earned'|'open'>('earned');
 const [error,setError]=useState('');
 const [expanded,setExpanded]=useState(!defaultCollapsed);
 const contentId=useId();
 const [counts,setCounts]=useState({total:100,open:60,hidden:40});
 const [loadedScope,setLoadedScope]=useState('');
 const [checkedAt,setCheckedAt]=useState<string|null>(null);
 const scope=gameId+':'+userId+':'+previewOnly;

 useEffect(()=>setFilter('earned'),[gameId,userId,previewOnly,showCatalog]);
 useEffect(()=>setExpanded(!defaultCollapsed),[gameId,userId,defaultCollapsed]);
 useEffect(()=>{
  let live=true,running=false,viewerId:string|null|undefined;
  setItems([]);setLoadedScope('');setCheckedAt(null);setError('');
  async function load(){
   if(!live||running)return;
   running=true;
   try{
   const [r,c]=await Promise.all([
    supabase.rpc('get_game_achievements',{p_game_id:gameId,p_user_id:userId}),
    supabase.rpc('get_achievement_catalog_counts',{p_game_id:gameId})
   ]);
   if(!live)return;
   if(r.error)setError(userError(r.error));
   else{
    setItems(previewOnly?publicAchievementPreview((r.data||[]) as Achievement[]):r.data||[]);
    setLoadedScope(scope);setCheckedAt(r.data?.[0]?.checked_at||null);
    if(!c.error&&c.data)setCounts(c.data);
    setError('');
   }
   }catch(e){if(live)setError(userError(e))}
   finally{running=false}
  }
  void load();
  const stopMorning=watchAchievementMorningRefresh(()=>void load());
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
   const next=session?.user.id||null;
   if(event==='SIGNED_OUT'||viewerId!==undefined&&next!==viewerId){
    live=false;stopMorning();setItems([]);setLoadedScope('');setCheckedAt(null);setError('');
   }
   viewerId=next;
  });
  return()=>{live=false;stopMorning();subscription.unsubscribe()};
 },[gameId,userId,previewOnly]);

 const scopedItems=loadedScope===scope?items:[];
 const visibleItems=previewOnly?publicAchievementPreview(scopedItems):scopedItems;
 const earned=visibleItems.filter(x=>x.earned_at);
 const hiddenEarned=earned.filter(x=>x.hidden);
 const shown=filter==='earned'?earned:visibleItems.filter(x=>!x.hidden||!!x.earned_at);
 const collectionProgress=counts.total?Math.round(earned.length/counts.total*100):0;
 const catalogCount=counts.open+hiddenEarned.length;

 return <section className="awardShelf steamAwards surface">
  <header className="awardShelfHeader">
   <div className="awardShelfIntro">
    <small>ДОСТИЖЕНИЯ ГОС.ID</small>
    <h2><Trophy size={24}/> Награды</h2>
    <p>Достижения обновляются ночью с 03:00 до 04:00 по Новосибирску. Результаты сегодняшней игры появятся здесь утром. Награды не изменяют ВСН.</p>
    {!previewOnly&&loadedScope===scope&&<p>{checkedAt?'Последнее обновление: '+new Date(checkedAt).toLocaleString('ru-RU',{timeZone:'Asia/Novosibirsk',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})+' (Новосибирск).':'Первое обновление достижений ещё не завершено.'}</p>}
    {defaultCollapsed&&<div className="awardShelfActions">
     <button type="button" className="awardShelfToggle" aria-expanded={expanded} aria-controls={contentId} onClick={()=>{if(!expanded)setFilter('earned');setExpanded(open=>!open)}}>{expanded?'Свернуть награды':'Показать награды'}<ChevronDown size={16} className={expanded?'is-expanded':''} aria-hidden="true"/></button>
     {showCatalog&&!expanded&&<button type="button" className="awardShelfCatalogButton" aria-expanded={expanded} aria-controls={contentId} onClick={()=>{setFilter('open');setExpanded(true)}}>Все награды <Award size={16} aria-hidden="true"/></button>}
    </div>}
    {previewOnly&&<p role="status">Демонстрационный профиль: показаны условия открытых наград. Начисления и прогресс появятся у реальных участников.</p>}
   </div>
   <div className="awardCollectionSummary">
    <div><strong>{earned.length}</strong><span>из {counts.total}</span><b>{collectionProgress}%</b></div>
    <div className="awardCollectionTrack" role="progressbar" aria-label="Прогресс коллекции" aria-valuemin={0} aria-valuemax={100} aria-valuenow={collectionProgress}><i style={{width:collectionProgress+'%'}}/></div>
   </div>
   {showCatalog&&expanded?<nav className="awardShelfTabs" aria-label="Показать награды">
    <button type="button" aria-pressed={filter==='earned'} onClick={()=>setFilter('earned')}>Полученные <b>{earned.length}</b></button>
    <button type="button" aria-pressed={filter==='open'} onClick={()=>setFilter('open')}>Все награды <b>{catalogCount}</b></button>
   </nav>:null}
  </header>

  {error&&<p className="awardError" role="alert">{error}</p>}
  <div id={contentId} hidden={!expanded}>
  {!shown.length&&filter==='earned'&&<div className="awardEmpty"><Award size={28}/><div><b>Пока нет открытых достижений</b><span>Достижения появятся после ночного обновления, когда выполнены игровые условия.</span></div></div>}

  <div className="awardGrid">
   {shown.map(a=>{
    const unlocked=!!a.earned_at;
    const progress=boundedProgress(Number(a.progress));
    return <article key={a.id} className={'awardItem '+(unlocked?'earned':'unearned')}>
     <Medal id={a.id} title={a.title} earned={unlocked}/>
     <div className="awardItemCopy">
      <div className="awardItemTitle">
       <h3>{a.title}</h3>
       {a.hidden&&<span className="awardSecretMark" title="Секретное достижение"><Sparkles size={13}/> Секрет</span>}
      </div>
      <p>{a.description}</p>
      {!unlocked&&<div className="awardProgressRow">
       <div className="awardProgress" role="progressbar" aria-label={'Прогресс достижения «'+a.title+'»'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{width:progress+'%'}}/></div>
       <b>{Math.floor(progress)}%</b>
      </div>}
     </div>
     <div className="awardItemMeta">
      {unlocked?<><CheckCircle2 size={16}/><span>Получено</span><time>{new Date(a.earned_at!).toLocaleDateString('ru-RU')}</time></>:<><span>В процессе</span><b>{Math.floor(progress)}%</b></>}
     </div>
    </article>;
   })}
  </div>

  {showCatalog&&<div className="awardSecrets"><LockKeyhole size={20}/><div><b>{Math.max(0,counts.hidden-hiddenEarned.length)} секретных достижений скрыто</b><span>По правилам скрытых достижений название и условие появятся после открытия.</span></div></div>}
  </div>
 </section>;
}

export function AchievementCelebration({gameId,userId,enabled}:{gameId:string;userId?:string;enabled:boolean}){
 const [award,setAward]=useState<Achievement|null>(null);
 const [awardScope,setAwardScope]=useState('');
 const active=useRef(false);

 useEffect(()=>{
  active.current=false;setAward(null);
  if(!enabled||!userId)return;
  let live=true;
  const receiptKey='gos:achievement-notice:'+gameId+':'+userId;
  let checkedDay='';
  const running={current:false};
  async function check(){
   if(!live||running.current||active.current||document.visibilityState==='hidden')return;
   const day=achievementRefreshDay();
   if(checkedDay===day)return;
   try{if(window.sessionStorage.getItem(receiptKey)===day)return}catch{}
   checkedDay=day;
   try{window.sessionStorage.setItem(receiptKey,day)}catch{/* One attempt per mounted session if storage is unavailable. */}
   running.current=true;
   try{
    const r=await supabase.rpc('claim_achievement_notification',{p_game_id:gameId});
    if(!live)return;
    if(r.error)return;
    if(r.data){active.current=true;setAwardScope(gameId+':'+userId);setAward(r.data)}
   }catch{/* Rewards are optional: connection failures must not cover game controls. */}
   finally{running.current=false}
  }
  let firstClaim=setTimeout(()=>void check(),3000+Math.floor(Math.random()*17000));
  const stopMorning=watchAchievementMorningRefresh(()=>void check());
  const resume=()=>{
   if(document.visibilityState!=='visible')return;
   clearTimeout(firstClaim);firstClaim=setTimeout(()=>void check(),3000+Math.floor(Math.random()*17000));
  };
  document.addEventListener('visibilitychange',resume);
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
   if(event==='SIGNED_OUT'||session&&session.user.id!==userId){
    live=false;clearTimeout(firstClaim);stopMorning();active.current=false;setAward(null);
    try{window.sessionStorage.removeItem(receiptKey)}catch{}
   }
  });
  return()=>{live=false;clearTimeout(firstClaim);stopMorning();document.removeEventListener('visibilitychange',resume);subscription.unsubscribe()};
 },[gameId,userId,enabled]);

 function close(){active.current=false;setAward(null)}
 useEffect(()=>{if(!award)return;const timer=setTimeout(close,7000);return()=>clearTimeout(timer)},[award?.id]);

 if(!enabled)return null;
 if(!award||awardScope!==gameId+':'+userId)return null;

 return <aside className="achievementBurst steamAchievementToast" role="status" aria-live="polite">
  <Medal id={award.id} title={award.title} earned/>
  <div>
   <small>{award.hidden?'Секретное достижение открыто':'Достижение открыто'}</small>
   <h2>{award.title}</h2>
   <p>{award.description}</p>
  </div>
  <button type="button" aria-label="Закрыть уведомление" onClick={close}><X size={17}/></button>
 </aside>;
}
