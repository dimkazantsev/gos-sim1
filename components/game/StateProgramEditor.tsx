'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import StyledSelect from '../ui/StyledSelect';
import {IconAction} from '../ui/IconAction';
import type {ReturnTypeRepublic} from './viewTypes';
import {expenseKopecks,kopecksMoney,nationalGoals,programMoney,type StateProgram,type ProgramGoal,type ProgramComponent,type ProgramExpense,type ProgramPriority} from './stateProgramModel';
import styles from './StageForms.module.css';
import ProgramStructureTree from './ProgramStructureTree';

type GoalDraft={key:string;goal_text:string;indicator_name:string;unit:string;baseline_value:string;target_value:string;target_year:string};
type ComponentDraft={key:string;direction_no:number;direction_title:string;component_kind:ProgramComponent['component_kind'];title:string;goal_text:string;start_date:string;end_date:string;goal_key:string};
type ExpenseDraft={key:string;component_key:string;indicator_name:string;justification:string;budget_year:string;amount:string};
type Passport={title:string;responsible_ministry:string;responsible_minister_id:string;curator_id:string;national_goal:string;presidential_priority_id:string;participants:string;start_date:string;end_date:string;expected_results:string};
const blankGoal=():GoalDraft=>({key:crypto.randomUUID(),goal_text:'',indicator_name:'',unit:'',baseline_value:'',target_value:'',target_year:''});
const blankComponent=(direction=1):ComponentDraft=>({key:crypto.randomUUID(),direction_no:direction,direction_title:'',component_kind:'project',title:'',goal_text:'',start_date:'',end_date:'',goal_key:''});
const blankExpense=(component_key='',budget_year=''):ExpenseDraft=>({key:crypto.randomUUID(),component_key,indicator_name:'',justification:'',budget_year,amount:''});
const blankPassport:Passport={title:'',responsible_ministry:'',responsible_minister_id:'',curator_id:'',national_goal:'',presidential_priority_id:'',participants:'',start_date:'',end_date:'',expected_results:''};

