'use client';
import {useId} from 'react';
import {IconAction} from '../ui/IconAction';
import StyledSelect from '../ui/StyledSelect';
import {expenseKopecks,kopecksMoney,programMoney,type ProgramComponent} from './stateProgramModel';
import styles from './StageForms.module.css';

type ComponentDraft={key:string;direction_no:number;direction_title:string;component_kind:ProgramComponent['component_kind'];title:string;goal_text:string;start_date:string;end_date:string};
type ExpenseDraft={key:string;component_key:string;indicator_name:string;justification:string;budget_year:string;amount:string};
type ComponentPatch=Partial<ComponentDraft>;
type ExpenseField=keyof ExpenseDraft;
type Props={
 components:ComponentDraft[];expenses:ExpenseDraft[];indicators:string[];
 editable:boolean;busy:boolean;startDate:string;endDate:string;legacyBudgets?:Record<string,number|string>;
 onDirectionTitle:(direction:number,title:string)=>void;
 onComponentChange:(key:string,patch:ComponentPatch)=>void;
 onComponentAdd:(direction:number,kind:ProgramComponent['component_kind'])=>void;
 onComponentRemove:(key:string)=>void;
 onExpenseChange:(key:string,field:ExpenseField,value:string)=>void;
 onExpenseAdd:(componentKey:string)=>void;
 onExpenseRemove:(key:string)=>void;
};
const kinds:{value:ProgramComponent['component_kind'];label:string}[]=[
 {value:'project',label:'Проект'},
 {value:'target_program',label:'Целевая программа'},
 {value:'measure',label:'Мероприятие'}
];
function amountFor(rows:ExpenseDraft[]):bigint{return rows.reduce((s,r)=>s+(expenseKopecks(r.amount)||0n),0n)}
export default function ProgramStructureTree(p:Props){
 const listId=useId();
 const disabled=!p.editable||p.busy;
 return <section className={styles.section} aria-label="Дерево направлений и расходов">
  <div className={styles.sectionHead}><div><h3>Структура государственной программы</h3><p>Последовательно заполните три направления. В каждом создайте проекты, целевые программы или мероприятия, затем укажите расходы непосредственно внутри соответствующего элемента.</p></div><span>{p.components.length} / 25 элементов</span></div>
  <datalist id={listId}>{p.indicators.filter(Boolean).map((v,i)=><option value={v} key={i}/>)}</datalist>
  <div className={styles.treeDirections}>
   {[1,2,3].map(n=>{
    const nodes=p.components.filter(c=>c.direction_no===n);
    const previous=p.components.filter(c=>c.direction_no===n-1);
    const hasData=nodes.some(c=>c.direction_title.trim()||c.title.trim()||c.goal_text.trim());
    const unlocked=n===1||!p.editable||hasData||previous.some(c=>c.direction_title.trim()&&c.title.trim()&&c.goal_text.trim());
    const directionTitle=nodes.find(c=>c.direction_title.trim())?.direction_title||nodes[0]?.direction_title||'';
    const complete=nodes.some(c=>c.direction_title.trim()&&c.title.trim()&&c.goal_text.trim());
    const projectCount=nodes.filter(c=>c.component_kind==='project').length;
    const targetCount=nodes.filter(c=>c.component_kind==='target_program').length;
    return <section key={n} className={styles.treeDirection} data-locked={!unlocked}>
     <header className={styles.treeDirectionHeader}>
      <span className={styles.treeIndex}>{n}</span>
      <div><h4>Направление {n}{directionTitle?' · '+directionTitle:''}</h4><p>{complete?'Можно добавлять элементы и расходы':unlocked?'Сначала назовите направление и заполните его первый элемент':'Сначала заполните предыдущее направление'}</p></div>
      <span className={styles.treeCount}>{nodes.length} эл.</span>
     </header>
     {unlocked&&<div className={styles.treeDirectionBody}>
      <label className={styles.field}>Название направления
       <input value={directionTitle} disabled={disabled} maxLength={500} onChange={e=>p.onDirectionTitle(n,e.target.value)} placeholder={'Например, направление '+n+': развитие инфраструктуры'}/>
      </label>
      <div className={styles.treeBranches}>
       {nodes.map((c,i)=>{
        const costs=p.expenses.filter(e=>e.component_key===c.key);
        const filled=!!(directionTitle.trim()&&c.title.trim()&&c.goal_text.trim());
        const sum=costs.length||!p.legacyBudgets?.[c.key]?kopecksMoney(amountFor(costs)):programMoney(p.legacyBudgets[c.key]);
        return <article className={styles.treeComponent} key={c.key}>
         <details ref={el=>{if(el&&!el.dataset.initialized){el.open=i===nodes.length-1||nodes.length===1;el.dataset.initialized='true';}}}>
          <summary className={styles.treeComponentSummary}>
           <span className={styles.treeNodeIndex}>{n}.{i+1}</span>
           <span className={styles.treeNodeText}><b>{c.title.trim()||'Новый структурный элемент'}</b><small>{kinds.find(k=>k.value===c.component_kind)?.label} · Расходы: {sum}</small></span>
           <span className={styles.treeDisclosure} aria-hidden="true">⌄</span>
          </summary>
          <div className={styles.treeComponentBody}>
           <div className={styles.grid}>
            <div className={styles.wide}><StyledSelect wrap disabled={disabled} label="Тип элемента" value={c.component_kind} options={kinds.map(k=>({value:k.value,label:k.label}))} onChange={v=>p.onComponentChange(c.key,{component_kind:v as ProgramComponent['component_kind']})}/></div>
            <label className={styles.field}>Название элемента<input value={c.title} disabled={disabled} onChange={e=>p.onComponentChange(c.key,{title:e.target.value})} placeholder="Конкретный проект, программа или мероприятие"/></label>
            <label className={styles.field}>Цель элемента<input value={c.goal_text} disabled={disabled} onChange={e=>p.onComponentChange(c.key,{goal_text:e.target.value})} placeholder="Какого результата нужно достичь?"/></label>
            <label className={styles.field}>Начало реализации<input type="date" disabled={disabled} min={p.startDate||'2000-01-01'} max={p.endDate||'2100-12-31'} value={c.start_date} onChange={e=>p.onComponentChange(c.key,{start_date:e.target.value})}/></label>
            <label className={styles.field}>Завершение реализации<input type="date" disabled={disabled} min={c.start_date||p.startDate||'2000-01-01'} max={p.endDate||'2100-12-31'} value={c.end_date} onChange={e=>p.onComponentChange(c.key,{end_date:e.target.value})}/></label>
           </div>
           <section className={styles.treeExpenses} aria-label={'Расходы элемента '+(c.title||n+'.'+(i+1))}>
            <div className={styles.treeExpenseHead}><div><h5>Расходы элемента {n}.{i+1}</h5><p>Индикатор, экономическое обоснование, год и сумма относятся именно к этому элементу.</p></div><strong>{sum}</strong></div>
            {costs.length>0&&<div className={styles.tableWrap}><table className={styles.table+' '+styles.treeExpenseTable}>
             <thead><tr><th>Индикатор расхода</th><th>Обоснование</th><th>Год</th><th>Сумма, ₽</th>{p.editable&&<th>Удалить</th>}</tr></thead>
             <tbody>{costs.map((e,j)=><tr key={e.key}>
              <td data-label="Индикатор"><input list={listId} aria-label={'Индикатор расхода '+(j+1)+' элемента '+n+'.'+(i+1)} maxLength={500} disabled={disabled} value={e.indicator_name} onChange={ev=>p.onExpenseChange(e.key,'indicator_name',ev.target.value)} placeholder="Что финансируется?"/></td>
              <td data-label="Обоснование"><textarea aria-label={'Обоснование расхода '+(j+1)} rows={2} maxLength={4000} disabled={disabled} value={e.justification} onChange={ev=>p.onExpenseChange(e.key,'justification',ev.target.value)} placeholder="Почему требуется эта сумма?"/></td>
              <td data-label="Год"><input type="number" aria-label={'Год расхода '+(j+1)} min={p.startDate.slice(0,4)||2000} max={p.endDate.slice(0,4)||2100} disabled={disabled} value={e.budget_year} onChange={ev=>p.onExpenseChange(e.key,'budget_year',ev.target.value)} placeholder="Год"/></td>
              <td data-label="Сумма, ₽"><input inputMode="decimal" aria-label={'Сумма расхода '+(j+1)+', рубли'} disabled={disabled} value={e.amount} onChange={ev=>p.onExpenseChange(e.key,'amount',ev.target.value)} placeholder="0,00"/></td>
              {p.editable&&<td className={styles.treeExpenseRemove}><IconAction variant="remove" disabled={p.busy} label={'Удалить расход '+(j+1)+' элемента '+n+'.'+(i+1)} onClick={()=>p.onExpenseRemove(e.key)}/></td>}
             </tr>)}</tbody>
            </table></div>}
            {p.editable&&<button type="button" className={styles.treeAddExpense} disabled={disabled||!filled||p.expenses.length>=200} onClick={()=>p.onExpenseAdd(c.key)}>＋ Добавить расход к элементу {n}.{i+1}</button>}
            {p.editable&&!filled&&<p className={styles.treeHint}>Чтобы добавить расходы, заполните название направления, название и цель элемента.</p>}
           </section>
           {p.editable&&<div className={styles.treeActions}><button type="button" className={styles.treeDelete} disabled={disabled} onClick={()=>p.onComponentRemove(c.key)}>Удалить структурный элемент</button></div>}
          </div>
         </details>
        </article>
       })}
      </div>
      {p.editable&&<div className={styles.treeAddActions}>
       {kinds.map(k=><button key={k.value} type="button" disabled={disabled||!complete||p.components.length>=25||(k.value==='project'&&projectCount>=5)||(k.value==='target_program'&&targetCount>=5)} onClick={()=>p.onComponentAdd(n,k.value)}>＋ {k.value==='project'?'Добавить проект':k.value==='target_program'?'Добавить целевую программу':'Добавить мероприятие'}</button>)}
      </div>}
     </div>}
    </section>;
   })}
  </div>
 </section>;
}
