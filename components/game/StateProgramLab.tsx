'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import StageModuleHeader from '../ui/StageModuleHeader';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';
import StateProgramEditor from './StateProgramEditor';
import {programMoney,programStatusLabel,type StateProgram,type ProgramGoal,type ProgramComponent,type ProgramExpense,type ProgramPriority} from './stateProgramModel';
import styles from './StageForms.module.css';

type Address={id:string;title:string;body_text:string;video_url:string|null;status:'draft'|'published';updated_at:string};
type Readiness={ready:boolean;issues:string[];goals:number;directions:number;components:number;budget_years?:number;expected_budget_years?:number};
type BudgetYear={id:string;program_id:string;budget_year:number;amount:number|string};
type MinistryAssignment={unit_id:string;user_id:string};
type MinistryUnit={id:string;head_user_id:string|null};
export default function StateProgramLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,votes,setError}=g;
 const [programs,setPrograms]=useState<StateProgram[]>([]),[addresses,setAddresses]=useState<Address[]>([]),[priorities,setPriorities]=useState<ProgramPriority[]>([]),[readiness,setReadiness]=useState<Record<string,Readiness>>({});
 const [goals,setGoals]=useState<ProgramGoal[]>([]),[components,setComponents]=useState<ProgramComponent[]>([]),[expenses,setExpenses]=useState<ProgramExpense[]>([]),[years,setYears]=useState<BudgetYear[]>([]);
 const [ministryAssignments,setMinistryAssignments]=useState<MinistryAssignment[]>([]),[ministryUnits,setMinistryUnits]=useState<MinistryUnit[]>([]);
 const [selectedId,setSelectedId]=useState(''),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false);
 const [addressTitle,setAddressTitle]=useState('Послание Президента Российской Федерации Федеральному Собранию'),[addressBody,setAddressBody]=useState(''),[addressVideo,setAddressVideo]=useState('');
 const [selectedGoals,setSelectedGoals]=useState<string[]>(['','','','','']),[goalsDirty,setGoalsDirty]=useState(false);
 const addressDirty=useRef(false),addressVersion=useRef(0),busyRef=useRef(false),request=useRef(0),alive=useRef(true),creatingRef=useRef(creating),selectedRef=useRef(selectedId);
 creatingRef.current=creating;selectedRef.current=selectedId;
 const viewScope=[game?.id,me?.user_id,teacher].join('|'),scope=useRef(viewScope);scope.current=viewScope;
 const active=()=>alive.current&&scope.current===viewScope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++}},[]);
 useEffect(()=>{request.current++;addressDirty.current=false;addressVersion.current=0;setGoalsDirty(false);setSelectedGoals(['','','','','']);busyRef.current=false;setPrograms([]);setAddresses([]);setPriorities([]);setReadiness({});setGoals([]);setComponents([]);setExpenses([]);setYears([]);setMinistryAssignments([]);setMinistryUnits([]);setSelectedId('');setCreating(false);creatingRef.current=false;selectedRef.current='';setBusy(false);setAddressTitle('Послание Президента Российской Федерации Федеральному Собранию');setAddressBody('');setAddressVideo('');},[viewScope]);
 const role=stageRoleTitles(g),isPM=role.split(' | ').some(title=>/^председатель\s+правительства(?:\s|$)/u.test(title)),isMinister=role.includes('министр'),isPresident=role.includes('президент');
 async function load(){
  if(!active()||!game)return;const version=++request.current,current=()=>active()&&version===request.current;
  const results=await Promise.all([
   supabase.from('state_programs').select('*,total_budget_text:total_budget::text').eq('game_id',game.id).order('created_at'),
   supabase.from('state_program_goals').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('state_program_components').select('*,budget_text:budget::text').eq('game_id',game.id).order('direction_no').order('created_at'),
   supabase.from('state_program_expenses').select('*,amount_text:amount::text').eq('game_id',game.id).order('position'),
   supabase.from('presidential_addresses').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('presidential_priorities').select('*').eq('game_id',game.id).order('priority_no'),
   supabase.from('state_program_budget_years').select('*,amount_text:amount::text').eq('game_id',game.id).order('budget_year'),
   supabase.from('institution_assignments').select('unit_id,user_id').eq('game_id',game.id).eq('unit_kind','ministry'),
   supabase.from('institution_units').select('id,head_user_id').eq('game_id',game.id).eq('unit_kind','ministry')
  ]);
  if(!current())return;const failed=results.find(x=>x.error);if(failed?.error){setError(failed.error);return;}
  const [p,gl,c,e,a,pr,by,assigned,units]=results;
  const rows=((p.data||[]) as (StateProgram&{total_budget_text?:string})[]).map(x=>({...x,total_budget:x.total_budget_text??x.total_budget}));
  const checks=await Promise.all(rows.map(async x=>({id:x.id,response:await supabase.rpc('get_state_program_readiness',{p_program_id:x.id})})));
  if(!current())return;const failure=checks.find(x=>x.response.error);if(failure?.response.error){setError(failure.response.error);return;}
  setPrograms(rows);setGoals((gl.data||[]) as ProgramGoal[]);
  setComponents(((c.data||[]) as (ProgramComponent&{budget_text?:string})[]).map(x=>({...x,budget:x.budget_text??x.budget})));
  setExpenses(((e.data||[]) as (ProgramExpense&{amount_text?:string})[]).map(x=>({...x,amount:x.amount_text??x.amount})));
  setPriorities((pr.data||[]) as ProgramPriority[]);
  setYears(((by.data||[]) as (BudgetYear&{amount_text?:string})[]).map(x=>({...x,amount:x.amount_text??x.amount})));
  setReadiness(Object.fromEntries(checks.map(x=>[x.id,x.response.data as Readiness])));
  setMinistryAssignments((assigned.data||[]) as MinistryAssignment[]);
  setMinistryUnits((units.data||[]) as MinistryUnit[]);
  if(!creatingRef.current&&!selectedRef.current&&rows[0])setSelectedId(rows[0].id);
  const addressRows=(a.data||[]) as Address[];setAddresses(addressRows);
  const draft=addressRows.find(x=>x.status==='draft')||addressRows[0];if(draft&&!addressDirty.current){setAddressTitle(draft.title);setAddressBody(draft.body_text);setAddressVideo(draft.video_url||'')}
  if(!goalsDirty){
   const saved=draft?((pr.data||[]) as ProgramPriority[]).filter(x=>x.address_id===draft.id).map(x=>x.national_goal||x.title):[];
   setSelectedGoals(saved.length>=5?saved:[...saved,...Array(5-saved.length).fill('')]);
  }
 }
 useGameTableSync(game?.id,['state_programs','state_program_goals','state_program_components','state_program_expenses','state_program_budget_commitments','presidential_addresses','presidential_priorities','state_program_budget_years','institution_assignments','institution_units'],load,viewScope);
 if(!game||!me)return null;
 const selected=creating?undefined:programs.find(p=>p.id===selectedId),publishedAddress=addresses.find(x=>x.status==='published'),activeAddress=addresses.find(x=>x.status==='draft')||publishedAddress;
 const publishedPriorities=publishedAddress?priorities.filter(x=>x.address_id===publishedAddress.id):[],check=selected?readiness[selected.id]:undefined;
 const appointedColleague=!!selected?.responsible_minister_id&&!me.roster_archived_at&&ministryAssignments.some(a=>a.user_id===me.user_id&&ministryUnits.some(u=>u.id===a.unit_id&&u.head_user_id===selected.responsible_minister_id));
 const editable=selected?(teacher||selected.created_by===me.user_id||selected.responsible_minister_id===me.user_id||appointedColleague)&&['draft','revision'].includes(selected.status)&&!selected.signed_at:teacher||isMinister||isPM;
 const vote=votes.find(v=>v.id===selected?.government_vote_id);
 async function run(name:string,args:Record<string,unknown>){
  if(!active()||busyRef.current)return false;busyRef.current=true;setBusy(true);
  try{const r=await supabase.rpc(name,args);if(!active())return false;if(r.error){setError(r.error);return false;}await load();if(!active())return false;await g.refresh();return active()}
  catch(error){if(active())setError(error);return false}finally{if(active()){busyRef.current=false;setBusy(false)}}
 }
 async function saveAddress(){
  if(!active()||busyRef.current)return;const version=addressVersion.current;busyRef.current=true;setBusy(true);
  try{const r=await supabase.rpc('save_presidential_address',{p_game_id:game!.id,p_address_id:addresses.find(x=>x.status==='draft')?.id||null,p_title:addressTitle.trim(),p_body_text:addressBody.trim(),p_video_url:addressVideo.trim()||null});if(!active())return;if(r.error){setError(r.error);return;}if(addressVersion.current===version)addressDirty.current=false;await load()}
  catch(error){if(active())setError(error)}finally{if(active()){busyRef.current=false;setBusy(false)}}
 }
 const formulatedGoals=selectedGoals.map(x=>x.trim());
 const validGoals=selectedGoals.length>=5&&selectedGoals.length<=6
  &&formulatedGoals.every(x=>x.length>=12&&x.length<=500)
  &&new Set(formulatedGoals.map(x=>x.toLocaleLowerCase('ru-RU'))).size===formulatedGoals.length;
 async function saveGoals(){
  if(!activeAddress||activeAddress.status!=='draft'||!validGoals)return;
  const chosen=[...formulatedGoals];setGoalsDirty(false);
  const ok=await run('set_presidential_address_goals',{p_address_id:activeAddress.id,p_goals:chosen});
  if(!ok)setGoalsDirty(true);
 }
 function updateGoal(index:number,text:string){
  setGoalsDirty(true);
  setSelectedGoals(current=>current.map((goal,i)=>i===index?text:goal));
 }
 return <section className={'programLab '+styles.programWorkspace}>
  <StageModuleHeader eyebrow="Управление по целям · Этапы 10–11" title="Государственные программы" description="Национальная цель, измеримые показатели, мероприятия и обоснованные расходы. Подтверждение автора → проверка министра → представление и голосование Правительства → подпись и публикация Председателем Правительства." stats={[{label:'ПП РФ №786',value:'Госпрограммы',detail:'Актуальная система управления государственными программами'},{label:'Указ №309',value:'Национальные цели',detail:'Национальные цели до 2030 и 2036 годов'}]}/>
  <section className={`${styles.panel} ${styles.addressPanel}`} aria-label="Послание и приоритеты Президента"><div className={styles.sectionHead}><div><h3>Послание Президента и приоритеты</h3><p>Опубликованные приоритеты связываются с паспортом государственной программы.</p></div><span className={styles.pill}>{publishedAddress?'Опубликовано':'Черновик'}</span></div>
   {(teacher||isPresident)&&!publishedAddress&&<div className={`${styles.grid} ${styles.addressForm}`}>
    <label className={styles.field}>Название послания<input disabled={busy} value={addressTitle} onChange={e=>{addressDirty.current=true;addressVersion.current++;setAddressTitle(e.target.value)}}/></label>
    <label className={styles.field}>Видео или ссылка<input disabled={busy} value={addressVideo} onChange={e=>{addressDirty.current=true;addressVersion.current++;setAddressVideo(e.target.value)}}/></label>
    <label className={styles.field+' '+styles.wide}>Текст послания<textarea disabled={busy} rows={4} value={addressBody} onChange={e=>{addressDirty.current=true;addressVersion.current++;setAddressBody(e.target.value)}}/></label>
    <div className={`${styles.addressActions} ${styles.wide}`}>
      {addressBody.trim().length<20&&<span className={styles.addressHint}>Чтобы сохранить послание, введите не менее 20 символов.</span>}
      <button type="button" className="primary" disabled={busy||addressBody.trim().length<20} onClick={()=>void saveAddress()}>Сохранить послание</button>
     </div>
   </div>}
   <section className={styles.section} aria-label="Национальные цели Послания Президента">
    <div className={styles.sectionHead}><div><h3>Национальные цели Послания Президента</h3>
     <p>Президент самостоятельно формулирует пять или шесть целей в своём послании Федеральному Собранию. После утверждения они становятся основанием для государственных программ.</p>
     <span className={styles.goalProgress}>{publishedAddress?'Цели утверждены':`Заполнено: ${formulatedGoals.filter(x=>x.length>=12).length} из ${selectedGoals.length}`}</span></div></div>
    {(teacher||isPresident)&&activeAddress?.status==='draft'&&<div className={styles.programGoalChoices}>
     {selectedGoals.map((goal,index)=><label key={index} className={styles.programGoalChoice}>
      <span className={styles.goalOrdinal}>{index+1}.</span>
      <span className={styles.goalInputGroup}>Цель {index+1}
       <textarea rows={2} maxLength={500} disabled={busy} value={goal} onChange={e=>updateGoal(index,e.target.value)} placeholder="Сформулируйте собственную цель Президента — что должно измениться в стране"/>
      </span>
     </label>)}
     <div className={styles.programGoalControls}>
      {selectedGoals.length===5&&<button type="button" disabled={busy} onClick={()=>{setGoalsDirty(true);setSelectedGoals(x=>[...x,''])}}>Добавить шестую цель</button>}
      {selectedGoals.length===6&&<button type="button" disabled={busy} onClick={()=>{setGoalsDirty(true);setSelectedGoals(x=>x.slice(0,5))}}>Убрать шестую цель</button>}
     </div>
     <div className={styles.actions}><button type="button" disabled={busy||!validGoals||!goalsDirty} onClick={()=>void saveGoals()}>Сохранить выбранные цели</button>
      <button type="button" className="primary" disabled={busy||addressDirty.current||goalsDirty||!validGoals||priorities.filter(x=>x.address_id===activeAddress.id).length!==selectedGoals.length} onClick={()=>void run('publish_presidential_address',{p_address_id:activeAddress.id})}>Утвердить цели и опубликовать послание</button></div>
    </div>}
    {(teacher||isPresident)&&!activeAddress&&<p className={styles.notice}>Сначала заполните и сохраните текст послания. После этого можно сформулировать 5–6 собственных целей и утвердить их.</p>}
    {activeAddress?.status==='published'&&<ol className={styles.approvedGoalList}>{publishedPriorities.map(x=><li key={x.id}>{x.national_goal||x.title}</li>)}</ol>}
    {activeAddress?.status==='draft'&&!(teacher||isPresident)&&<p className={styles.notice}>Президент ещё не утвердил цели. Можно просматривать раздел, но использовать президентские цели в программах до публикации послания нельзя.</p>}
   </section>
  </section>
  {(programs.length>0||teacher||isMinister||isPM)&&<div className="programPicker" aria-label="Выбор государственной программы"><div className="programTabs">{programs.map(p=><button type="button" key={p.id} aria-pressed={!creating&&p.id===selectedId} className={!creating&&p.id===selectedId?'active':''} onClick={()=>{creatingRef.current=false;setCreating(false);setSelectedId(p.id)}}><b>{p.title}</b><span>{programStatusLabel[p.status]}</span></button>)}</div>{(teacher||isMinister||isPM)&&<button type="button" className="programNew" onClick={()=>{creatingRef.current=true;setCreating(true);setSelectedId('')}}>Новая программа</button>}</div>}
  {(selected||editable)&&<StateProgramEditor key={viewScope+'|'+(selected?.id||'new')} g={g} program={selected||null} goals={goals.filter(x=>x.program_id===selected?.id)} components={components.filter(x=>x.program_id===selected?.id)} expenses={expenses.filter(x=>x.program_id===selected?.id)} priorities={publishedPriorities} editable={editable} onSaved={async id=>{if(!active())return;creatingRef.current=false;setCreating(false);setSelectedId(id);await load()}}/>}
  {selected&&<>
   {selected.signed_at&&<p className={styles.notice}>Подписал Председатель Правительства: {members.find(m=>m.user_id===selected.signed_by)?.full_name||'Уполномоченный участник'} · {new Date(selected.signed_at).toLocaleString('ru-RU')}. {selected.status==='adopted'?'Программа принята Правительством.':'Для этой программы подпись была зарегистрирована до завершения голосования.'}</p>}
   {selected.form_version!==2&&years.some(x=>x.program_id===selected.id)&&<section className={styles.panel}><h3>Финансирование сохранённой программы</h3><div className={styles.statList}>{years.filter(x=>x.program_id===selected.id).map(x=><div key={x.id}><span>{x.budget_year}</span><strong>{programMoney(x.amount)}</strong></div>)}</div><p>Бюджет паспорта: <b>{programMoney(selected.total_budget)}</b></p></section>}
   <section className={styles.panel} aria-label="Проверка готовности программы"><h3>{check?.ready?'Программа готова к согласованию':'Проверка заполнения программы'}</h3>{check&&!check.ready&&<ul>{check.issues.map(x=><li key={x}>{x}</li>)}</ul>}<div className={styles.statList}><div><span>Цели</span><strong>{check?.goals??0}</strong></div><div><span>Направления</span><strong>{check?.directions??0} / 3</strong></div><div><span>Структурные элементы</span><strong>{check?.components??0} / 25</strong></div><div><span>Финансирование по годам</span><strong>{check?.budget_years??0} / {check?.expected_budget_years??0}</strong></div></div></section>
   <section className={styles.programApproval} aria-label="Согласование и подписание государственной программы">
    <div className={styles.programApprovalHeading}>
     <div><h3>Согласование государственной программы</h3><p>После доклада на заседании члены Правительства голосуют. Принятую программу подписывает и публикует Председатель Правительства.</p></div>
     <span className={styles.programApprovalState}>{selected.status==='adopted'&&selected.signed_at?'Подписана и опубликована':programStatusLabel[selected.status]}</span>
    </div>
    <ol className={styles.programApprovalSteps} aria-label="Порядок принятия программы">
     <li>Подготовка и проверка</li><li>Представление и голосование</li><li>Подпись и публикация</li>
    </ol>
    {vote&&<p className={styles.programApprovalNotice} role="status">Голосование Правительства: {vote.status==='open'?'Идёт · голосуют зарегистрированные участники':vote.result_label||'Завершено'}.</p>}
    {selected.status==='ready'&&<p className={styles.programApprovalNotice}>Программа подготовлена. Включите её в повестку Этапа 11. Голосование открывается только после доклада.</p>}
    {selected.status==='adopted'&&!selected.signed_at&&<p className={styles.programApprovalNotice}>Правительство поддержало программу. Ожидается подпись и официальная публикация.</p>}
    {selected.status==='rejected'&&<p className={styles.programApprovalNotice}>Программа отклонена. Подписание и публикация по данному голосованию недоступны.</p>}
    <div className={styles.programApprovalActions}>
     {(teacher||selected.responsible_minister_id===me.user_id)&&selected.status==='minister_review'&&<><button type="button" disabled={busy} onClick={()=>void run('advance_state_program',{p_program_id:selected.id,p_action:'minister_revision'})}>Вернуть автору на доработку</button><button type="button" disabled={busy} className="primary" onClick={()=>void run('advance_state_program',{p_program_id:selected.id,p_action:'minister_approve'})}>Одобрить и передать Председателю Правительства</button></>}
     {(teacher||isPM)&&selected.status==='pm_review'&&<><button type="button" disabled={busy} onClick={()=>void run('advance_state_program',{p_program_id:selected.id,p_action:'pm_revision'})}>Вернуть на доработку</button><button type="button" disabled={busy} className="primary" onClick={()=>void run('advance_state_program',{p_program_id:selected.id,p_action:'pm_ready'})}>Согласовать для включения в повестку</button></>}
     {(teacher||isPM)&&selected.status==='adopted'&&!selected.signed_at&&<button type="button" disabled={busy} className="primary" onClick={()=>void run('sign_adopted_state_program',{p_program_id:selected.id})}>Подписать и опубликовать принятую программу</button>}
    </div>
   </section>
  </>}
 </section>;
}
