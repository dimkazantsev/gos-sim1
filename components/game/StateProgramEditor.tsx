'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import StyledSelect from '../ui/StyledSelect';
import {IconAction} from '../ui/IconAction';
import type {ReturnTypeRepublic} from './viewTypes';
import {expenseKopecks,kopecksMoney,nationalGoals,programMoney,type StateProgram,type ProgramGoal,type ProgramComponent,type ProgramExpense,type ProgramPriority} from './stateProgramModel';
import styles from './StageForms.module.css';

type GoalDraft={key:string;goal_text:string;indicator_name:string;unit:string;baseline_value:string;target_value:string;target_year:string};
type ComponentDraft={key:string;direction_no:number;direction_title:string;component_kind:ProgramComponent['component_kind'];title:string;goal_text:string;start_date:string;end_date:string};
type ExpenseDraft={key:string;component_key:string;indicator_name:string;justification:string;budget_year:string;amount:string};
type Passport={title:string;responsible_ministry:string;responsible_minister_id:string;curator_id:string;national_goal:string;presidential_priority_id:string;participants:string;start_date:string;end_date:string;expected_results:string};
const blankGoal=():GoalDraft=>({key:crypto.randomUUID(),goal_text:'',indicator_name:'',unit:'',baseline_value:'',target_value:'',target_year:''});
const blankComponent=(direction=1):ComponentDraft=>({key:crypto.randomUUID(),direction_no:direction,direction_title:'',component_kind:'project',title:'',goal_text:'',start_date:'',end_date:''});
const blankExpense=(component_key='',budget_year=''):ExpenseDraft=>({key:crypto.randomUUID(),component_key,indicator_name:'',justification:'',budget_year,amount:''});
const blankPassport:Passport={title:'',responsible_ministry:'',responsible_minister_id:'',curator_id:'',national_goal:'',presidential_priority_id:'',participants:'',start_date:'',end_date:'',expected_results:''};

