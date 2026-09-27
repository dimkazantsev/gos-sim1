'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type Program={id:string;game_id:string;title:string;responsible_ministry:string;responsible_minister_id:string|null;curator_id:string|null;national_goal:string|null;presidential_priority_id:string|null;start_date:string|null;end_date:string|null;total_budget:number;expected_results:string|null;status:'draft'|'minister_review'|'revision'|'pm_review'|'ready'|'government_vote'|'adopted'|'rejected';government_vote_id:string|null;created_by:string;created_at:string;updated_at:string};
type Address={id:string;game_id:string;title:string;body_text:string;video_url:string|null;status:'draft'|'published';created_by:string;created_at:string;updated_at:string;published_at:string|null};
type Priority={id:string;address_id:string;game_id:string;priority_no:number;title:string;description:string|null;national_goal:string|null;created_at:string};
type Readiness={ready:boolean;issues:string[];goals:number;directions:number;components:number;component_budget:number;total_budget:number};
type Goal={id:string;program_id:string;goal_text:string;indicator_name:string;unit:string|null;baseline_value:number|null;target_value:number|null;target_year:number|null};
type Component={id:string;program_id:string;direction_no:number;direction_title:string;component_kind:'project'|'target_program'|'measure';title:string;goal_text:string;start_date:string|null;end_date:string|null;budget:number};

const nationalGoals=[
 'Сохранение населения, укрепление здоровья и повышение благополучия людей, поддержка семьи',
 'Реализация потенциала каждого человека, развитие его талантов, воспитание патриотичной и социально ответственной личности',
 'Комфортная и безопасная среда для жизни',
 'Экологическое благополучие',
 'Устойчивая и динамичная экономика',
 'Технологическое лидерство',
 'Цифровая трансформация государственного и муниципального управления, экономики и социальной сферы'
];
const statusLabel:Record<Program['status'],string>={draft:'Черновик',minister_review:'У министра',revision:'Доработка',pm_review:'У Председателя Правительства',ready:'Готова к заседанию',government_vote:'Голосование Правительства',adopted:'Принята',rejected:'Отклонена'};

