'use client';
import {useEffect,useState} from 'react';
import {Award,BarChart3,ChevronDown,Eye,EyeOff,Search} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {Medal} from './Achievements';
import type {ReturnTypeRepublic} from './viewTypes';

type AwardDefinition={id:string;title:string;description:string;hidden:boolean;earned_count:number};
type StudentAwardStats={user_id:string;opened:number;hidden:number;total:number};

export default function TeacherAwards({g}:{g:ReturnTypeRepublic}){
 const gameId=g.game?.id||'';
 const students=g.members.filter(m=>m.game_id===gameId&&m.kind==='student');
 const [items,setItems]=useState<AwardDefinition[]>([]);
 const [statsOpen,setStatsOpen]=useState(false);
 const [stats,setStats]=useState<StudentAwardStats[]>([]);
 const [statsForGame,setStatsForGame]=useState('');
 const [statsBusy,setStatsBusy]=useState(false);
 const [statsError,setStatsError]=useState('');
 const [statsRevision,setStatsRevision]=useState(0);
 const [query,setQuery]=useState('');
 const [filter,setFilter]=useState('all');
 const [busy,setBusy]=useState('');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');

 async function load(){
  if(!g.game)return;
  const r=await supabase.rpc('get_teacher_achievements',{p_game_id:g.game.id});
  if(r.error)setError(userError(r.error));else{setItems(r.data||[]);setError('')}
 }
 useEffect(()=>{void load()},[g.game?.id]);
 // Same lazy loading as Blitz statistics: one indexed aggregate only when expanded.
 useEffect(()=>{
  if(!g.teacher||!gameId||!statsOpen||!students.length||statsForGame===gameId)return;
  let live=true;
  setStatsBusy(true);setStatsError('');
  void (async()=>{
   try{
    const {data,error:loadError}=await supabase.rpc('get_teacher_achievement_stats',{p_game_id:gameId});
    if(!live)return;
    if(loadError){setStatsError(userError(loadError));return}
    setStats((data||[]) as StudentAwardStats[]);
    setStatsForGame(gameId);
   }catch(loadError){
    if(live)setStatsError(userError(loadError));
   }finally{
    if(live)setStatsBusy(false);
   }
  })();
  return ()=>{live=false};
 },[gameId,g.teacher,statsOpen,students.length,statsForGame,statsRevision]);

 async function toggle(a:AwardDefinition){
  if(!g.game||busy)return;
  setBusy(a.id);setNotice('');
  const r=await supabase.rpc('set_achievement_visibility',{p_game_id:g.game.id,p_achievement_id:a.id,p_hidden:!a.hidden});
  if(r.error)setError(userError(r.error));
  else{
   await load();
   // Visibility changes move earned medals between open/hidden columns.
   setStatsForGame('');
   if(statsOpen)setStatsRevision(n=>n+1);
   setNotice('«'+a.title+'»: '+(a.hidden?'условие открыто студентам.':'условие скрыто до получения награды.'))
  }
  setBusy('');
 }

 if(!g.teacher)return null;
 const shown=items.filter(a=>(filter==='all'||(filter==='hidden'?a.hidden:!a.hidden))&&(a.title+' '+a.description).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
 const openCount=items.filter(a=>!a.hidden).length;
 const hiddenCount=items.filter(a=>a.hidden).length;
 const statsMap=new Map(stats.map(row=>[row.user_id,row]));

 return <section className="teacherAwards steamTeacherAwards surface">
  <header>
   <div><small>УПРАВЛЕНИЕ ДОСТИЖЕНИЯМИ</small><h2><Award size={24}/> Награды</h2><p>Все эмблемы показаны в цвете. Откройте или скройте условие для студентов — полученные награды сохранятся.</p></div>
   <div className="teacherAwardSummary"><strong>{items.length}</strong><span>всего</span><em>{openCount} открытых · {hiddenCount} скрытых</em></div>
  </header>

  <div className="blitzTeacher teacherAwardsStats">
   <div className="blitzSections"><section className={'blitzSection'+(statsOpen?' isOpen':'')}>
    <button type="button" className="blitzSectionToggle" aria-expanded={statsOpen} aria-controls="teacher-awards-stats-table" onClick={()=>setStatsOpen(open=>!open)}>
     <span className="blitzSectionIcon"><BarChart3 size={19} strokeWidth={1.9}/></span>
     <span className="blitzSectionTitle"><strong>Статистика участников</strong><small>Полученные открытые и скрытые награды по студентам</small></span>
     <span className="blitzSectionBadge">{students.length} участников</span>
     <ChevronDown className="blitzSectionChevron" size={18}/>
    </button>
    {statsOpen&&<div className="blitzSectionBody" id="teacher-awards-stats-table">
     {!students.length?<div className="blitzEmpty"><strong>Участников пока нет</strong><p>После регистрации студентов здесь появится статистика наград.</p></div>:
      statsForGame!==gameId?<>
       {statsBusy&&<p className="blitzLoading" role="status">Загрузка статистики…</p>}
       {statsError&&<div className="blitzEmpty" role="alert"><p>{statsError}</p><button className="blitzAction" type="button" onClick={()=>setStatsRevision(n=>n+1)}>Повторить загрузку</button></div>}
      </>:
      <div className="blitzStatsScroll"><table className="blitzStatsTable">
       <thead><tr><th scope="col">Участник</th><th scope="col">Открытые</th><th scope="col">Скрытые</th><th scope="col">Всего</th></tr></thead>
       <tbody>{students.map(m=>{const row=statsMap.get(m.user_id);return <tr key={m.user_id}><th scope="row">{m.full_name}</th><td>{row?.opened??0}</td><td>{row?.hidden??0}</td><td>{row?.total??0}</td></tr>})}</tbody>
      </table></div>}
    </div>}
   </section></div>
  </div>

  <div className="teacherAwardFilters">
   <label><Search size={18}/><input aria-label="Найти награду" type="search" placeholder="Название или условие" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <nav aria-label="Видимость наград">{[['all','Все'],['open','Открытые'],['hidden','Скрытые']].map(([k,t])=><button key={k} type="button" aria-pressed={filter===k} onClick={()=>setFilter(k)}>{t}</button>)}</nav>
  </div>

  {error&&<p className="error" role="alert">{error}</p>}
  {notice&&<p className="awardVisibilityNotice" role="status">{notice}</p>}

  <div className="teacherAwardGrid">
   {shown.map(a=><article key={a.id} className={a.hidden?'is-hidden':'is-open'}>
    <Medal id={a.id} title={a.title}/>
    <div className="teacherAwardBody">
     <div className="teacherAwardTitle"><h3>{a.title}</h3><span>{a.hidden?<><EyeOff size={13}/> Скрытая</>:<><Eye size={13}/> Открытая</>}</span></div>
     <p>{a.description}</p>
     <small>Получили: {a.earned_count}</small>
    </div>
    <button type="button" disabled={!!busy} aria-label={(a.hidden?'Открыть условие: ':'Скрыть условие: ')+a.title} onClick={()=>void toggle(a)}>
     {a.hidden?<Eye size={17}/>:<EyeOff size={17}/>}<span>{busy===a.id?'Сохраняется…':a.hidden?'Сделать открытой':'Сделать скрытой'}</span>
    </button>
   </article>)}
  </div>
 </section>;
}