export default function StateProgramEditor({g,program,goals,components,expenses,priorities,editable,onSaved}:{g:ReturnTypeRepublic;program:StateProgram|null;goals:ProgramGoal[];components:ProgramComponent[];expenses:ProgramExpense[];priorities:ProgramPriority[];editable:boolean;onSaved:(id:string)=>Promise<void>}){
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
  const nextComponents=components.length?components.map(x=>({...x,key:x.id,start_date:x.start_date||'',end_date:x.end_date||''})):editable?[blankComponent(1),blankComponent(2),blankComponent(3)]:[];
  setComponentRows(nextComponents);
  setExpenseRows(expenses.length?expenses.map(x=>({...x,key:x.id,component_key:x.component_id,budget_year:String(x.budget_year),amount:String(x.amount)})):editable?[blankExpense(nextComponents[0]?.key,program?.start_date?.slice(0,4))]:[]);
 },[scope,program,goals,components,expenses,editable]);
 function touch(){if(!active()||!editable)return false;dirty.current=true;editVersion.current++;return true}
 function changePassport(key:keyof Passport,value:string){if(!touch())return;setPassport(x=>({...x,[key]:value}))}
 function changeGoal(key:string,field:keyof GoalDraft,value:string){if(!touch())return;setGoalRows(rows=>rows.map(x=>x.key===key?{...x,[field]:value}:x))}
 function changeComponent(key:string,patch:Partial<ComponentDraft>){if(!touch())return;setComponentRows(rows=>rows.map(x=>x.key===key?{...x,...patch}:x))}
 function changeExpense(key:string,field:keyof ExpenseDraft,value:string){if(!touch())return;setExpenseRows(rows=>rows.map(x=>x.key===key?{...x,[field]:value}:x))}
 const total=expenseRows.reduce((sum,x)=>sum+(expenseKopecks(x.amount)||0n),0n);
 const yearly=expenseRows.reduce<Record<string,bigint>>((years,x)=>{if(x.budget_year)years[x.budget_year]=(years[x.budget_year]||0n)+(expenseKopecks(x.amount)||0n);return years},{});
 const memberOptions=[{value:'',label:'Выберите участника'},...g.members.filter(x=>x.kind==='student'&&!x.roster_archived_at).map(x=>({value:x.user_id,label:x.full_name}))];
 async function save(confirm:boolean){
  if(!active()||busyRef.current||!g.game||!editable)return;
  const savedVersion=editVersion.current;
  const activeComponents=componentRows.filter(x=>x.title.trim()||x.goal_text.trim()||x.direction_title.trim());
  const activeGoals=goalRows.filter(x=>x.goal_text.trim()||x.indicator_name.trim());
  const activeExpenses=expenseRows.filter(x=>x.indicator_name.trim()||x.justification.trim()||x.amount.trim());
  for(const x of activeExpenses){if(expenseKopecks(x.amount)===null){g.setError('Укажите сумму каждого расхода в рублях, не более двух знаков после запятой.');return;}if(!activeComponents.some(c=>c.key===x.component_key)){g.setError('Свяжите каждый расход с заполненным мероприятием.');return;}}
  busyRef.current=true;setBusy(true);setNotice('');
  try{
   const r=await supabase.rpc('save_state_program_draft',{p_game_id:g.game.id,p_program_id:program?.id||null,p_payload:{...passport,goals:activeGoals.map(({key,...x})=>x),components:activeComponents.map(({key,...x})=>x),expenses:activeExpenses.map(({key,component_key,...x})=>({...x,component_no:activeComponents.findIndex(c=>c.key===component_key)+1,amount:x.amount.trim().replace(',','.')}))},p_confirm:confirm});
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
   <section className={styles.section}><div className={styles.sectionHead}><h3>Цели и измеримые показатели</h3><span>{goalRows.length} / 50</span></div><div className={styles.rows}>{goalRows.map((x,i)=><article className={styles.row} key={x.key}><h3>Показатель {i+1}</h3><div className={styles.grid}>
    <label className={styles.field}>Цель программы<textarea rows={2} value={x.goal_text} onChange={e=>changeGoal(x.key,'goal_text',e.target.value)}/></label>
    <label className={styles.field}>Измеримый показатель<input value={x.indicator_name} onChange={e=>changeGoal(x.key,'indicator_name',e.target.value)}/></label>
    <label className={styles.field}>Единица измерения<input value={x.unit} onChange={e=>changeGoal(x.key,'unit',e.target.value)}/></label>
    <label className={styles.field}>Исходное значение<input type="number" step="any" value={x.baseline_value} onChange={e=>changeGoal(x.key,'baseline_value',e.target.value)}/></label>
    <label className={styles.field}>Целевое значение<input type="number" step="any" value={x.target_value} onChange={e=>changeGoal(x.key,'target_value',e.target.value)}/></label>
    <label className={styles.field}>Целевой год<input type="number" min={passport.start_date.slice(0,4)||2000} max={passport.end_date.slice(0,4)||2100} value={x.target_year} onChange={e=>changeGoal(x.key,'target_year',e.target.value)}/></label>
   </div>{editable&&<div className={styles.actions}><IconAction variant="remove" label={'Удалить показатель '+(i+1)} onClick={()=>{if(!touch())return;setGoalRows(rows=>rows.filter(r=>r.key!==x.key))}}/></div>}</article>)}</div>{editable&&<button type="button" disabled={goalRows.length>=50} onClick={()=>{if(!touch())return;setGoalRows(x=>[...x,blankGoal()])}}>Добавить показатель</button>}</section>
   <section className={styles.section}><div className={styles.sectionHead}><h3>Направления и мероприятия</h3><span>{componentRows.length} / 25</span></div><p>Три направления; в каждом не более пяти проектов и пяти целевых программ.</p><div className={styles.rows}>{componentRows.map((x,i)=><article className={styles.row} key={x.key}><h3>Структурный элемент {i+1}</h3><div className={styles.grid}>
    <StyledSelect wrap disabled={!editable||busy} label="Направление" value={String(x.direction_no)} options={[1,2,3].map(n=>({value:String(n),label:'Направление '+n}))} onChange={v=>changeComponent(x.key,{direction_no:Number(v)})}/>
    <label className={styles.field}>Название направления<input value={x.direction_title} onChange={e=>changeComponent(x.key,{direction_title:e.target.value})}/></label>
    <StyledSelect wrap disabled={!editable||busy} label="Тип элемента" value={x.component_kind} options={[{value:'project',label:'Проект'},{value:'target_program',label:'Целевая программа'},{value:'measure',label:'Мероприятие'}]} onChange={v=>changeComponent(x.key,{component_kind:v as ProgramComponent['component_kind']})}/>
    <label className={styles.field}>Название элемента<input value={x.title} onChange={e=>changeComponent(x.key,{title:e.target.value})}/></label>
    <label className={`${styles.field} ${styles.wide}`}>Цель элемента<textarea rows={2} value={x.goal_text} onChange={e=>changeComponent(x.key,{goal_text:e.target.value})}/></label>
    <label className={styles.field}>Начало элемента<input type="date" min={passport.start_date||'2000-01-01'} max={passport.end_date||'2100-12-31'} value={x.start_date} onChange={e=>changeComponent(x.key,{start_date:e.target.value})}/></label>
    <label className={styles.field}>Завершение элемента<input type="date" min={x.start_date||passport.start_date||'2000-01-01'} max={passport.end_date||'2100-12-31'} value={x.end_date} onChange={e=>changeComponent(x.key,{end_date:e.target.value})}/></label>
   </div><p>Бюджет элемента: <strong className={styles.number}>{!editable&&program?.form_version!==2&&!expenses.length?programMoney(components.find(c=>c.id===x.key)?.budget||0):kopecksMoney(expenseRows.filter(e=>e.component_key===x.key).reduce((sum,e)=>sum+(expenseKopecks(e.amount)||0n),0n))}</strong></p>{editable&&<div className={styles.actions}><IconAction variant="remove" label={'Удалить элемент '+(i+1)} onClick={()=>{if(!touch())return;setComponentRows(rows=>rows.filter(r=>r.key!==x.key));setExpenseRows(rows=>rows.map(r=>r.component_key===x.key?{...r,component_key:''}:r))}}/></div>}</article>)}</div>{editable&&<button type="button" disabled={componentRows.length>=25} onClick={()=>{if(!touch())return;setComponentRows(x=>[...x,blankComponent()])}}>Добавить структурный элемент</button>}</section>
   <section className={styles.section}><div className={styles.sectionHead}><h3>Расходы и их обоснование</h3><span>Рубли · {expenseRows.length} / 200 строк</span></div><div className={styles.tableWrap}><table className={styles.table}><caption>Каждая сумма связана с индикатором, мероприятием и годом реализации</caption><thead><tr><th>Индикатор расхода</th><th>Обоснование</th><th>Мероприятие</th><th>Год</th><th>Сумма, ₽</th>{editable&&<th>Действие</th>}</tr></thead><tbody>{expenseRows.map((x,i)=><tr key={x.key}>
    <td><input aria-label={`Индикатор расхода ${i+1}`} maxLength={500} value={x.indicator_name} onChange={e=>changeExpense(x.key,'indicator_name',e.target.value)}/></td>
    <td><textarea aria-label={`Обоснование расхода ${i+1}`} maxLength={4000} rows={3} value={x.justification} onChange={e=>changeExpense(x.key,'justification',e.target.value)}/></td>
    <td><StyledSelect wrap disabled={!editable||busy} label={`Мероприятие расхода ${i+1}`} value={x.component_key} options={[{value:'',label:'Выберите мероприятие'},...componentRows.map((c,n)=>({value:c.key,label:`${n+1}. ${c.title||'Элемент без названия'}`}))]} onChange={v=>changeExpense(x.key,'component_key',v)}/></td>
    <td><input aria-label={`Год расхода ${i+1}`} type="number" min={passport.start_date.slice(0,4)||2000} max={passport.end_date.slice(0,4)||2100} value={x.budget_year} onChange={e=>changeExpense(x.key,'budget_year',e.target.value)}/></td>
    <td><input aria-label={`Сумма расхода ${i+1}, рубли`} inputMode="decimal" value={x.amount} onChange={e=>changeExpense(x.key,'amount',e.target.value)} placeholder="0,00"/></td>
    {editable&&<td><IconAction variant="remove" label={`Удалить расход ${i+1}`} onClick={()=>{if(!touch())return;setExpenseRows(rows=>rows.filter(r=>r.key!==x.key))}}/></td>}
   </tr>)}</tbody></table></div>{editable&&<div className={styles.actions}><button type="button" disabled={expenseRows.length>=200} onClick={()=>{if(!touch())return;setExpenseRows(x=>[...x,blankExpense(componentRows[0]?.key,passport.start_date.slice(0,4))])}}>Добавить строку расходов</button></div>}
   <div className={styles.statList}>{Object.entries(yearly).sort().map(([year,amount])=><div key={year}><span>Финансирование · {year}</span><strong>{kopecksMoney(amount)}</strong></div>)}</div><div className={styles.total}><span>Общий бюджет программы</span><strong aria-live="polite">{!editable&&program&&program.form_version!==2&&!expenses.length?programMoney(program.total_budget):kopecksMoney(total)}</strong></div>
   </section>
  </fieldset>
  {editable&&<div className={styles.actions}><button type="button" disabled={busy||passport.title.trim().length<5||passport.responsible_ministry.trim().length<3} onClick={()=>void save(false)}>Сохранить всю форму</button>{(!program||['draft','revision'].includes(program.status))&&<button type="button" className="primary" disabled={busy||passport.title.trim().length<5||passport.responsible_ministry.trim().length<3} onClick={()=>void save(true)}>Подтвердить программу и направить министру</button>}</div>}
 </section>;
}