export default function StateProgramLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,votes,setError}=g;
 const [programs,setPrograms]=useState<Program[]>([]);
 const [addresses,setAddresses]=useState<Address[]>([]);
 const [priorities,setPriorities]=useState<Priority[]>([]);
 const [readiness,setReadiness]=useState<Record<string,Readiness>>({});
 const [goals,setGoals]=useState<Goal[]>([]);
 const [components,setComponents]=useState<Component[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [title,setTitle]=useState('');
 const [ministry,setMinistry]=useState('');
 const [minister,setMinister]=useState('');
 const [curator,setCurator]=useState('');
 const [nationalGoal,setNationalGoal]=useState('');
 const [start,setStart]=useState('');
 const [end,setEnd]=useState('');
 const [budget,setBudget]=useState('');
 const [expected,setExpected]=useState('');
 const [goalText,setGoalText]=useState('');
 const [indicator,setIndicator]=useState('');
 const [unit,setUnit]=useState('');
 const [baseline,setBaseline]=useState('');
 const [target,setTarget]=useState('');
 const [targetYear,setTargetYear]=useState('');
 const [directionNo,setDirectionNo]=useState(1);
 const [directionTitle,setDirectionTitle]=useState('');
 const [componentKind,setComponentKind]=useState<Component['component_kind']>('project');
 const [componentTitle,setComponentTitle]=useState('');
 const [componentGoal,setComponentGoal]=useState('');
 const [componentBudget,setComponentBudget]=useState('');
 const [addressTitle,setAddressTitle]=useState('Послание Президента Российской Федерации Федеральному Собранию');
 const [addressBody,setAddressBody]=useState('');
 const [addressVideo,setAddressVideo]=useState('');
 const [priorityNo,setPriorityNo]=useState(1);
 const [priorityTitle,setPriorityTitle]=useState('');
 const [priorityDescription,setPriorityDescription]=useState('');
 const [priorityNationalGoal,setPriorityNationalGoal]=useState('');
 const [priorityLink,setPriorityLink]=useState('');
 const [busy,setBusy]=useState(false);
 const role=(me?.role_title||'').toLowerCase();
 const isPM=role.includes('председател')&&role.includes('правительств');
 const isMinister=role.includes('министр');
 const isPresident=role.includes('президент');

 async function load(){
  if(!game)return;
  const [p,g,c,a,pr]=await Promise.all([
   supabase.from('state_programs').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('state_program_goals').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('state_program_components').select('*').eq('game_id',game.id).order('direction_no').order('created_at'),
   supabase.from('presidential_addresses').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('presidential_priorities').select('*').eq('game_id',game.id).order('priority_no')
  ]);
  if(!p.error){
   const rows=(p.data||[]) as Program[];setPrograms(rows);
   if(!selectedId&&rows[0])setSelectedId(rows[0].id);
  }
  if(!g.error)setGoals((g.data||[]) as Goal[]);
  if(!c.error)setComponents((c.data||[]) as Component[]);
  if(!a.error){
   const rows=(a.data||[]) as Address[];setAddresses(rows);
   const draft=rows.find(x=>x.status==='draft')||rows[0];
   if(draft){setAddressTitle(draft.title);setAddressBody(draft.body_text);setAddressVideo(draft.video_url||'')}
  }
  if(!pr.error)setPriorities((pr.data||[]) as Priority[]);
  if(!p.error){
   const rows=(p.data||[]) as Program[];
   const next:Record<string,Readiness>={};
   await Promise.all(rows.map(async x=>{const rr=await supabase.rpc('get_state_program_readiness',{p_program_id:x.id});if(!rr.error&&rr.data)next[x.id]=rr.data as Readiness}));
   setReadiness(next);
  }
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('state-programs:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'state_programs',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'state_program_goals',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'state_program_components',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_addresses',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_priorities',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 const selected=programs.find(p=>p.id===selectedId);
 useEffect(()=>{
  if(!selected)return;
  setTitle(selected.title);setMinistry(selected.responsible_ministry);setMinister(selected.responsible_minister_id||'');
  setCurator(selected.curator_id||'');setNationalGoal(selected.national_goal||'');setStart(selected.start_date||'');setEnd(selected.end_date||'');
  setBudget(String(selected.total_budget??0));setExpected(selected.expected_results||'');
 },[selected?.id,selected?.updated_at]);

 if(!game||!me)return null;
 const activeGame=game;
 const activeMe=me;
 const myGoals=selected?goals.filter(x=>x.program_id===selected.id):[];
 const myComponents=selected?components.filter(x=>x.program_id===selected.id):[];
 const dirs=useMemo(()=>[...new Set(myComponents.map(x=>x.direction_no))].sort(),[myComponents]);
 const canEdit=!!selected&&(teacher||selected.created_by===activeMe.user_id||selected.responsible_minister_id===activeMe.user_id);
 const memberName=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';
 const vote=selected?.government_vote_id?votes.find(v=>v.id===selected.government_vote_id):undefined;
 const publishedAddress=addresses.find(x=>x.status==='published');
 const activeAddress=addresses.find(x=>x.status==='draft')||publishedAddress;
 const publishedPriorities=publishedAddress?priorities.filter(x=>x.address_id===publishedAddress.id):[];
 const selectedPriority=selected?.presidential_priority_id?priorities.find(x=>x.id===selected.presidential_priority_id):undefined;
 const selectedReadiness=selected?readiness[selected.id]:undefined;

 async function saveProgram(newProgram=false){
  if(title.trim().length<5||ministry.trim().length<3)return;setBusy(true);
  const r=await supabase.rpc('save_state_program',{
   p_game_id:activeGame.id,p_program_id:newProgram?null:(selected?.id||null),p_title:title.trim(),
   p_responsible_ministry:ministry.trim(),p_responsible_minister_id:minister||null,p_curator_id:curator||null,
   p_national_goal:nationalGoal||null,p_start_date:start||null,p_end_date:end||null,p_total_budget:Number(budget)||0,p_expected_results:expected.trim()||null
  });
  if(r.error)setError(r.error.message);else{if(newProgram&&r.data)setSelectedId(String(r.data));await load()}setBusy(false);
 }
 async function addGoal(){
  if(!selected||goalText.trim().length<5||indicator.trim().length<3)return;setBusy(true);
  const r=await supabase.rpc('add_state_program_goal',{p_program_id:selected.id,p_goal_text:goalText.trim(),p_indicator_name:indicator.trim(),p_unit:unit.trim()||null,p_baseline:baseline===''?null:Number(baseline),p_target:target===''?null:Number(target),p_target_year:targetYear===''?null:Number(targetYear)});
  if(r.error)setError(r.error.message);else{setGoalText('');setIndicator('');setUnit('');setBaseline('');setTarget('');setTargetYear('');await load()}setBusy(false);
 }
 async function addComponent(){
  if(!selected||directionTitle.trim().length<3||componentTitle.trim().length<3||componentGoal.trim().length<5)return;setBusy(true);
  const r=await supabase.rpc('add_state_program_component',{p_program_id:selected.id,p_direction_no:directionNo,p_direction_title:directionTitle.trim(),p_component_kind:componentKind,p_title:componentTitle.trim(),p_goal_text:componentGoal.trim(),p_start_date:null,p_end_date:null,p_budget:Number(componentBudget)||0});
  if(r.error)setError(r.error.message);else{setComponentTitle('');setComponentGoal('');setComponentBudget('');await load()}setBusy(false);
 }
 async function del(type:'goal'|'component',id:string){setBusy(true);const r=await supabase.rpc('delete_state_program_item',{p_item_type:type,p_item_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function advance(action:string){if(!selected)return;setBusy(true);const r=await supabase.rpc('advance_state_program',{p_program_id:selected.id,p_action:action});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function openVote(){if(!selected)return;setBusy(true);const r=await supabase.rpc('open_state_program_government_vote',{p_program_id:selected.id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function saveAddress(){
  setBusy(true);const r=await supabase.rpc('save_presidential_address',{p_game_id:activeGame.id,p_address_id:activeAddress?.status==='draft'?activeAddress.id:null,p_title:addressTitle.trim(),p_body_text:addressBody.trim(),p_video_url:addressVideo.trim()||null});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function addPriority(){
  const addr=addresses.find(x=>x.status==='draft');if(!addr)return;
  setBusy(true);const r=await supabase.rpc('add_presidential_priority',{p_address_id:addr.id,p_priority_no:priorityNo,p_title:priorityTitle.trim(),p_description:priorityDescription.trim()||null,p_national_goal:priorityNationalGoal||null});
  if(r.error)setError(r.error.message);else{setPriorityNo(x=>x+1);setPriorityTitle('');setPriorityDescription('');setPriorityNationalGoal('');await load()}setBusy(false);
 }
 async function publishAddress(){
  const addr=addresses.find(x=>x.status==='draft');if(!addr)return;
  setBusy(true);const r=await supabase.rpc('publish_presidential_address',{p_address_id:addr.id});if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function linkPriority(){
  if(!selected)return;setBusy(true);const r=await supabase.rpc('link_state_program_priority',{p_program_id:selected.id,p_priority_id:priorityLink||null});if(r.error)setError(r.error.message);else await load();setBusy(false);
 }

 return <section className="programLab">
  <header className="programLabHead"><div><small>УПРАВЛЕНИЕ ПО ЦЕЛЯМ · ЭТАПЫ 10–11</small><h2>Государственные программы</h2><p>Не файл ради файла, а связанная модель: национальная цель → цель программы → измеримый показатель → структурный элемент → бюджет → ведомственная проверка → решение Правительства.</p></div><div className="programNorm"><b>ПП РФ №786</b><span>актуальная система управления госпрограммами</span><b>Указ №309</b><span>национальные цели до 2030/2036</span></div></header>

  <section className="policyMandate">
   <header><div><small>ПОЛИТИЧЕСКИЙ МАНДАТ · ЭТАП 10</small><h3>Послание Президента → приоритеты → государственные программы</h3><p>Послание становится источником целей для последующей работы Правительства. После публикации его приоритеты фиксируются и могут быть привязаны к конкретным государственным программам.</p></div><span className={publishedAddress?'published':'draft'}>{publishedAddress?'Опубликовано':'Черновик'}</span></header>
   {(teacher||isPresident)&&!publishedAddress&&<div className="policyMandateEditor">
    <label>Название<input value={addressTitle} onChange={e=>setAddressTitle(e.target.value)}/></label>
    <label>Видео / ссылка<input value={addressVideo} onChange={e=>setAddressVideo(e.target.value)} placeholder="Ссылка на опубликованную видеоверсию"/></label>
    <label className="wide">Текст послания<textarea rows={5} value={addressBody} onChange={e=>setAddressBody(e.target.value)} placeholder="Основные цели и приоритеты государственной политики"/></label>
    <button className="secondary" disabled={busy||addressBody.trim().length<20} onClick={()=>void saveAddress()}>Сохранить послание</button>
   </div>}
   {activeAddress&&<div className="policyPriorityArea">
    <div className="policyPriorityList">{priorities.filter(x=>x.address_id===activeAddress.id).length===0?<div className="emptyState">Приоритеты ещё не выделены.</div>:priorities.filter(x=>x.address_id===activeAddress.id).map(x=><article key={x.id}><span>{String(x.priority_no).padStart(2,'0')}</span><div><b>{x.title}</b>{x.national_goal&&<small>{x.national_goal}</small>}{x.description&&<p>{x.description}</p>}</div></article>)}</div>
    {(teacher||isPresident)&&activeAddress.status==='draft'&&<div className="policyPriorityComposer"><label>№<input type="number" min="1" max="50" value={priorityNo} onChange={e=>setPriorityNo(Number(e.target.value)||1)}/></label><label>Приоритет<input value={priorityTitle} onChange={e=>setPriorityTitle(e.target.value)}/></label><label>Национальная цель<select value={priorityNationalGoal} onChange={e=>setPriorityNationalGoal(e.target.value)}><option value="">Не привязывать</option>{nationalGoals.map(x=><option key={x}>{x}</option>)}</select></label><label className="wide">Содержание<textarea rows={2} value={priorityDescription} onChange={e=>setPriorityDescription(e.target.value)}/></label><button disabled={busy||priorityTitle.trim().length<3} onClick={()=>void addPriority()}>＋ Добавить приоритет</button><button className="primary" disabled={busy||priorities.filter(x=>x.address_id===activeAddress.id).length===0} onClick={()=>void publishAddress()}>Опубликовать послание</button></div>}
   </div>}
  </section>

  <div className="programPicker">
   <div className="programTabs">{programs.map(p=><button key={p.id} className={p.id===selectedId?'active':''} onClick={()=>setSelectedId(p.id)}><b>{p.title}</b><span>{statusLabel[p.status]}</span></button>)}</div>
   {(teacher||isMinister||isPM)&&<button className="programNew" onClick={()=>{setSelectedId('');setTitle('');setMinistry('');setMinister('');setCurator('');setNationalGoal('');setStart('');setEnd('');setBudget('0');setExpected('')}}>＋ Новая программа</button>}
  </div>

  {(!selected&&(teacher||isMinister||isPM))&&<div className="programPassportEditor new">
   <h3>Новая государственная программа</h3>
   <PassportFields members={members} title={title} setTitle={setTitle} ministry={ministry} setMinistry={setMinistry} minister={minister} setMinister={setMinister} curator={curator} setCurator={setCurator} nationalGoal={nationalGoal} setNationalGoal={setNationalGoal} start={start} setStart={setStart} end={end} setEnd={setEnd} budget={budget} setBudget={setBudget} expected={expected} setExpected={setExpected}/>
   <button className="primary" disabled={busy||title.trim().length<5||ministry.trim().length<3} onClick={()=>void saveProgram(true)}>Создать программу</button>
  </div>}

  {selected&&<>
   <div className="programPassport">
    <div className="programPassportHead"><div><small>ПАСПОРТ ГП</small><h3>{selected.title}</h3><p>{selected.responsible_ministry}</p></div><span className={'programStatus '+selected.status}>{statusLabel[selected.status]}</span></div>
    <div className="programPassportFacts"><div><small>Ответственный министр</small><b>{memberName(selected.responsible_minister_id)}</b></div><div><small>Куратор</small><b>{memberName(selected.curator_id)}</b></div><div><small>Период</small><b>{selected.start_date||'—'} → {selected.end_date||'—'}</b></div><div><small>Бюджет</small><b>{Number(selected.total_budget).toLocaleString('ru-RU')}</b></div></div>
    {selected.national_goal&&<div className="programNationalGoal"><small>НАЦИОНАЛЬНАЯ ЦЕЛЬ</small><p>{selected.national_goal}</p></div>}
    <div className="programPolicyLink"><small>ПРИОРИТЕТ ПОСЛАНИЯ ПРЕЗИДЕНТА</small>{selectedPriority?<><b>{selectedPriority.title}</b>{selectedPriority.description&&<p>{selectedPriority.description}</p>}</>:<p>Не связан</p>}{canEdit&&publishedPriorities.length>0&&<div><select value={priorityLink||selected.presidential_priority_id||''} onChange={e=>setPriorityLink(e.target.value)}><option value="">Не связывать</option>{publishedPriorities.map(x=><option key={x.id} value={x.id}>{x.priority_no}. {x.title}</option>)}</select><button onClick={()=>void linkPriority()}>Сохранить связь</button></div>}</div>
    {selected.expected_results&&<div className="programExpected"><small>ОЖИДАЕМЫЕ РЕЗУЛЬТАТЫ</small><p>{selected.expected_results}</p></div>}
   </div>

   {canEdit&&selected.status!=='adopted'&&selected.status!=='rejected'&&<details className="programEdit"><summary><div><b>Редактировать паспорт</b><span>Ответственный исполнитель, куратор, цель, сроки, бюджет и ожидаемые результаты.</span></div><i>+</i></summary><div className="programEditBody"><PassportFields members={members} title={title} setTitle={setTitle} ministry={ministry} setMinistry={setMinistry} minister={minister} setMinister={setMinister} curator={curator} setCurator={setCurator} nationalGoal={nationalGoal} setNationalGoal={setNationalGoal} start={start} setStart={setStart} end={end} setEnd={setEnd} budget={budget} setBudget={setBudget} expected={expected} setExpected={setExpected}/><button className="primary" disabled={busy} onClick={()=>void saveProgram(false)}>Сохранить паспорт</button></div></details>}

   <div className="programGoalSection"><div className="programSectionTitle"><div><small>ЦЕЛЕПОЛАГАНИЕ</small><h3>Цели и показатели</h3></div><span>{myGoals.length}</span></div><div className="programGoals">{myGoals.map(x=><article key={x.id}><b>{x.goal_text}</b><p>{x.indicator_name}</p><div><span>База: {x.baseline_value??'—'} {x.unit||''}</span><strong>Цель: {x.target_value??'—'} {x.unit||''}{x.target_year?' · '+x.target_year:''}</strong>{canEdit&&selected.status!=='adopted'&&<button onClick={()=>void del('goal',x.id)}>×</button>}</div></article>)}</div>
    {canEdit&&['draft','revision','minister_review'].includes(selected.status)&&<div className="programGoalForm"><input value={goalText} onChange={e=>setGoalText(e.target.value)} placeholder="Цель программы"/><input value={indicator} onChange={e=>setIndicator(e.target.value)} placeholder="Измеримый показатель"/><input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="Единица"/><input type="number" value={baseline} onChange={e=>setBaseline(e.target.value)} placeholder="База"/><input type="number" value={target} onChange={e=>setTarget(e.target.value)} placeholder="Цель"/><input type="number" value={targetYear} onChange={e=>setTargetYear(e.target.value)} placeholder="Год"/><button disabled={busy} onClick={()=>void addGoal()}>＋ Добавить показатель</button></div>}
   </div>

   <div className="programComponentsSection"><div className="programSectionTitle"><div><small>СТРУКТУРА</small><h3>Направления и мероприятия</h3></div><span>{myComponents.length}/25</span></div>
    <div className="programDirections">{dirs.length===0?<div className="emptyState">Структурных элементов ещё нет.</div>:dirs.map(d=><article key={d}><header><b>{d}. {myComponents.find(x=>x.direction_no===d)?.direction_title}</b><span>{myComponents.filter(x=>x.direction_no===d).length} элементов</span></header>{myComponents.filter(x=>x.direction_no===d).map(x=><div className="programComponent" key={x.id}><span>{x.component_kind==='project'?'Проект':x.component_kind==='target_program'?'Целевая программа':'Мероприятие'}</span><div><b>{x.title}</b><p>{x.goal_text}</p></div><strong>{Number(x.budget).toLocaleString('ru-RU')}</strong>{canEdit&&selected.status!=='adopted'&&<button onClick={()=>void del('component',x.id)}>×</button>}</div>)}</article>)}</div>
    {canEdit&&['draft','revision','minister_review'].includes(selected.status)&&<div className="programComponentForm"><label>№ направления<select value={directionNo} onChange={e=>setDirectionNo(Number(e.target.value))}>{[1,2,3].map(n=><option key={n}>{n}</option>)}</select></label><label>Название направления<input value={directionTitle} onChange={e=>setDirectionTitle(e.target.value)}/></label><label>Тип<select value={componentKind} onChange={e=>setComponentKind(e.target.value as Component['component_kind'])}><option value="project">Проект</option><option value="target_program">Целевая программа</option><option value="measure">Мероприятие</option></select></label><label>Название<input value={componentTitle} onChange={e=>setComponentTitle(e.target.value)}/></label><label className="componentGoal">Цель элемента<textarea rows={2} value={componentGoal} onChange={e=>setComponentGoal(e.target.value)}/></label><label>Бюджет<input type="number" min="0" value={componentBudget} onChange={e=>setComponentBudget(e.target.value)}/></label><button disabled={busy||myComponents.length>=25} onClick={()=>void addComponent()}>＋ Добавить элемент</button></div>}
   </div>

   <section className={'programReadiness '+(selectedReadiness?.ready?'ready':'issues')}>
    <div className="programReadinessHead"><div><small>АВТОПРОВЕРКА ГОТОВНОСТИ</small><h3>{selectedReadiness?.ready?'Программа готова к согласованию':'Есть обязательные пробелы'}</h3></div><span>{selectedReadiness?.ready?'✓':'!'}</span></div>
    {selectedReadiness&&!selectedReadiness.ready&&<ul>{selectedReadiness.issues.map(x=><li key={x}>{x}</li>)}</ul>}
    {selectedReadiness&&<div className="programReadinessStats"><span>Целей <b>{selectedReadiness.goals}</b></span><span>Направлений <b>{selectedReadiness.directions}/3</b></span><span>Элементов <b>{selectedReadiness.components}/25</b></span><span>Бюджет элементов <b>{Number(selectedReadiness.component_budget).toLocaleString('ru-RU')}</b></span></div>}
   </section>

   <div className="programWorkflow">
    <div><small>МАРШРУТ СОГЛАСОВАНИЯ</small><b>Разработка → министр → Председатель Правительства → заседание Правительства</b>{vote&&<span>Связанное голосование: {vote.status==='open'?'открыто':vote.result_label||'закрыто'}</span>}</div>
    <div className="programWorkflowActions">
     {canEdit&&['draft','revision'].includes(selected.status)&&<button onClick={()=>void advance('submit_minister')}>На проверку министру</button>}
     {(teacher||selected.responsible_minister_id===activeMe.user_id)&&selected.status==='minister_review'&&<><button onClick={()=>void advance('minister_revision')}>На доработку</button><button className="primary" onClick={()=>void advance('minister_approve')}>Одобрить министром</button></>}
     {(teacher||isPM)&&selected.status==='pm_review'&&<><button onClick={()=>void advance('pm_revision')}>На доработку</button><button className="primary" onClick={()=>void advance('pm_ready')}>Готово к заседанию</button></>}
     {(teacher||isPM)&&selected.status==='ready'&&<button className="primary" onClick={()=>void openVote()}>Открыть голосование Правительства</button>}
    </div>
   </div>
  </>}
 </section>;
}

function PassportFields(p:any){
 return <div className="passportFields">
  <label>Название ГП<input value={p.title} onChange={(e:any)=>p.setTitle(e.target.value)}/></label>
  <label>Ответственное министерство<input value={p.ministry} onChange={(e:any)=>p.setMinistry(e.target.value)}/></label>
  <label>Ответственный министр<select value={p.minister} onChange={(e:any)=>p.setMinister(e.target.value)}><option value="">Не назначен</option>{p.members.filter((m:any)=>m.kind==='student').map((m:any)=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label>
  <label>Куратор<select value={p.curator} onChange={(e:any)=>p.setCurator(e.target.value)}><option value="">Не назначен</option>{p.members.filter((m:any)=>m.kind==='student').map((m:any)=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label>
  <label className="passportGoal">Национальная цель<select value={p.nationalGoal} onChange={(e:any)=>p.setNationalGoal(e.target.value)}><option value="">Выберите цель…</option>{nationalGoals.map(x=><option key={x}>{x}</option>)}</select></label>
  <label>Начало<input type="date" value={p.start} onChange={(e:any)=>p.setStart(e.target.value)}/></label>
  <label>Завершение<input type="date" value={p.end} onChange={(e:any)=>p.setEnd(e.target.value)}/></label>
  <label>Общий бюджет<input type="number" min="0" value={p.budget} onChange={(e:any)=>p.setBudget(e.target.value)}/></label>
  <label className="passportResults">Ожидаемые результаты<textarea rows={3} value={p.expected} onChange={(e:any)=>p.setExpected(e.target.value)}/></label>
 </div>;
}