export default function StateProgramEditor({g,program,goals,components,expenses,priorities,editable,onSaved}:{g:ReturnTypeRepublic;program:StateProgram|null;goals:ProgramGoal[];components:ProgramComponent[];expenses:ProgramExpense[];priorities:ProgramPriority[];editable:boolean;onSaved:(id:string)=>Promise<void>}){
 const formId=useId();
 const [passport,setPassport]=useState<Passport>(blankPassport),[goalRows,setGoalRows]=useState<GoalDraft[]>([]),[componentRows,setComponentRows]=useState<ComponentDraft[]>([]),[expenseRows,setExpenseRows]=useState<ExpenseDraft[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const dirty=useRef(false),alive=useRef(true),busyRef=useRef(false),editVersion=useRef(0);
 const scope=[g.game?.id,g.me?.user_id,g.me?.kind,g.me?.roster_archived_at,g.teacher,program?.id||'new',program?.status,program?.signed_at,editable].join('|'),currentScope=useRef(scope);currentScope.current=scope;
 const active=()=>alive.current&&scope===currentScope.current;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;busyRef.current=false;editVersion.current++}},[]);
 useEffect(()=>{dirty.current=false;editVersion.current++;busyRef.current=false;setBusy(false);setNotice('')},[scope]);
 useEffect(()=>{
  if(dirty.current)return;
  setPassport(program?{title:program.title,responsible_ministry:program.responsible_ministry,responsible_minister_id:program.responsible_minister_id||'',curator_id:program.curator_id||'',national_goal:program.national_goal||'',presidential_priority_id:program.presidential_priority_id||'',participants:program.participants||'',start_date:program.start_date||'',end_date:program.end_date||'',expected_results:program.expected_results||''}:blankPassport);
  setGoalRows(goals.length?goals.map(x=>({...x,key:x.id,unit:x.unit||'',baseline_value:String(x.baseline_value??''),target_value:String(x.target_value??''),target_year:String(x.target_year??'')})):editable?[blankGoal()]:[]);
  const savedComponents=components.map(x=>({...x,key:x.id,start_date:x.start_date||'',end_date:x.end_date||'',goal_key:x.target_goal_id||''}));
   const nextComponents=editable?[...savedComponents,...[1,2,3].filter(n=>!savedComponents.some(x=>x.direction_no===n)).map(n=>blankComponent(n))]:savedComponents;
  setComponentRows(nextComponents);
  setExpenseRows(expenses.map(x=>({...x,key:x.id,component_key:x.component_id,budget_year:String(x.budget_year),amount:String(x.amount)})));
 },[scope,program,goals,components,expenses,editable]);
 function touch(){if(!active()||!editable)return false;dirty.current=true;editVersion.current++;return true}
 function changePassport(key:keyof Passport,value:string){if(!touch())return;setPassport(x=>({...x,[key]:value}))}
 function changeGoal(key:string,field:keyof GoalDraft,value:string){if(!touch())return;setGoalRows(rows=>rows.map(x=>x.key===key?{...x,[field]:value}:x))}
 function removeGoal(key:string){
  if(componentRows.some(c=>c.goal_key===key)){g.setError('Эта цель связана со структурными элементами. Сначала выберите для них другую цель.');return;}
  if(!touch())return;setGoalRows(rows=>rows.filter(r=>r.key!==key));
 }
 function changeComponent(key:string,patch:Partial<ComponentDraft>){
  const original=componentRows.find(c=>c.key===key);
  if(patch.component_kind&&original&&patch.component_kind!==original.component_kind&&patch.component_kind!=='measure'&&componentRows.filter(c=>c.key!==key&&c.direction_no===original.direction_no&&c.component_kind===patch.component_kind).length>=5){g.setError('В одном направлении может быть не более пяти элементов выбранного типа.');return;}
  if(!touch())return;setComponentRows(rows=>rows.map(x=>x.key===key?{...x,...patch}:x));
 }
 function changeDirectionTitle(direction:number,title:string){if(!touch())return;setComponentRows(rows=>rows.map(x=>x.direction_no===direction?{...x,direction_title:title}:x))}
 function addComponent(direction:number,kind:ProgramComponent['component_kind']){
  if(componentRows.length>=25)return;
  if(kind!=='measure'&&componentRows.filter(c=>c.direction_no===direction&&c.component_kind===kind).length>=5)return;
  if(!touch())return;
  const name=componentRows.find(c=>c.direction_no===direction)?.direction_title||'';
  setComponentRows(rows=>[...rows,{...blankComponent(direction),component_kind:kind,direction_title:name}]);
 }
 function removeComponent(key:string){
  if(expenseRows.some(e=>e.component_key===key&&(e.amount.trim()||e.indicator_name.trim()||e.justification.trim()))){g.setError('Сначала удалите расходы этого структурного элемента: их нельзя потерять автоматически.');return;}
  if(!touch())return;setComponentRows(rows=>rows.filter(r=>r.key!==key));setExpenseRows(rows=>rows.filter(r=>r.component_key!==key));
 }
 function addExpense(key:string){
  if(expenseRows.length>=200||!componentRows.some(c=>c.key===key&&c.title.trim()&&c.goal_text.trim()&&c.direction_title.trim()&&goalRows.some(goal=>goal.key===c.goal_key&&goal.goal_text.trim()&&goal.indicator_name.trim()))||!touch())return;
  setExpenseRows(rows=>[...rows,blankExpense(key,passport.start_date.slice(0,4))]);
 }
 function changeExpense(key:string,field:keyof ExpenseDraft,value:string){if(!touch())return;setExpenseRows(rows=>rows.map(x=>x.key===key?{...x,[field]:value}:x))}
 const total=expenseRows.reduce((sum,x)=>sum+(expenseKopecks(x.amount)||0n),0n);
 const yearly=expenseRows.reduce<Record<string,bigint>>((years,x)=>{if(x.budget_year)years[x.budget_year]=(years[x.budget_year]||0n)+(expenseKopecks(x.amount)||0n);return years},{});
 const memberOptions=[{value:'',label:'Выберите участника'},...g.members.filter(x=>x.kind==='student'&&!x.roster_archived_at).map(x=>({value:x.user_id,label:x.full_name}))];
 async function save(confirm:boolean){
  if(!active()||busyRef.current||!g.game||!editable)return;
  const savedVersion=editVersion.current;
  const activeComponents=componentRows.filter(x=>x.title.trim()||x.goal_text.trim()||x.direction_title.trim());
  const activeGoals=goalRows.filter(x=>x.goal_text.trim()||x.indicator_name.trim());
  if(activeComponents.some(c=>c.goal_key&&!activeGoals.some(goal=>goal.key===c.goal_key&&goal.goal_text.trim()&&goal.indicator_name.trim()))){g.setError('Заполните цель и её показатель, выбранные для структурного элемента.');return;}
  if(confirm&&activeComponents.some(c=>!activeGoals.some(goal=>goal.key===c.goal_key&&goal.goal_text.trim()&&goal.indicator_name.trim()))){g.setError('Выберите цель программы для каждого структурного элемента.');return;}
  const activeExpenses=expenseRows.filter(x=>x.indicator_name.trim()||x.justification.trim()||x.amount.trim()||x.budget_year.trim());
  for(const x of activeExpenses){
    const cents=expenseKopecks(x.amount);
    if(cents===null||cents<=0n){g.setError('Укажите положительную сумму каждого расхода в рублях, не более двух знаков после запятой.');return;}
    if(!x.indicator_name.trim()||!x.justification.trim()||!/^\d{4}$/.test(x.budget_year)){g.setError('Заполните индикатор, обоснование и год для каждой строки расходов.');return;}
    if(!activeComponents.some(c=>c.key===x.component_key)){g.setError('Каждый расход должен принадлежать существующему заполненному структурному элементу.');return;}
   }
  busyRef.current=true;setBusy(true);setNotice('');
  try{
   const r=await supabase.rpc('save_state_program_draft',{p_game_id:g.game.id,p_program_id:program?.id||null,p_payload:{...passport,goals:activeGoals.map(({key,...x})=>x),components:activeComponents.map(({key,goal_key,...x})=>({...x,goal_no:goal_key?activeGoals.findIndex(goal=>goal.key===goal_key)+1:null})),expenses:activeExpenses.map(({key,component_key,...x})=>({...x,component_no:activeComponents.findIndex(c=>c.key===component_key)+1,amount:x.amount.trim().replace(',','.')}))},p_confirm:confirm});
   if(!active())return;
   if(r.error){g.setError(r.error);return;}
   if(editVersion.current===savedVersion)dirty.current=false;
   setNotice(confirm?'Программа подтверждена и направлена министру.':dirty.current?'Форма сохранена. Более поздние изменения ещё не сохранены.':'Вся форма и таблица расходов сохранены.');
   await onSaved(String(r.data));
  }catch(error){if(active())g.setError(error)}
  finally{if(active()){busyRef.current=false;setBusy(false)}}
 }
 return <section className={styles.panel} aria-label="Форма государственной программы">
  <div className={styles.sectionHead}><div><h3>{program?'Государственная программа · Полная форма':'Новая государственная программа'}</h3><p>Паспорт, цели, мероприятия и расходы заполняются вместе. Суммы указаны в рублях.</p></div></div>
  {notice&&<p className={styles.notice} role="status">{notice}</p>}
  {program?.form_version!==2&&program&&editable&&<p className={styles.notice}>В прежнем паспорте: {programMoney(program.total_budget)}. Для сохранения полной формы разнесите эту сумму по строкам расходов и обоснуйте каждую строку.</p>}
  <fieldset className={styles.form} disabled={!editable||busy}>
   <legend>Паспорт программы</legend>
   <div className={styles.grid}>
    <label className={styles.field}>Название программы<input value={passport.title} maxLength={500} onChange={e=>changePassport('title',e.target.value)}/></label>
    <label className={styles.field}>Ответственное министерство<input value={passport.responsible_ministry} maxLength={250} onChange={e=>changePassport('responsible_ministry',e.target.value)}/></label>
    <StyledSelect wrap label="Ответственный министр" disabled={!editable||busy} value={passport.responsible_minister_id} options={memberOptions} onChange={v=>changePassport('responsible_minister_id',v)}/>
    <StyledSelect wrap label="Куратор" disabled={!editable||busy} value={passport.curator_id} options={memberOptions} onChange={v=>changePassport('curator_id',v)}/>
    <div className={styles.wide}><StyledSelect wrap label="Национальная цель" disabled={!editable||busy} value={passport.national_goal} options={[{value:'',label:'Выберите национальную цель'},...nationalGoals.map(x=>({value:x,label:x}))]} onChange={v=>changePassport('national_goal',v)}/></div>
    <label className={styles.field}>Начало реализации<input type="date" min="2000-01-01" max="2100-12-31" value={passport.start_date} onChange={e=>changePassport('start_date',e.target.value)}/></label>
    <label className={styles.field}>Завершение реализации<input type="date" min={passport.start_date||'2000-01-01'} max="2100-12-31" value={passport.end_date} onChange={e=>changePassport('end_date',e.target.value)}/></label>
    <label className={`${styles.field} ${styles.wide}`}>Участники программы<textarea rows={2} maxLength={4000} value={passport.participants} onChange={e=>changePassport('participants',e.target.value)} placeholder="Органы, организации и участники реализации"/></label>
    {priorities.length>0&&<div className={styles.wide}><StyledSelect wrap label="Приоритет опубликованного послания Президента" disabled={!editable||busy} value={passport.presidential_priority_id} options={[{value:'',label:'Выберите приоритет'},...priorities.map(x=>({value:x.id,label:x.priority_no+'. '+x.title}))]} onChange={v=>changePassport('presidential_priority_id',v)}/></div>}
    <label className={`${styles.field} ${styles.wide}`}>Ожидаемые результаты<textarea rows={3} maxLength={8000} value={passport.expected_results} onChange={e=>changePassport('expected_results',e.target.value)}/></label>
   </div>
   <section className={styles.section} aria-label="Цели программы и связанные элементы"><div className={styles.sectionHead}><div><h3>Цели программы: какого результата добиться</h3><p>Задайте результат и способ его измерить. Ниже свяжите с этой целью проекты и мероприятия, которые обеспечат результат.</p></div><span>{goalRows.length} / 50</span></div><div className={styles.rows}>{goalRows.map((x,i)=><article className={styles.row} key={x.key} id={formId+'-goal-'+x.key}><h3>Цель {i+1} и её показатель</h3><div className={styles.grid}>
    <label className={styles.field}>Цель программы<textarea rows={2} value={x.goal_text} onChange={e=>changeGoal(x.key,'goal_text',e.target.value)} placeholder="Например: повысить доступность медицинской помощи"/></label>
    <label className={styles.field}>Как измеряем достижение цели<input value={x.indicator_name} onChange={e=>changeGoal(x.key,'indicator_name',e.target.value)} placeholder="Например: доля жителей с доступом к поликлинике"/></label>
    <label className={styles.field}>Единица измерения<input value={x.unit} onChange={e=>changeGoal(x.key,'unit',e.target.value)} placeholder="Например: %"/></label>
    <label className={styles.field}>Исходное значение<input type="number" step="any" value={x.baseline_value} onChange={e=>changeGoal(x.key,'baseline_value',e.target.value)}/></label>
    <label className={styles.field}>Целевое значение<input type="number" step="any" value={x.target_value} onChange={e=>changeGoal(x.key,'target_value',e.target.value)}/></label>
    <label className={styles.field}>Целевой год<input type="number" min={passport.start_date.slice(0,4)||2000} max={passport.end_date.slice(0,4)||2100} value={x.target_year} onChange={e=>changeGoal(x.key,'target_year',e.target.value)}/></label>
   </div><div className={styles.goalElements}><b>Элементы, которые обеспечивают эту цель</b>{componentRows.some(c=>c.goal_key===x.key)?<ul>{componentRows.filter(c=>c.goal_key===x.key).map(c=><li key={c.key}><a href={'#'+formId+'-component-'+c.key} className={styles.goalElementLink} onClick={e=>{e.preventDefault();const detail=document.getElementById(formId+'-component-'+c.key);if(detail instanceof HTMLDetailsElement){detail.open=true;detail.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});detail.querySelector('summary')?.focus({preventScroll:true});}}}>{'Направление '+c.direction_no+' · '+(c.title||'Элемент без названия')}</a></li>)}</ul>:<p>{editable?'Пока нет связанных элементов. В структуре ниже выберите «Какую цель программы обеспечивает элемент».':'Связь со структурными элементами не указана.'}</p>}</div>{editable&&<div className={styles.actions}><IconAction variant="remove" label={'Удалить цель '+(i+1)} onClick={()=>removeGoal(x.key)}/></div>}</article>)}</div>{editable&&<button type="button" disabled={goalRows.length>=50} onClick={()=>{if(!touch())return;setGoalRows(x=>[...x,blankGoal()])}}>Добавить цель с показателем</button>}</section>
   <ProgramStructureTree
     components={componentRows} expenses={expenseRows}
     goals={goalRows} idPrefix={formId}
     editable={editable} busy={busy}
     startDate={passport.start_date} endDate={passport.end_date}
     legacyBudgets={Object.fromEntries(components.map(x=>[x.id,x.budget]))}
     onDirectionTitle={changeDirectionTitle}
     onComponentChange={changeComponent}
     onComponentAdd={addComponent}
     onComponentRemove={removeComponent}
     onExpenseChange={changeExpense}
     onExpenseAdd={addExpense}
     onExpenseRemove={key=>{if(!touch())return;setExpenseRows(rows=>rows.filter(r=>r.key!==key))}}
    />
    <section className={styles.section} aria-label="Сводное финансирование программы">
     <div className={styles.sectionHead}><h3>Итоги финансирования</h3><span>Суммы по всем структурным элементам</span></div>
     <div className={styles.statList}>{Object.entries(yearly).sort().map(([year,amount])=><div key={year}><span>Финансирование · {year}</span><strong>{kopecksMoney(amount)}</strong></div>)}</div>
     <div className={styles.total}><span>Общий бюджет программы</span><strong aria-live="polite">{!editable&&program&&program.form_version!==2&&!expenses.length?programMoney(program.total_budget):kopecksMoney(total)}</strong></div>
    </section>
   </fieldset>
  {editable&&<div className={styles.actions}><button type="button" disabled={busy||passport.title.trim().length<5||passport.responsible_ministry.trim().length<3} onClick={()=>void save(false)}>Сохранить всю форму</button>{(!program||['draft','revision'].includes(program.status))&&<button type="button" className="primary" disabled={busy||passport.title.trim().length<5||passport.responsible_ministry.trim().length<3} onClick={()=>void save(true)}>Подтвердить программу и направить министру</button>}</div>}
 </section>;
}
