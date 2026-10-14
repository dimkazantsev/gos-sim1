'use client';
import {type ReactNode,useEffect,useMemo,useRef,useState} from 'react';
import {BarChart3,BookOpenText,ChevronDown,ChevronLeft,ChevronRight,ClipboardCheck,Table2} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {GAME_DATA_REFRESH_EVENT} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';
type Assignment={id:string;question_id:number;user_id:string;chosen_index:number|null;is_correct:boolean|null;answered_at:string|null;stage_no:number};
type ReviewStatus='pending'|'approved'|'rejected';
type Question={id:number;question:string;options:string[];correct_index:number;topic:string;explanation:string;legal_act:string;article:string;source_url:string;verified:boolean;legal_review_status:ReviewStatus;legal_reviewed_at:string|null;legal_review_note:string|null};
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

const PAGE_SIZE=30;
type Section='bank'|'matrix'|'stats'|'checks';
type IconComponent=typeof BookOpenText;
function BlitzSection({id,title,subtitle,badge,icon:Icon,open,onToggle,children}:{id:Section;title:string;subtitle:string;badge:string;icon:IconComponent;open:boolean;onToggle:()=>void;children:ReactNode}){
 return <section className={'blitzSection'+(open?' isOpen':'')}>
  <button type="button" className="blitzSectionToggle" aria-expanded={open} aria-controls={'blitz-panel-'+id} onClick={onToggle}>
   <span className="blitzSectionIcon"><Icon size={19} strokeWidth={1.9}/></span>
   <span className="blitzSectionTitle"><strong>{title}</strong><small>{subtitle}</small></span>
   <span className="blitzSectionBadge">{badge}</span><ChevronDown className="blitzSectionChevron" size={18}/>
  </button>
  {open&&<div className="blitzSectionBody" id={'blitz-panel-'+id}>{children}</div>}
 </section>;
}
function BlitzPager({page,total,onChange,label}:{page:number;total:number;onChange:(page:number)=>void;label:string}){
 const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
 const current=Math.min(page,pages-1);
 return <div className="blitzPager" aria-label={'Навигация по '+label}>
  <span role="status">{total?current*PAGE_SIZE+1+'–'+Math.min((current+1)*PAGE_SIZE,total)+' из '+total:'Нет записей'} · по 30 на странице</span>
  <div className="blitzPagerActions">
   <button type="button" aria-label={'Предыдущая страница '+label} disabled={current===0} onClick={()=>onChange(current-1)}><ChevronLeft size={17}/> <span>Назад</span></button>
   <label>Страница <select aria-label={'Страница '+label} value={current} onChange={e=>onChange(Number(e.target.value))}>{Array.from({length:pages},(_,i)=><option key={i} value={i}>{i+1} / {pages}</option>)}</select></label>
   <button type="button" aria-label={'Следующая страница '+label} disabled={current>=pages-1} onClick={()=>onChange(current+1)}><span>Следующие 30</span> <ChevronRight size={17}/></button>
  </div>
 </div>;
}
export default function TeacherBlitz({g}:{g:ReturnTypeRepublic}){
 const gameId=g.game?.id||'';
 const students=useMemo(()=>g.members.filter(m=>m.game_id===gameId&&m.kind==='student'),[g.members,gameId]);
 const [opened,setOpened]=useState<Record<Section,boolean>>({bank:false,matrix:false,stats:false,checks:false});
 const toggle=(key:Section)=>setOpened(current=>({...current,[key]:!current[key]}));
 const [questions,setQuestions]=useState<Question[]>([]);
 const [catalogStatus,setCatalogStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle'),[retryCatalog,setRetryCatalog]=useState(0);
 const [stats,setStats]=useState<Stats[]>([]),[statsBusy,setStatsBusy]=useState(false);
 const [items,setItems]=useState<Assignment[]>([]),[matrixBusy,setMatrixBusy]=useState(false);
 const [query,setQuery]=useState(''),[actFilter,setActFilter]=useState('all'),[reviewFilter,setReviewFilter]=useState<'all'|ReviewStatus>('all'),[sort,setSort]=useState<'question'|'topic'>('question');
 const [bankPage,setBankPage]=useState(0),[matrixPage,setMatrixPage]=useState(0),[expandedQuestion,setExpandedQuestion]=useState<number|null>(null);
 const [notes,setNotes]=useState<Record<string,string>>({}),[error,setError]=useState(''),[saved,setSaved]=useState(''),[reviewBusy,setReviewBusy]=useState<number|null>(null);
 const currentGame=useRef(gameId);currentGame.current=gameId;
 const loadedCatalogFor=useRef(''),requestCatalogFor=useRef(''),loadedNotesFor=useRef(''),requestNotesFor=useRef('');
 useEffect(()=>{
  loadedCatalogFor.current='';requestCatalogFor.current='';loadedNotesFor.current='';requestNotesFor.current='';
  setQuestions([]);setStats([]);setItems([]);setCatalogStatus('idle');setBankPage(0);setMatrixPage(0);setExpandedQuestion(null);setNotes({});setError('');setSaved('');
 },[gameId]);
 useEffect(()=>{
  if(!gameId||(!opened.bank&&!opened.matrix)||loadedCatalogFor.current===gameId||requestCatalogFor.current===gameId)return;
  requestCatalogFor.current=gameId;setCatalogStatus('loading');
  void supabase.rpc('blitz_teacher_questions',{p_game:gameId}).then(({data,error:loadError})=>{
   if(currentGame.current!==gameId)return;
   requestCatalogFor.current='';
   if(loadError){setError(loadError.message);setCatalogStatus('error');return}
   const rows=((data||[]) as Partial<Question>[]).map(row=>({...row,verified:row.verified!==false,legal_review_status:(row.legal_review_status||'pending') as ReviewStatus,legal_reviewed_at:row.legal_reviewed_at||null,legal_review_note:row.legal_review_note||null}) as Question);
   setQuestions(rows);setCatalogStatus('ready');loadedCatalogFor.current=gameId;setError('');
  });
 },[gameId,opened.bank,opened.matrix,retryCatalog]);
 useEffect(()=>{
  if(!gameId||(!opened.bank&&!opened.checks)||loadedNotesFor.current===gameId||requestNotesFor.current===gameId)return;
  requestNotesFor.current=gameId;
  void supabase.from('blitz_check_notes').select('check_key,correction').eq('game_id',gameId).then(({data, error:loadError})=>{
   if(currentGame.current!==gameId)return;
   requestNotesFor.current='';
   if(loadError){setError(loadError.message);return}
   setNotes(Object.fromEntries((data||[]).map(x=>[x.check_key,x.correction])));
   loadedNotesFor.current=gameId;
  });
 },[gameId,opened.bank,opened.checks]);
 useEffect(()=>{
  if(!gameId||!opened.stats||!students.length)return;
  let live=true;setStatsBusy(true);
  void supabase.rpc('blitz_teacher_stats',{p_game:gameId}).then(({data,error:loadError})=>{
   if(!live)return;setStatsBusy(false);
   if(loadError){setError(loadError.message);return}
   setStats((data||[]) as Stats[]);
  });
  return ()=>{live=false};
 },[gameId,opened.stats,students.length]);
 const acts=useMemo(()=>[...new Set(questions.map(q=>q.legal_act))].sort((a,b)=>a.localeCompare(b,'ru')),[questions]);
 const filtered=useMemo(()=>questions.filter(q=>(actFilter==='all'||q.legal_act===actFilter)&&(reviewFilter==='all'||q.legal_review_status===reviewFilter)&&(q.question+' '+q.topic+' '+q.legal_act+' '+q.article).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).sort((a,b)=>sort==='topic'?(a.topic.localeCompare(b.topic,'ru')||a.id-b.id):a.id-b.id),[questions,query,actFilter,reviewFilter,sort]);
 const bankRows=useMemo(()=>filtered.slice(bankPage*PAGE_SIZE,(bankPage+1)*PAGE_SIZE),[filtered,bankPage]);
 const answeredQuestionIds=useMemo(()=>[...new Set(items.filter(x=>!!x.answered_at).map(x=>x.question_id))].sort((a,b)=>a-b),[items]);
 const matrixRows=useMemo(()=>answeredQuestionIds.slice(matrixPage*PAGE_SIZE,(matrixPage+1)*PAGE_SIZE),[answeredQuestionIds,matrixPage]);
 useEffect(()=>{
  if(!gameId||!opened.matrix||!students.length){setItems([]);setMatrixBusy(false);return}
  let live=true;setMatrixBusy(true);
  async function load(){
   const results:Assignment[]=[];
   for(let offset=0;offset<15000;offset+=1000){
    const {data,error:loadError}=await supabase.from('blitz_assignments').select('id,question_id,user_id,chosen_index,is_correct,answered_at,stage_no').eq('game_id',gameId).not('answered_at','is',null).order('answered_at',{ascending:false}).range(offset,offset+999);
    if(!live)return;
    if(loadError){setError(loadError.message);setMatrixBusy(false);return}
    results.push(...((data||[]) as Assignment[]));
    if(!data||data.length<1000)break;
   }
   if(live){setItems(results);setMatrixBusy(false)}
  }
  const updated=(event:Event)=>{if((event as CustomEvent<{gameId:string}>).detail?.gameId===gameId)void load()};
  window.addEventListener(GAME_DATA_REFRESH_EVENT,updated);
  void load();
  return ()=>{live=false;window.removeEventListener(GAME_DATA_REFRESH_EVENT,updated)};
 },[gameId,opened.matrix,students.length]);
 const answerMap=useMemo(()=>new Map(items.map(x=>[x.question_id+':'+x.user_id,x])),[items]);
 const statsMap=useMemo(()=>new Map(stats.map(x=>[x.user_id,x])),[stats]);
 const reviewCounts=useMemo(()=>questions.reduce((a,q)=>{a[q.legal_review_status]=(a[q.legal_review_status]||0)+1;return a},{pending:0,approved:0,rejected:0} as Record<ReviewStatus,number>),[questions]);
 const resetPages=()=>{setBankPage(0);setMatrixPage(0);setExpandedQuestion(null)};
 async function reviewQuestion(q:Question,status:ReviewStatus){
  if(!gameId||reviewBusy!==null)return;setReviewBusy(q.id);setSaved('');
  const note=notes['q:'+q.id]??q.legal_review_note??'';
  const {error:saveError}=await supabase.rpc('blitz_set_legal_review',{p_game:gameId,p_question:q.id,p_status:status,p_note:note||null});
  if(saveError){setError(saveError.message)}else{
   setError('');setQuestions(prev=>prev.map(x=>x.id===q.id?{...x,legal_review_status:status,legal_reviewed_at:status==='pending'?null:new Date().toISOString(),legal_review_note:note||null}:x));
   setSaved(status==='approved'?'Вопрос допущен к выдаче.':status==='rejected'?'Вопрос отклонён.':'Вопрос возвращён на проверку.');
  }
  setReviewBusy(null);
 }
 async function saveNote(key:string){
  if(!g.me||!gameId)return;setSaved('');
  const {error:saveError}=await supabase.from('blitz_check_notes').upsert({game_id:gameId,check_key:key,teacher_id:g.me.user_id,correction:notes[key]||'',updated_at:new Date().toISOString()});
  if(saveError)setError(saveError.message);else{setError('');setSaved('Корректировка сохранена.')}
 }
 const catalogLoading=catalogStatus==='loading'||catalogStatus==='idle';
 const filterBar=<div className="blitzFilters" role="search" aria-label="Фильтры блиц-вопросов">
  <input type="search" aria-label="Поиск блиц-вопросов" placeholder="Найти вопрос, тему или статью…" value={query} onChange={e=>{setQuery(e.target.value);resetPages()}}/>
  <select aria-label="Фильтр по нормативному акту" value={actFilter} onChange={e=>{setActFilter(e.target.value);resetPages()}}><option value="all">Все нормативные акты</option>{acts.map(act=><option key={act} value={act}>{act}</option>)}</select>
  <select aria-label="Юридический статус" value={reviewFilter} onChange={e=>{setReviewFilter(e.target.value as 'all'|ReviewStatus);resetPages()}}><option value="all">Все юридические статусы</option><option value="pending">Ожидают проверки</option><option value="approved">Одобрены</option><option value="rejected">Отклонены</option></select>
  <select aria-label="Сортировка вопросов" value={sort} onChange={e=>{setSort(e.target.value as 'question'|'topic');resetPages()}}><option value="question">По номеру</option><option value="topic">По тематике</option></select>
 </div>;
 const catalogError=catalogStatus==='error'&&<div className="blitzEmpty"><p>Не удалось загрузить банк вопросов.</p><button type="button" className="blitzAction" onClick={()=>setRetryCatalog(v=>v+1)}>Повторить загрузку</button></div>;
 return <section className="surface blitzTeacher">
  <header className="blitzTeacherHeader"><div><span className="blitzEyebrow">Проверка правовых знаний</span><h2>Блиц-вопросы</h2><p>Банк вопросов, ответы участников и контроль качества. Данные загружаются только при открытии нужного раздела.</p></div>
   <div className="blitzHeaderStats"><span><strong>{catalogStatus==='ready'?questions.length:'—'}</strong> вопросов</span><span><strong>{students.length}</strong> участников</span></div>
  </header>
  {error&&<p className="blitzNotice" role="alert">{error}</p>}
  {saved&&<p className="blitzNotice" role="status">{saved}</p>}
  {(opened.bank||opened.matrix)&&catalogStatus==='ready'&&filterBar}
  <div className="blitzSections">
   <BlitzSection id="bank" title="Банк вопросов" subtitle="Варианты ответа, объяснения и правовые источники" badge={catalogStatus==='ready'?questions.length+' записей':'Каталог'} icon={BookOpenText} open={opened.bank} onToggle={()=>toggle('bank')}>
    {catalogLoading?<p className="blitzLoading" role="status">Загрузка банка вопросов…</p>:catalogError||<>
     <div className="blitzSectionMeta"><span>Одобрено: <b>{reviewCounts.approved}</b></span><span>На проверке: <b>{reviewCounts.pending}</b></span><span>Отклонено: <b>{reviewCounts.rejected}</b></span></div>
     <BlitzPager page={bankPage} total={filtered.length} onChange={page=>{setBankPage(page);setExpandedQuestion(null)}} label="банка вопросов"/>
     {bankRows.length?<div className="blitzQuestionList">
      {bankRows.map(q=><article key={q.id} className="blitzQuestion">
       <button type="button" className="blitzQuestionToggle" aria-expanded={expandedQuestion===q.id} onClick={()=>setExpandedQuestion(id=>id===q.id?null:q.id)}>
        <span className="blitzQuestionNumber">№ {q.id}</span><span className="blitzQuestionTitle">{q.question}<small>{q.topic} · {q.legal_act}</small></span>
        <span className={'blitzReviewStatus '+q.legal_review_status}>{q.legal_review_status==='approved'?'Допущен':q.legal_review_status==='rejected'?'Отклонён':'На проверке'}</span><ChevronDown size={17} className="blitzQuestionChevron"/>
       </button>
       {expandedQuestion===q.id&&<div className="blitzQuestionBody">
        <ol className="blitzOptions">{q.options.map((option,index)=><li key={index} className={index===q.correct_index?'correct':''}><span>{String.fromCharCode(65+index)}</span><span>{option}</span>{index===q.correct_index&&<strong>Верно</strong>}</li>)}</ol>
        <div className="blitzQuestionExplanation"><strong>Объяснение</strong><p>{q.explanation}</p></div>
        <p className="blitzSource"><strong>Правовое основание:</strong> {q.source_url?<a href={q.source_url} target="_blank" rel="noopener noreferrer">{q.legal_act}, {q.article} ↗</a>:q.legal_act+', '+q.article}</p>
        <label className="blitzNoteLabel">Корректировка / юридическое примечание<textarea rows={2} value={notes['q:'+q.id]??q.legal_review_note??''} onChange={e=>setNotes(prev=>({...prev,['q:'+q.id]:e.target.value}))}/></label>
        <div className="blitzQuestionActions"><button type="button" onClick={()=>void saveNote('q:'+q.id)}>Сохранить замечание</button><button type="button" disabled={reviewBusy!==null||!q.verified} onClick={()=>void reviewQuestion(q,'approved')}>Одобрить</button><button type="button" disabled={reviewBusy!==null} onClick={()=>void reviewQuestion(q,'rejected')}>Отклонить</button><button type="button" disabled={reviewBusy!==null} onClick={()=>void reviewQuestion(q,'pending')}>Вернуть на проверку</button></div>
       </div>}
      </article>)}
     </div>:<p className="blitzEmpty">По выбранным фильтрам вопросы не найдены.</p>}
     <BlitzPager page={bankPage} total={filtered.length} onChange={page=>{setBankPage(page);setExpandedQuestion(null)}} label="банка вопросов"/>
    </>}
   </BlitzSection>
   <BlitzSection id="matrix" title="Матрица ответов" subtitle="Ответ каждого участника по каждому вопросу" badge={students.length+' участников'} icon={Table2} open={opened.matrix} onToggle={()=>toggle('matrix')}>
    {!students.length?<div className="blitzEmpty"><strong>Пока нет участников</strong><p>Матрица появится после присоединения участников.</p></div>:<>
     <div className="blitzMatrixLegend"><span><i className="isCorrect">✓</i> Верно</span><span><i className="isIncorrect">✕</i> Неверно</span></div>
     {matrixBusy&&<p className="blitzLoading" role="status">Загрузка ответов…</p>}
     {!matrixBusy&&!answeredQuestionIds.length&&<p className="blitzEmpty">Ответов на блиц пока нет.</p>}
     {answeredQuestionIds.length>0&&<>
      <BlitzPager page={matrixPage} total={answeredQuestionIds.length} onChange={setMatrixPage} label="матрицы ответов"/>
      <div className="blitzMatrixScroll" role="region" aria-label="Студенты и номера отвеченных вопросов" tabIndex={0}>
       <table className="blitzMatrixTable"><thead><tr><th scope="col">ФИО студента</th>{matrixRows.map(id=><th key={id} scope="col" title={'Вопрос № '+id}>№ {id}</th>)}</tr></thead>
        <tbody>{students.map(m=><tr key={m.user_id}><th scope="row">{m.full_name}</th>{matrixRows.map(id=>{const a=answerMap.get(id+':'+m.user_id);return <td key={id} className={a?.is_correct?'correct':a?.answered_at?'incorrect':''} title={!a?.answered_at?'Не отвечал':a.is_correct?'Правильный ответ':'Неправильный ответ'}>{!a?.answered_at?'—':a.is_correct?'✓':'✕'}</td>})}</tr>)}</tbody>
       </table>
      </div>
      <BlitzPager page={matrixPage} total={answeredQuestionIds.length} onChange={setMatrixPage} label="матрицы ответов"/>
     </>}
    </>}
   </BlitzSection>
   <BlitzSection id="stats" title="Статистика участников" subtitle="Верные, неверные и ожидающие ответы" badge={students.length+' участников'} icon={BarChart3} open={opened.stats} onToggle={()=>toggle('stats')}>
    {!students.length?<div className="blitzEmpty"><strong>Участников пока нет</strong><p>После подключения участников здесь появятся их результаты.</p></div>:<>
     {statsBusy&&<p className="blitzLoading" role="status">Загрузка статистики…</p>}
     <div className="blitzStatsScroll"><table className="blitzStatsTable"><thead><tr><th scope="col">Участник</th><th scope="col">Верно</th><th scope="col">Неверно</th><th scope="col">Ожидают ответа</th></tr></thead><tbody>
      {students.map(m=>{const a=statsMap.get(m.user_id);return <tr key={m.user_id}><th scope="row">{m.full_name}</th><td>{a?.correct??0}</td><td>{a?.incorrect??0}</td><td>{a?.pending??0}</td></tr>})}</tbody></table></div>
    </>}
   </BlitzSection>
   <BlitzSection id="checks" title="Контрольные проверки" subtitle="Вопросы для регрессии и ваши корректировки" badge={CHECKS.length+' проверок'} icon={ClipboardCheck} open={opened.checks} onToggle={()=>toggle('checks')}>
    <div className="blitzChecks">{CHECKS.map(([key,title,question],i)=><section className="blitzCheck" key={key}><span className="blitzCheckNumber">{String(i+1).padStart(2,'0')}</span><div><h3>{title}</h3><p>{question}</p><label>Ваши корректировки<textarea rows={2} value={notes[key]||''} onChange={e=>setNotes(prev=>({...prev,[key]:e.target.value}))}/></label><button type="button" className="blitzAction" onClick={()=>void saveNote(key)}>Сохранить корректировку</button></div></section>)}</div>
   </BlitzSection>
  </div>
 </section>;
}
