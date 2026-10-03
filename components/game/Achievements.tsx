'use client';
import Image from 'next/image';
import {useEffect,useRef,useState} from 'react';
import {Award,CheckCircle2,LockKeyhole,Sparkles,Trophy,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';

export type Achievement={id:string;title:string;description:string;hidden:boolean;earned_at:string|null;progress:number};

function medalSrc(id:string,earned:boolean){
 return (process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'')+'/medals/'+id+(earned?'':'-locked')+'.svg';
}

export function Medal({id,title,earned=true}:{id:string;title:string;earned?:boolean}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[id,earned]);
 return <span className={'achievementMedal '+(earned?'is-earned':'is-locked')}>
  {failed?<Award className="achievementMedalFallback" aria-label={title}/>:<Image unoptimized src={medalSrc(id,earned)} alt={title} width={256} height={256} loading="lazy" onError={()=>setFailed(true)}/>}
 </span>;
}

function boundedProgress(value:number){
 if(!Number.isFinite(value))return 0;
 return Math.max(0,Math.min(100,value));
}

export function AwardShelf({gameId,userId,showCatalog=true}:{gameId:string;userId:string;showCatalog?:boolean}){
 const [items,setItems]=useState<Achievement[]>([]);
 const [filter,setFilter]=useState<'earned'|'open'>('earned');
 const [error,setError]=useState('');
 const [counts,setCounts]=useState({total:100,open:60,hidden:40});

 useEffect(()=>{if(!showCatalog)setFilter('earned')},[showCatalog]);
 useEffect(()=>{
  let live=true;
  async function load(){
   const [r,c]=await Promise.all([
    supabase.rpc('get_game_achievements',{p_game_id:gameId,p_user_id:userId}),
    supabase.rpc('get_achievement_catalog_counts',{p_game_id:gameId})
   ]);
   if(!live)return;
   if(r.error)setError(userError(r.error));
   else{
    setItems(r.data||[]);
    if(!c.error&&c.data)setCounts(c.data);
    setError('');
   }
  }
  void load();
  const timer=setInterval(()=>void load(),30000);
  return()=>{live=false;clearInterval(timer)};
 },[gameId,userId]);

 const earned=items.filter(x=>x.earned_at);
 const hiddenEarned=earned.filter(x=>x.hidden);
 const shown=filter==='earned'?earned:items.filter(x=>!x.hidden);
 const collectionProgress=counts.total?Math.round(earned.length/counts.total*100):0;

 return <section className="awardShelf steamAwards surface">
  <header className="awardShelfHeader">
   <div className="awardShelfIntro">
    <small>ДОСТИЖЕНИЯ GOS//SIMS</small>
    <h2><Trophy size={24}/> Награды</h2>
    <p>Полученные достижения и доступные условия. Награды не изменяют ВСН.</p>
   </div>
   <div className="awardCollectionSummary">
    <div><strong>{earned.length}</strong><span>из {counts.total}</span><b>{collectionProgress}%</b></div>
    <div className="awardCollectionTrack" role="progressbar" aria-label="Прогресс коллекции" aria-valuemin={0} aria-valuemax={100} aria-valuenow={collectionProgress}><i style={{width:collectionProgress+'%'}}/></div>
   </div>
   {showCatalog?<nav className="awardShelfTabs" aria-label="Показать награды">
    <button type="button" aria-pressed={filter==='earned'} onClick={()=>setFilter('earned')}>Полученные <b>{earned.length}</b></button>
    <button type="button" aria-pressed={filter==='open'} onClick={()=>setFilter('open')}>Все доступные <b>{counts.open}</b></button>
   </nav>:<span className="awardEarnedCount">{earned.length} получено</span>}
  </header>

  {error&&<p className="awardError" role="alert">{error}</p>}
  {!shown.length&&filter==='earned'&&<div className="awardEmpty"><Award size={28}/><div><b>Пока нет открытых достижений</b><span>Они появятся здесь после выполнения игровых условий.</span></div></div>}

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

  {showCatalog&&<div className="awardSecrets"><LockKeyhole size={20}/><div><b>{Math.max(0,counts.hidden-hiddenEarned.length)} секретных достижений скрыто</b><span>Как в Steam: название и условие появятся только после открытия.</span></div></div>}
 </section>;
}

export function AchievementCelebration({gameId,userId,enabled}:{gameId:string;userId?:string;enabled:boolean}){
 const [award,setAward]=useState<Achievement|null>(null);
 const [error,setError]=useState('');
 const active=useRef(false);

 useEffect(()=>{
  active.current=false;setAward(null);setError('');
  if(!enabled||!userId)return;
  let live=true;
  const running={current:false};
  async function check(){
   if(!live||running.current||active.current||document.visibilityState==='hidden')return;
   running.current=true;
   try{
    const a=await supabase.rpc('evaluate_game_achievements',{p_game_id:gameId});
    if(!live)return;
    if(a.error){setError(userError(a.error));return}
    const r=await supabase.rpc('claim_achievement_notification',{p_game_id:gameId});
    if(!live)return;
    if(r.error){setError(userError(r.error));return}
    if(r.data){active.current=true;setAward(r.data);setError('')}
   }catch(e){if(live)setError(userError(e))}
   finally{running.current=false}
  }
  void check();
  const timer=setInterval(()=>void check(),15000);
  return()=>{live=false;clearInterval(timer)};
 },[gameId,userId,enabled]);

 function close(){active.current=false;setAward(null)}
 useEffect(()=>{if(!award)return;const timer=setTimeout(close,7000);return()=>clearTimeout(timer)},[award?.id]);

 if(!enabled)return null;
 if(!award)return error?<p className="awardConnectionNotice" role="status">Награды: {error}</p>:null;

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
