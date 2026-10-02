'use client';
import {useEffect,useRef,useState} from 'react';
import {Award,LockKeyhole,Sparkles,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';

export type Achievement={id:string;title:string;description:string;hidden:boolean;earned_at:string|null;progress:number};

const MEDAL_THEMES=[
 ['#61dafb','#244c8f'],['#e7b85c','#7a4318'],['#9b8cff','#47358b'],['#68d7b3','#215c57'],['#ef7aa8','#7d3154'],['#8fb8ff','#2b4d91']
] as const;

function medalTheme(id:string){
 let hash=0;
 for(let i=0;i<id.length;i++)hash=(hash*31+id.charCodeAt(i))>>>0;
 return MEDAL_THEMES[hash%MEDAL_THEMES.length];
}

export function Medal({id,title}:{id:string;title:string}){
 const [failed,setFailed]=useState(false);
 const [accent,deep]=medalTheme(id);
 return <span className="achievementMedal" style={{'--medal-accent':accent,'--medal-deep':deep} as React.CSSProperties}>
  <span className="achievementMedalGlow" aria-hidden="true"/>
  {failed?<Award className="achievementMedalFallback" aria-label={title}/>:<img src={(process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'')+'/medals/'+id+'.svg'} alt={title} width={100} height={110} loading="lazy" onError={()=>setFailed(true)}/>}
 </span>;
}

export function AwardShelf({gameId,userId,showCatalog=true}:{gameId:string;userId:string;showCatalog?:boolean}){
 const [items,setItems]=useState<Achievement[]>([]),[filter,setFilter]=useState<'earned'|'open'>('earned'),[error,setError]=useState(''),[counts,setCounts]=useState({total:100,open:60,hidden:40});
 useEffect(()=>{if(!showCatalog)setFilter('earned')},[showCatalog]);
 useEffect(()=>{let live=true;async function load(){const [r,c]=await Promise.all([supabase.rpc('get_game_achievements',{p_game_id:gameId,p_user_id:userId}),supabase.rpc('get_achievement_catalog_counts',{p_game_id:gameId})]);if(!live)return;if(r.error)setError(userError(r.error));else{setItems(r.data||[]);if(!c.error&&c.data)setCounts(c.data);setError('')}}void load();const timer=setInterval(()=>void load(),30000);return()=>{live=false;clearInterval(timer)}},[gameId,userId]);
 const earned=items.filter(x=>x.earned_at),hidden=earned.filter(x=>x.hidden),shown=filter==='earned'?earned:items.filter(x=>!x.hidden);
 return <section className="awardShelf surface">
  <header>
   <div><small>ОТКРЫТЫЕ НАГРАДЫ</small><h2><Award size={24}/> Достижения</h2><p>Получено {earned.length} из {counts.total}{showCatalog?' · Раскрыто '+hidden.length+' из '+counts.hidden+' секретов':''}</p></div>
   {showCatalog?<nav aria-label="Показать награды"><button type="button" aria-pressed={filter==='earned'} onClick={()=>setFilter('earned')}>Полученные · {earned.length}</button><button type="button" aria-pressed={filter==='open'} onClick={()=>setFilter('open')}>Каталог · {counts.open}</button></nav>:<span className="awardEarnedCount">{earned.length} получено</span>}
  </header>
  {error&&<p role="alert">{error}</p>}
  {!shown.length&&filter==='earned'&&<p className="awardEmpty">Открытых наград пока нет. Они появятся здесь после выполнения условий достижений.</p>}
  <div className="awardGrid">{shown.map(a=><article key={a.id} className={a.earned_at?'earned':'unearned'}>
   <Medal id={a.id} title={a.title}/>
   <div><h3>{a.title}{a.hidden&&<Sparkles size={16} aria-label="Секретная награда"/>}</h3><p>{a.description}</p>{a.earned_at?<small>Получено {new Date(a.earned_at).toLocaleDateString('ru-RU')}</small>:<><progress max={100} value={Number(a.progress)}/><small>Прогресс {Math.floor(Number(a.progress))}%</small></>}</div>
  </article>)}</div>
  {showCatalog&&<div className="awardSecrets"><LockKeyhole size={20}/><span>{Math.max(0,counts.hidden-hidden.length)} скрытых наград ждут открытия. Их названия и условия появятся после получения. Медали не изменяют ВСН.</span></div>}
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
 return <aside className="achievementBurst" role="status" aria-live="polite"><div className="awardConfetti" aria-hidden="true">{Array.from({length:24},(_,i)=><i key={i} style={{'--angle':(i*15)+'deg','--color':['#377ce4','#de69a1','#69caaa','#ffca70'][i%4]} as React.CSSProperties}/>)}</div><button type="button" aria-label="Закрыть награду" onClick={close}><X size={20}/></button><Medal id={award.id} title={award.title}/><div><small>{award.hidden?'Секрет раскрыт!':'Достижение получено!'}</small><h2>{award.title}</h2><p>{award.description}</p></div></aside>;
}
