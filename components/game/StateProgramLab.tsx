'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import StyledSelect from '../ui/StyledSelect';
import StageModuleHeader from '../ui/StageModuleHeader';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';
import StateProgramEditor from './StateProgramEditor';
import {nationalGoals,programMoney,programStatusLabel,type StateProgram,type ProgramGoal,type ProgramComponent,type ProgramExpense,type ProgramPriority} from './stateProgramModel';
import styles from './StageForms.module.css';

type Address={id:string;title:string;body_text:string;video_url:string|null;status:'draft'|'published';updated_at:string};
type Readiness={ready:boolean;issues:string[];goals:number;directions:number;components:number;budget_years?:number;expected_budget_years?:number};
type BudgetYear={id:string;program_id:string;budget_year:number;amount:number|string};
export default function StateProgramLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,votes,setError}=g;
 const [programs,setPrograms]=useState<StateProgram[]>([]),[addresses,setAddresses]=useState<Address[]>([]),[priorities,setPriorities]=useState<ProgramPriority[]>([]),[readiness,setReadiness]=useState<Record<string,Readiness>>({});
 const [goals,setGoals]=useState<ProgramGoal[]>([]),[components,setComponents]=useState<ProgramComponent[]>([]),[expenses,setExpenses]=useState<ProgramExpense[]>([]),[years,setYears]=useState<BudgetYear[]>([]);
 const [selectedId,setSelectedId]=useState(''),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false);
 const [addressTitle,setAddressTitle]=useState('Послание Президента Российской Федерации Федеральному Собранию'),[addressBody,setAddressBody]=useState(''),[addressVideo,setAddressVideo]=useState('');
 const [priorityNo,setPriorityNo]=useState(1),[priorityTitle,setPriorityTitle]=useState(''),[priorityDescription,setPriorityDescription]=useState(''),[priorityNationalGoal,setPriorityNationalGoal]=useState('');
 const addressDirty=useRef(false),addressVersion=useRef(0),priorityVersion=useRef(0),busyRef=useRef(false),request=useRef(0),alive=useRef(true),creatingRef=useRef(creating),selectedRef=useRef(selectedId);
 creatingRef.current=creating;selectedRef.current=selectedId;
 const viewScope=[game?.id,me?.user_id,teacher].join('|'),scope=useRef(viewScope);scope.current=viewScope;
 const active=()=>alive.current&&scope.current===viewScope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++}},[]);
 useEffect(()=>{request.current++;addressDirty.current=false;addressVersion.current=0;priorityVersion.current=0;busyRef.current=false;setPrograms([]);setAddresses([]);setPriorities([]);setReadiness({});setGoals([]);setComponents([]);setExpenses([]);setYears([]);setSelectedId('');setCreating(false);creatingRef.current=false;selectedRef.current='';setBusy(false);setAddressTitle('Послание Президента Российской Федерации Федеральному Собранию');setAddressBody('');setAddressVideo('');setPriorityNo(1);setPriorityTitle('');setPriorityDescription('');setPriorityNationalGoal('')},[viewScope]);
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
   supabase.from('state_program_budget_years').select('*,amount_text:amount::text').eq('game_id',game.id).order('budget_year')
  ]);
  if(!current())return;const failed=results.find(x=>x.error);if(failed?.error){setError(failed.error);return;}
  const [p,gl,c,e,a,pr,by]=results;
  const rows=((p.data||[]) as (StateProgram&{total_budget_text?:string})[]).map(x=>({...x,total_budget:x.total_budget_text??x.total_budget}));
  const checks=await Promise.all(rows.map(async x=>({id:x.id,response:await supabase.rpc('get_state_program_readiness',{p_program_id:x.id})})));
  if(!current())return;const failure=checks.find(x=>x.response.error);if(failure?.response.error){setError(failure.response.error);return;}
  setPrograms(rows);setGoals((gl.data||[]) as ProgramGoal[]);
  setComponents(((c.data||[]) as (ProgramComponent&{budget_text?:string})[]).map(x=>({...x,budget:x.budget_text??x.budget})));
  setExpenses(((e.data||[]) as (ProgramExpense&{amount_text?:string})[]).map(x=>({...x,amount:x.amount_text??x.amount})));
  setPriorities((pr.data||[]) as ProgramPriority[]);
  setYears(((by.data||[]) as (BudgetYear&{amount_text?:string})[]).map(x=>({...x,amount:x.amount_text??x.amount})));
  setReadiness(Object.fromEntries(checks.map(x=>[x.id,x.response.data as Readiness])));
  if(!creatingRef.current&&!selectedRef.current&&rows[0])setSelectedId(rows[0].id);
  const addressRows=(a.data||[]) as Address[];setAddresses(addressRows);
  const draft=addressRows.find(x=>x.status==='draft')||addressRows[0];if(draft&&!addressDirty.current){setAddressTitle(draft.title);setAddressBody(draft.body_text);setAddressVideo(draft.video_url||'')}
 }
 useGameTableSync(game?.id,['state_programs','state_program_goals','state_program_components','state_program_expenses','state_program_budget_commitments','presidential_addresses','presidential_priorities','state_program_budget_years'],load,viewScope);
 if(!game||!me)return null;
 const selected=creating?undefined:programs.find(p=>p.id===selectedId),publishedAddress=addresses.find(x=>x.status==='published'),activeAddress=addresses.find(x=>x.status==='draft')||publishedAddress;
 const publishedPriorities=publishedAddress?priorities.filter(x=>x.address_id===publishedAddress.id):[],check=selected?readiness[selected.id]:undefined;
 const editable=selected?(teacher||selected.created_by===me.user_id||selected.responsible_minister_id===me.user_id)&&['draft','revision'].includes(selected.status)&&!selected.signed_at:teacher||isMinister||isPM;
 const vote=votes.find(v=>v.id===selected?.government_vote_id);
 async function run(name:string,args:Record<string,unknown>){
  if(!active()||busyRef.current)return false;busyRef.current=true;setBusy(true);
  try{const r=await supabase.rpc(name,args);if(!active())return false;if(r.error){setError(r.error);return false;}await load();if(!active())return false;await g.refresh();return active()}
  catch(error){if(active())setError(error);return false}finally{if(active()){busyRef.current=false;setBusy(false)}}
 }
 async function saveAddress(){
  if(!active()||busyRef.current)return;const version=addressVersion.current;busyRef.current=true;setBusy(true);
  try{const r=await supabase.rpc('save_presidential_address',{p_game_id:game!.id,p_address_id:addresses.find(x=>x.status==='draft')?.id||null,p_title:addressTitle.trim(),p_body:addressBody.trim(),p_video_url:addressVideo.trim()||null});if(!active())return;if(r.error){setError(r.error);return;}if(addressVersion.current===version)addressDirty.current=false;await load()}
  catch(error){if(active())setError(error)}finally{if(active()){busyRef.current=false;setBusy(false)}}
 }
 async function addPriority(){
  if(!active()||!activeAddress||activeAddress.status!=='draft')return;const version=priorityVersion.current;
  const ok=await run('add_presidential_priority',{p_address_id:activeAddress.id,p_priority_no:priorityNo,p_title:priorityTitle.trim(),p_description:priorityDescription.trim()||null,p_national_goal:priorityNationalGoal||null});
  if(ok&&active()&&version===priorityVersion.current){setPriorityNo(x=>x+1);setPriorityTitle('');setPriorityDescription('');setPriorityNationalGoal('')}
 }
 return <section className="programLab">
  <StageModuleHeader eyebrow="Управление по целям · Этапы 10–11" title="Государственные программы" description="Национальная цель, измеримые показатели, мероприятия и обоснованные расходы. Подтверждение автора → проверка министра → подпись Председателя Правительства → заседание Правительства." stats={[{label:'ПП РФ №786',value:'Госпрограммы',detail:'Актуальная система управления государственными программами'},{label:'Указ №309',value:'Национальные цели',detail:'Национальные цели до 2030 и 2036 годов'}]}/>
  <section className={styles.panel} aria-label="Послание и приоритеты Президента"><div className={styles.sectionHead}><div><h3>Послание Президента и приоритеты</h3><p>Опубликованные приоритеты связываются с паспортом государственной программы.</p></div><span className={styles.pill}>{publishedAddress?'Опубликовано':'Черновик'}</span></div>
   {(teacher||isPresident)&&!publishedAddress&&<div className={styles.grid}>
    <label className={styles.field}>Название послания<input disabled={busy} value={addressTitle} onChange={e=>{addressDirty.current=true;addressVersion.current++;setAddressTitle(e.target.value)}}/></label>
    <label className={styles.field}>Видео или ссылка<input disabled={busy} value={addressVideo} onChange={e=>{addressDirty.current=true;addressVersion.current++;setAddressVideo(e.target.value)}}/></label>
    <label className={styles.field+' '+styles.wide}>Текст послания<textarea disabled={busy} rows={5} value={addressBody} onChange={e=>{addressDirty.current=true;addressVersion.current++;setAddressBody(e.target.value)}}/></label>
    <button type="button" disabled={busy||addressBody.trim().length<20} onClick={()=>void saveAddress()}>Сохранить послание</button>
   </div>}
   {activeAddress&&<><div className={styles.rows}>{priorities.filter(x=>x.address_id===activeAddress.id).map(x=><article key={x.id} className={styles.row}><b>{x.priority_no}. {x.title}</b>{x.national_goal&&<p>{x.national_goal}</p>}{x.description&&<p>{x.description}</p>}</article>)}</div>
    {(teacher||isPresident)&&activeAddress.status==='draft'&&<section className={styles.section}><div className={styles.grid}>
     <label className={styles.field}>Номер приоритета<input disabled={busy} type="number" min="1" max="50" value={priorityNo} onChange={e=>setPriorityNo(Number(e.target.value)||1)}/></label>
     <label className={styles.field}>Название приоритета<input disabled={busy} value={priorityTitle} onChange={e=>{priorityVersion.current++;setPriorityTitle(e.target.value)}}/></label>
     <div className={styles.wide}><StyledSelect wrap disabled={busy} label="Национальная цель приоритета" value={priorityNationalGoal} onChange={value=>{priorityVersion.current++;setPriorityNationalGoal(value)}} options={[{value:'',label:'Не привязывать'},...nationalGoals.map(x=>({value:x,label:x}))]}/></div>
     <label className={styles.field+' '+styles.wide}>Содержание приоритета<textarea disabled={busy} rows={2} value={priorityDescription} onChange={e=>{priorityVersion.current++;setPriorityDescription(e.target.value)}}/></label>
    </div><div className={styles.actions}><button type="button" disabled={busy||priorityTitle.trim().length<3} onClick={()=>void addPriority()}>Добавить приоритет</button><button type="button" className="primary" disabled={busy||addressDirty.current||priorities.filter(x=>x.address_id===activeAddress.id).length===0} onClick={()=>void run('publish_presidential_address',{p_address_id:activeAddress.id})}>Опубликовать послание</button></div></section>}
   </>}
  </section>
  <div className="programPicker"><div className="programTabs">{programs.map(p=><button type="button" key={p.id} aria-pressed={!creating&&p.id===selectedId} className={!creating&&p.id===selectedId?'active':''} onClick={()=>{creatingRef.current=false;setCreating(false);setSelectedId(p.id)}}><b>{p.title}</b><span>{programStatusLabel[p.status]}</span></button>)}</div>{(teacher||isMinister||isPM)&&<button type="button" className="programNew" onClick={()=>{creatingRef.current=true;setCreating(true);setSelectedId('')}}>Новая программа</button>}</div>
  {(selected||editable)&&<StateProgramEditor key={viewScope+'|'+(selected?.id||'new')} g={g} program={selected||null} goals={goals.filter(x=>x.program_id===selected?.id)} components={components.filter(x=>x.program_id===selected?.id)} expenses={expenses.filter(x=>x.program_id===selected?.id)} priorities={publishedPriorities} editable={editable} onSaved={async id=>{if(!active())return;creatingRef.current=false;setCreating(false);setSelectedId(id);await load()}}/>}
  {selected&&<>
   {selected.signed_at&&<p className={styles.notice}>Подписал Председатель Правительства: {members.find(m=>m.user_id===selected.signed_by)?.full_name||'Уполномоченный участник'} · {new Date(selected.signed_at).toLocaleString('ru-RU')}. Программа опубликована в политическом процессе и добавлена в бюджет.</p>}
   {selected.form_version!==2&&years.some(x=>x.program_id===selected.id)&&<section className={styles.panel}><h3>Финансирование сохранённой программы</h3><div className={styles.statList}>{years.filter(x=>x.program_id===selected.id).map(x=><div key={x.id}><span>{x.budget_year}</span><strong>{programMoney(x.amount)}</strong></div>)}</div><p>Бюджет паспорта: <b>{programMoney(selected.total_budget)}</b></p></section>}
   <section className={styles.panel} aria-label="Проверка готовности программы"><h3>{check?.ready?'Программа готова к согласованию':'Проверка заполнения программы'}</h3>{check&&!check.ready&&<ul>{check.issues.map(x=><li key={x}>{x}</li>)}</ul>}<div className={styles.statList}><div><span>Цели</span><strong>{check?.goals??0}</strong></div><div><span>Направления</span><strong>{check?.directions??0} / 3</strong></div><div><span>Структурные элементы</span><strong>{check?.components??0} / 25</strong></div><div><span>Финансирование по годам</span><strong>{check?.budget_years??0} / {check?.expected_budget_years??0}</strong></div></div></section>
   <section className={styles.panel} aria-label="Согласование и подпись программы"><div className={styles.sectionHead}><h3>Согласование и подпись</h3><span className={styles.pill}>{programStatusLabel[selected.status]}</span></div><p>Автор подтверждает полную форму, министр проверяет её, Председатель Правительства подписывает. Затем программа рассматривается на заседании Правительства.</p>{vote&&<p>Голосование Правительства: {vote.status==='open'?'Открыто':vote.result_label||'Закрыто'}</p>}<div className={styles.actions}>
    {(teacher||selected.responsible_minister_id===me.user_id)&&selected.status==='minister_review'&&<><button disabled={busy} onClick={()=>void run('advance_state_program',{p_program_id:selected.id,p_action:'minister_revision'})}>Вернуть автору на доработку</button><button disabled={busy} className="primary" onClick={()=>void run('advance_state_program',{p_program_id:selected.id,p_action:'minister_approve'})}>Одобрить и передать на подпись</button></>}
    {(teacher||isPM)&&selected.status==='pm_review'&&<><button disabled={busy} onClick={()=>void run('advance_state_program',{p_program_id:selected.id,p_action:'pm_revision'})}>Вернуть на доработку</button><button disabled={busy} className="primary" onClick={()=>void run('advance_state_program',{p_program_id:selected.id,p_action:'pm_ready'})}>Подписать и опубликовать программу</button></>}
    {(teacher||isPM)&&selected.status==='ready'&&<button disabled={busy} className="primary" onClick={()=>void run('open_state_program_government_vote',{p_program_id:selected.id})}>Открыть голосование Правительства</button>}
   </div></section>
  </>}
 </section>;
}
