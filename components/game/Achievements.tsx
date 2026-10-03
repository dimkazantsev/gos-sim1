'use client';
import Image from 'next/image';
import {useEffect,useRef,useState} from 'react';
import {Award,CheckCircle2,CircleDotDashed,LockKeyhole,Sparkles,Trophy,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';

export type Achievement={id:string;title:string;description:string;hidden:boolean;earned_at:string|null;progress:number};

function achievementHash(id:string){
 let hash=2166136261;
 for(let i=0;i<id.length;i++){hash^=id.charCodeAt(i);hash=Math.imul(hash,16777619)}
 return hash>>>0;
}

function visualVars(id:string){
 const hash=achievementHash(id);
 const hue=hash%360;
 const secondary=(hue+42+(hash%73))%360;
 const tertiary=(hue+186+(hash%41))%360;
 return {
  style:{
   '--award-accent':`hsl(${hue} 92% 62%)`,
   '--award-accent-2':`hsl(${secondary} 88% 65%)`,
   '--award-accent-3':`hsl(${tertiary} 82% 61%)`,
   '--award-deep':`hsl(${hue} 48% 13%)`,
   '--award-shift':`${18+(hash%64)}%`,
  } as React.CSSProperties,
  pattern:String(hash%6),
 };
}

function medalSrc(id:string){
 return (process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'')+'/medals/'+id+'.svg';
}

export function Medal({id,title}:{id:string;title:string}){
 const [failed,setFailed]=useState(false);
 const {style}=visualVars(id);
 return <span className="achievementMedal" style={style}>
  <span className="achievementMedalGlow" aria-hidden="true"/>
  {failed?<Award className="achievementMedalFallback" aria-label={title}/>:<Image unoptimized src={medalSrc(id)} alt={title} width={256} height={280} loading="lazy" onError={()=>setFailed(true)}/>}
 </span>;
}

export function AchievementArtwork({id,title,earned,secret=false,compact=false}:{id:string;title:string;earned:boolean;secret?:boolean;compact?:boolean}){
 const {style,pattern}=visualVars(id);
 const serial=id.match(/\d+/)?.[0]||id.toUpperCase();
 return <div className={'achievementArtwork '+(earned?'is-earned':'is-locked')+(compact?' is-compact':'')} style={style} data-pattern={pattern}>
  <span className="achievementArtworkMesh" aria-hidden="true"/>
  <span className="achievementArtworkFlare" aria-hidden="true"/>
  <span className="achievementArtworkBrand">{secret?<><LockKeyhole size={13}/> SECRET</>:<>GOS//SIMS</>}</span>
  <span className="achievementArtworkSerial">A-{serial}</span>
  <Medal id={id} title={title}/>
 </div>;
}

function boundedProgress(value:number){
 if(!Number.isFinite(value))return 0;
 return Math.max(0,Math.min(100,value));
}

export function AwardShelf({gameId,userId,showCatalog=true}:{gameId:string;userId:string;showCatalog?:boolean}){
 const [items,setItems]=useState<Achievement[]>([]),[filter,setFilter]=useState<'earned'|'open'>('earned'),[error,setError]=useState(''),[counts,setCounts]=useState({total:100,open:60,hidden:40});
 useEffect(()=>{if(!showCatalog)setFilter('earned')},[showCatalog]);
 useEffect(()=>{let live=true;async function load(){const [r,c]=await Promise.all([supabase.rpc('get_game_achievements',{p_game_id:gameId,p_user_id:userId}),supabase.rpc('get_achievement_catalog_counts',{p_game_id:gameId})]);if(!live)return;if(r.error)setError(userError(r.error));else{setItems(r.data||[]);if(!c.error&&c.data)setCounts(c.data);setError('')}}void load();const timer=setInterval(()=>void load(),30000);return()=>{live=false;clearInterval(timer)}},[gameId,userId]);
 const earned=items.filter(x=>x.earned_at),hiddenEarned=earned.filter(x=>x.hidden),shown=filter==='earned'?earned:items.filter(x=>!x.hidden);
 const collectionProgress=counts.total?Math.round(earned.length/counts.total*100):0;
 return <section className="awardShelf steamAwards surface">
  <header className="awardShelfHeader">
   <div className="awardShelfIntro">
    <small>КОЛЛЕКЦИЯ GOS//SIMS</small>
    <h2><Trophy size={25}/> Награды</h2>
    <p>Игровые достижения за реальные действия внутри симуляции. Каждая награда имеет собственную медаль и оформление.</p>
   </div>
   <div className="awardCollectionSummary" aria-label={`Получено ${earned.length} из ${counts.total} наград`}>
    <div className="awardCollectionNumbers"><strong>{earned.length}</strong><span>/ {counts.total}</span><em>{collectionProgress}%</em></div>
    <div className="awardCollectionTrack" aria-hidden="true"><i style={{width:collectionProgress+'%'}}/></div>
    <span>{showCatalog?`Открыто условий: ${counts.open}`:`${earned.length} получено`}</span>
   </div>
   {showCatalog?<nav className="awardShelfTabs" aria-label="Показать награды">
    <button type="button" aria-pressed={filter==='earned'} onClick={()=>setFilter('earned')}><CheckCircle2 size={16}/> Полученные <b>{earned.length}</b></button>
    <button type="button" aria-pressed={filter==='open'} onClick={()=>setFilter('open')}><Sparkles size={16}/> Каталог <b>{counts.open}</b></button>
   </nav>:<span className="awardEarnedCount">{earned.length} получено</span>}
  </header>
  {error&&<p className="awardError" role="alert">{error}</p>}
  {!shown.length&&filter==='earned'&&<div className="awardEmpty"><Award size={30}/><div><b>Коллекция пока пуста</b><span>Награды появятся здесь после выполнения условий достижений.</span></div></div>}
  <div className="awardGrid">{shown.map(a=>{
   const progress=boundedProgress(Number(a.progress));
   const earnedAt=a.earned_at?new Date(a.earned_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}):null;
   return <article key={a.id} className={'awardCard '+(a.earned_at?'earned':'unearned')}>
    <AchievementArtwork id={a.id} title={a.title} earned={!!a.earned_at} secret={a.hidden}/>
    <div className="awardCardBody">
     <div className="awardCardMeta">
      {a.earned_at?<span className="awardStateBadge is-earned"><CheckCircle2 size={14}/> Получено</span>:<span className="awardStateBadge is-progress"><CircleDotDashed size={14}/> В процессе</span>}
      {a.hidden&&<span className="awardSecretBadge"><Sparkles size={13}/> Секрет</span>}
     </div>
     <h3>{a.title}</h3>
     <p>{a.description}</p>
     {earnedAt?<div className="awardCardFooter"><span>Разблокировано</span><b>{earnedAt}</b></div>:<div className="awardProgressBlock">
      <div className="awardProgressLine"><span>Прогресс</span><b>{Math.floor(progress)}%</b></div>
      <div className="awardProgress" role="progressbar" aria-label={`Прогресс достижения «${a.title}»`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{width:progress+'%'}}/></div>
     </div>}
    </div>
   </article>
  })}</div>
  {showCatalog&&<div className="awardSecrets"><LockKeyhole size={22}/><div><b>{Math.max(0,counts.hidden-hiddenEarned.length)} секретных наград ещё скрыты</b><span>Их названия и условия откроются только после выполнения. Награды не изменяют ВСН.</span></div></div>}
 </section>;
}

export function AchievementCelebration({gameId,userId,enabled}:{gameId:string;userId?:string;enabled:boolean}){
 const [award,setAward]=useState<Achievement|null>(null),[error,setError]=useState('');const active=useRef(false);
 useEffect(()=>{active.current=false;setAward(null);setError('');if(!enabled||!userId)return;let live=true;const running={current:false};async function check(){if(!live||running.current||active.current||document.visibilityState==='hidden')return;running.current=true;try{const a=await supabase.rpc('evaluate_game_achievements',{p_game_id:gameId});if(!live)return;if(a.error){setError(userError(a.error));return}const r=await supabase.rpc('claim_achievement_notification',{p_game_id:gameId});if(!live)return;if(r.error){setError(userError(r.error));return}if(r.data){active.current=true;setAward(r.data);setError('')}}catch(e){if(live)setError(userError(e))}finally{running.current=false}}
 void check();const timer=setInterval(()=>void check(),15000);return()=>{live=false;clearInterval(timer)}},[gameId,userId,enabled]);
 function close(){active.current=false;setAward(null)}
 useEffect(()=>{if(!award)return;const timer=setTimeout(close,8000);return()=>clearTimeout(timer)},[award?.id]);
 if(!enabled)return null;
 if(!award)return error?<p className="awardConnectionNotice" role="status">Награды: {error}</p>:null;
 return <aside className="achievementBurst steamAchievementBurst" role="status" aria-live="polite">
  <div className="awardConfetti" aria-hidden="true">{Array.from({length:28},(_,i)=><i key={i} style={{'--angle':(i*12.857)+'deg','--color':['#66c0f4','#7b61ff','#ff69b4','#ffd166','#70e1b5'][i%5]} as React.CSSProperties}/>)}</div>
  <button type="button" aria-label="Закрыть награду" onClick={close}><X size={20}/></button>
  <AchievementArtwork id={award.id} title={award.title} earned secret={award.hidden} compact/>
  <div className="achievementBurstCopy"><small>{award.hidden?'СЕКРЕТ РАСКРЫТ':'ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО'}</small><h2>{award.title}</h2><p>{award.description}</p><span><Trophy size={15}/> Добавлено в коллекцию</span></div>
 </aside>;
}
