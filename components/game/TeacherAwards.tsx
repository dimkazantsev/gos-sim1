'use client';
import {useEffect,useState} from 'react';
import {Award,Eye,EyeOff,Search} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {Medal} from './Achievements';
import type {ReturnTypeRepublic} from './viewTypes';
type AwardDefinition={id:string;title:string;description:string;hidden:boolean;earned_count:number};
export default function TeacherAwards({g}:{g:ReturnTypeRepublic}){
 const [items,setItems]=useState<AwardDefinition[]>([]),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(){if(!g.game)return;const r=await supabase.rpc('get_teacher_achievements',{p_game_id:g.game.id});if(r.error)setError(userError(r.error));else{setItems(r.data||[]);setError('')}}
 useEffect(()=>{void load()},[g.game?.id]);
 async function toggle(a:AwardDefinition){if(!g.game||busy)return;setBusy(a.id);setNotice('');const r=await supabase.rpc('set_achievement_visibility',{p_game_id:g.game.id,p_achievement_id:a.id,p_hidden:!a.hidden});if(r.error)setError(userError(r.error));else{await load();setNotice('«'+a.title+'»: '+(a.hidden?'условие открыто студентам.':'условие скрыто до получения награды.'))}setBusy('')}
 if(!g.teacher)return null;
 const shown=items.filter(a=>(filter==='all'||(filter==='hidden'?a.hidden:!a.hidden))&&(a.title+' '+a.description).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
 return <section className="teacherAwards surface"><header><div><small>Управление достижениями</small><h2><Award size={24}/> Награды</h2><p>Каждая награда имеет своё условие. Открытые видны в каталоге студента; скрытые раскрываются после получения. Настройка действует только в этой игре.</p></div><span>{items.filter(a=>!a.hidden).length} открытых · {items.filter(a=>a.hidden).length} скрытых</span></header>
 <div className="teacherAwardFilters"><label><Search size={18}/><input aria-label="Найти награду" type="search" placeholder="Название или условие" value={query} onChange={e=>setQuery(e.target.value)}/></label><nav aria-label="Видимость наград">{[['all','Все'],['open','Открытые'],['hidden','Скрытые']].map(([k,t])=><button key={k} type="button" aria-pressed={filter===k} onClick={()=>setFilter(k)}>{t}</button>)}</nav></div>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="awardVisibilityNotice" role="status">{notice}</p>}
 <div className="teacherAwardGrid">{shown.map(a=><article key={a.id}><Medal id={a.id} title={a.title}/><div><span className="teacherAwardState">{a.hidden?'Скрытая награда':'Открытая награда'}</span><h3>{a.title}</h3><p>{a.description}</p><small>Получили: {a.earned_count} студентов</small></div><button type="button" disabled={!!busy} aria-label={(a.hidden?'Открыть условие: ':'Скрыть условие: ')+a.title} onClick={()=>void toggle(a)}>{a.hidden?<Eye size={18}/>:<EyeOff size={18}/>}<span>{busy===a.id?'Сохраняется…':a.hidden?'Сделать открытой':'Сделать скрытой'}</span></button></article>)}</div>
 </section>;
}
