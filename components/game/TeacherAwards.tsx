'use client';
import {useEffect,useState} from 'react';
import {Award,Eye,EyeOff,Search} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {Medal} from './Achievements';
import type {ReturnTypeRepublic} from './viewTypes';

type AwardDefinition={id:string;title:string;description:string;hidden:boolean;earned_count:number};

export default function TeacherAwards({g}:{g:ReturnTypeRepublic}){
 const [items,setItems]=useState<AwardDefinition[]>([]);
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

 async function toggle(a:AwardDefinition){
  if(!g.game||busy)return;
  setBusy(a.id);setNotice('');
  const r=await supabase.rpc('set_achievement_visibility',{p_game_id:g.game.id,p_achievement_id:a.id,p_hidden:!a.hidden});
  if(r.error)setError(userError(r.error));
  else{
   await load();
   setNotice('«'+a.title+'»: '+(a.hidden?'условие открыто студентам.':'условие скрыто до получения награды.'))
  }
  setBusy('');
 }

 if(!g.teacher)return null;
 const shown=items.filter(a=>(filter==='all'||(filter==='hidden'?a.hidden:!a.hidden))&&(a.title+' '+a.description).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
 const openCount=items.filter(a=>!a.hidden).length;
 const hiddenCount=items.filter(a=>a.hidden).length;

 return <section className="teacherAwards steamTeacherAwards surface">
  <header>
   <div><small>УПРАВЛЕНИЕ ДОСТИЖЕНИЯМИ</small><h2><Award size={24}/> Награды</h2><p>Компактный каталог в логике Steam: квадратная эмблема, название, условие, состояние и видимость.</p></div>
   <div className="teacherAwardSummary"><strong>{items.length}</strong><span>всего</span><em>{openCount} открытых · {hiddenCount} скрытых</em></div>
  </header>

  <div className="teacherAwardFilters">
   <label><Search size={18}/><input aria-label="Найти награду" type="search" placeholder="Название или условие" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <nav aria-label="Видимость наград">{[['all','Все'],['open','Открытые'],['hidden','Скрытые']].map(([k,t])=><button key={k} type="button" aria-pressed={filter===k} onClick={()=>setFilter(k)}>{t}</button>)}</nav>
  </div>

  {error&&<p className="error" role="alert">{error}</p>}
  {notice&&<p className="awardVisibilityNotice" role="status">{notice}</p>}

  <div className="teacherAwardGrid">
   {shown.map(a=><article key={a.id} className={a.hidden?'is-hidden':'is-open'}>
    <Medal id={a.id} title={a.title} earned={a.earned_count>0}/>
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
