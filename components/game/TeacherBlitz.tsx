'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
type Assignment={id:string;question_id:number;user_id:string;chosen_index:number|null;is_correct:boolean|null;answered_at:string|null;stage_no:number};
type Question={id:number;question:string;options:string[];correct_index:number;topic:string};
type Stats={user_id:string;correct:number;incorrect:number;pending:number};
const CHECKS=[
 ['daily','3–5 заданий в сутки без повторов','Восстанавливаются ли вопросы, назначенные во время отсутствия участника?'],
 ['timer','Серверный таймер 20 секунд','Фиксируется ли истечение времени независимо от часов устройства?'],
 ['security','Один ответ и разделение прав','Недоступны ли правильные ответы до завершения попытки?'],
 ['scoring','ВСН: 0,30 + 0,30 + 0,30 + 0,10','Сохранена ли неизменность утверждённых итоговых оценок?'],
 ['matrix','Матрица ответов и статистика','Удобен ли поиск и корректно ли загружаются следующие строки?'],
 ['mobile','Карточка поверх игрового интерфейса','Все ли варианты ответа помещаются на мобильном экране?'],
 ['sources','Актуальность источников и лекций','Все ли ссылки на статьи ведут к действующим редакциям НПА?'],
 ['content','Качество и уникальность банка','Есть ли повторяющиеся или слишком очевидные варианты ответа?']
] as const;
export default function TeacherBlitz({g}:{g:ReturnTypeRepublic}){
 const gameId=g.game?.id||'';
 const students=g.members.filter(m=>m.game_id===gameId&&m.kind==='student');
 const [questions,setQuestions]=useState<Question[]>([]),[items,setItems]=useState<Assignment[]>([]),[stats,setStats]=useState<Stats[]>([]);
 const [query,setQuery]=useState(''),[sort,setSort]=useState<'question'|'topic'>('question'),[limit,setLimit]=useState(30);
 const [notes,setNotes]=useState<Record<string,string>>({}),[error,setError]=useState(''),[saved,setSaved]=useState('');
 const loadedIds=useRef<Set<number>>(new Set()),sentinel=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!gameId)return;let active=true;loadedIds.current.clear();setItems([]);
  async function load(){const [q,n,s]=await Promise.all([
   supabase.rpc('blitz_teacher_questions',{p_game:gameId}),
   supabase.from('blitz_check_notes').select('check_key,correction').eq('game_id',gameId),
   supabase.rpc('blitz_teacher_stats',{p_game:gameId})
  ]);
   if(!active)return;
   if(q.error||s.error){setError(q.error?.message||s.error?.message||'Нет доступа к вопросам');return}
   setQuestions((q.data||[]) as Question[]);setStats((s.data||[]) as Stats[]);
   setNotes(Object.fromEntries((n.data||[]).map(x=>[x.check_key,x.correction])));
  }
  void load();return()=>{active=false}
 },[gameId]);
 const filtered=useMemo(()=>questions.filter(q=>(q.question+' '+q.topic).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).sort((a,b)=>sort==='topic'?(a.topic.localeCompare(b.topic,'ru')||a.question.localeCompare(b.question,'ru')):a.question.localeCompare(b.question,'ru')),[questions,query,sort]);
 const shown=useMemo(()=>filtered.slice(0,limit),[filtered,limit]);
 const questionIds=shown.map(q=>q.id).join(',');
 useEffect(()=>{if(!gameId||!questionIds)return;let valid=true;
  const fresh=questionIds.split(',').map(Number).filter(id=>!loadedIds.current.has(id));
  if(!fresh.length)return;
  async function load(){for(let i=0;i<fresh.length;i+=25){
   const batch=fresh.slice(i,i+25);
   const r=await supabase.from('blitz_assignments').select('id,question_id,user_id,chosen_index,is_correct,answered_at,stage_no').eq('game_id',gameId).in('question_id',batch).limit(1000);
   if(!valid)return;
   if(r.error){setError(r.error.message);return}
   setItems(prev=>[...prev,...((r.data||[]) as Assignment[])].filter((value,index,array)=>array.findIndex(x=>x.id===value.id)===index));
   batch.forEach(id=>loadedIds.current.add(id));
  }}
  void load();return()=>{valid=false}
 },[gameId,questionIds]);
 useEffect(()=>{if(!sentinel.current||shown.length>=filtered.length)return;const observer=new IntersectionObserver(entries=>{
  if(entries.some(x=>x.isIntersecting))setLimit(n=>Math.min(n+30,filtered.length));
 },{rootMargin:'200px'});observer.observe(sentinel.current);return()=>observer.disconnect()},[shown.length,filtered.length]);
 const answerMap=useMemo(()=>new Map(items.map(x=>[x.question_id+':'+x.user_id,x])),[items]);
 const statsMap=useMemo(()=>new Map(stats.map(x=>[x.user_id,x])),[stats]);
 async function saveNote(key:string){if(!g.me||!gameId)return;setSaved('');
  const r=await supabase.from('blitz_check_notes').upsert({game_id:gameId,check_key:key,teacher_id:g.me.user_id,correction:notes[key]||'',updated_at:new Date().toISOString()});
  setSaved(r.error?r.error.message:'Корректировка сохранена.');
 }
 return <section className="surface blitzTeacher">
  <header><h2>Блиц-вопросы</h2><p>Матрица фактических ответов участников. ✓ — верно, ✕ — неверно, — — ответа нет.</p></header>
  {error&&<p role="alert">{error}</p>}
  <div className="blitzFilters">
   <input type="search" aria-label="Поиск блиц-вопросов" placeholder="Поиск по вопросу или теме" value={query} onChange={e=>{setQuery(e.target.value);setLimit(30)}}/>
   <select aria-label="Сортировка вопросов" value={sort} onChange={e=>{setSort(e.target.value as 'question'|'topic');setLimit(30)}}><option value="question">По вопросу</option><option value="topic">По тематике</option></select>
  </div>
  <details open><summary>Матрица ответов — {questions.length} вопросов, {students.length} участников</summary>
   <div className="blitzMatrixScroll"><table><thead><tr><th>Вопрос и правильный ответ</th>{students.map(m=><th key={m.user_id}>{m.full_name}</th>)}</tr></thead>
   <tbody>{shown.map(q=><tr key={q.id}><th>{q.question}<small>{q.options[q.correct_index]}</small></th>{students.map(m=>{const a=answerMap.get(q.id+':'+m.user_id);return <td key={m.user_id} className={a?.is_correct?'correct':a?.answered_at?'incorrect':''} title={a?.answered_at?'Этап '+a.stage_no:'Не отвечал'}>{!a?.answered_at?'—':a.is_correct?'✓':'✕'}</td>})}</tr>)}</tbody></table></div>
   <div ref={sentinel} aria-hidden="true"/>{shown.length<filtered.length&&<button type="button" onClick={()=>setLimit(n=>n+30)}>Показать ещё 30</button>}
  </details>
  <details><summary>Статистика ответов по участникам</summary><table><thead><tr><th>Участник</th><th>Верно</th><th>Неверно</th><th>Ожидают ответа</th></tr></thead><tbody>
  {students.map(m=>{const a=statsMap.get(m.user_id);return <tr key={m.user_id}><th>{m.full_name}</th><td>{a?.correct??0}</td><td>{a?.incorrect??0}</td><td>{a?.pending??0}</td></tr>})}</tbody></table></details>
  <details><summary>Контрольные проверки и корректировки</summary>{CHECKS.map(([key,title,question])=><section className="blitzCheck" key={key}><h3>{title}</h3><p>{question}</p><label>Ваши корректировки<textarea rows={2} value={notes[key]||''} onChange={e=>setNotes(prev=>({...prev,[key]:e.target.value}))}/></label><button type="button" onClick={()=>void saveNote(key)}>Сохранить корректировку</button></section>)}{saved&&<p role="status">{saved}</p>}</details>
 </section>;
}
