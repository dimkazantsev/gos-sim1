'use client';
import {IconAction} from '../ui/IconAction';
import StyledSelect from '../ui/StyledSelect';
import {expenseKopecks,kopecksMoney,programMoney,type ProgramComponent} from './stateProgramModel';
import styles from './StageForms.module.css';

type ComponentDraft={key:string;direction_no:number;direction_title:string;component_kind:ProgramComponent['component_kind'];title:string;goal_text:string;start_date:string;end_date:string;goal_key:string};
type GoalDraft={key:string;goal_text:string;indicator_name:string;unit:string;baseline_value:string;target_value:string;target_year:string};
type ExpenseDraft={key:string;component_key:string;indicator_name:string;justification:string;budget_year:string;amount:string};
type ComponentPatch=Partial<ComponentDraft>;
type ExpenseField=keyof ExpenseDraft;
type Props={
 components:ComponentDraft[];expenses:ExpenseDraft[];goals:GoalDraft[];idPrefix:string;
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
 const disabled=!p.editable||p.busy;
 const goalOptions=[{value:'',label:'Выберите цель из блока выше'},...p.goals.filter(g=>g.goal_text.trim()&&g.indicator_name.trim()).map(g=>({value:g.key,label:'Цель '+(p.goals.findIndex(x=>x.key===g.key)+1)+': '+g.goal_text+' · '+g.indicator_name}))];
 return <section className={styles.section} aria-label="Дерево направлений и расходов">
  <div className={styles.sectionHead}><div><h3>Реализация целей: структура государственной программы</h3><p>Каждый элемент связан с целью из блока выше. Укажите, что он сделает для её достижения, и добавьте расходы внутри элемента. Направления объединяют элементы по теме.</p></div><span>{p.components.length} / 25 элементов</span></div>
  <ol className={styles.goalFlow} aria-label="Связь цели с расходами"><li>Цель программы</li><li>Измеримый результат</li><li>Проект или мероприятие</li><li>Обоснованные расходы</li></ol>
  <div className={styles.treeDirections}>
   {[1,2,3].map(n=>{
    const nodes=p.components.filter(c=>c.direction_no===n);
    const previous=p.components.filter(c=>c.direction_no===n-1);
    const hasData=nodes.some(c=>c.direction_title.trim()||c.title.trim()||c.goal_text.trim());
    const unlocked=n===1||!p.editable||hasData||previous.some(c=>c.direction_title.trim()&&c.title.trim()&&c.goal_text.trim()&&p.goals.some(g=>g.key===c.goal_key&&g.goal_text.trim()&&g.indicator_name.trim()));
    const directionTitle=nodes.find(c=>c.direction_title.trim())?.direction_title||nodes[0]?.direction_title||'';
    const complete=nodes.some(c=>c.direction_title.trim()&&c.title.trim()&&c.goal_text.trim()&&p.goals.some(g=>g.key===c.goal_key&&g.goal_text.trim()&&g.indicator_name.trim()));
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
        const goal=p.goals.find(g=>g.key===c.goal_key),goalNo=p.goals.findIndex(g=>g.key===c.goal_key)+1;
        const linked=!!(goal?.goal_text.trim()&&goal?.indicator_name.trim());
        const filled=!!(directionTitle.trim()&&c.title.trim()&&c.goal_text.trim()&&linked);
        const sum=costs.length||!p.legacyBudgets?.[c.key]?kopecksMoney(amountFor(costs)):programMoney(p.legacyBudgets[c.key]);
        return <article className={styles.treeComponent} key={c.key}>
         <details id={p.idPrefix+'-component-'+c.key} ref={el=>{if(el&&!el.dataset.initialized){el.open=i===nodes.length-1||nodes.length===1;el.dataset.initialized='true';}}}>
          <summary className={styles.treeComponentSummary}>
           <span className={styles.treeNodeIndex}>{n}.{i+1}</span>
           <span className={styles.treeNodeText}><b>{c.title.trim()||'Новый структурный элемент'}</b><small>{kinds.find(k=>k.value===c.component_kind)?.label} · {linked?'Цель '+goalNo:'Цель ещё не выбрана'} · Расходы: {sum}</small></span>
           <span className={styles.treeDisclosure} aria-hidden="true">⌄</span>
          </summary>
          <div className={styles.treeComponentBody}>
           <div className={styles.grid}>
            <div className={styles.wide}><StyledSelect wrap disabled={disabled} label="Какую цель программы обеспечивает элемент" value={c.goal_key} options={goalOptions} onChange={v=>p.onComponentChange(c.key,{goal_key:v})}/></div>
            {linked&&goal&&<div className={`${styles.goalConnection} ${styles.wide}`}><a href={'#'+p.idPrefix+'-goal-'+goal.key}>{'Цель '+goalNo+': '+goal.goal_text}</a><p><b>{goal.indicator_name}</b>{': '+(goal.baseline_value||'Не задано')+' → '+(goal.target_value||'Не задано')+(goal.unit?' '+goal.unit:'')+(goal.target_year?' к '+goal.target_year+' году':'')}</p></div>}
            <div className={styles.wide}><StyledSelect wrap disabled={disabled} label="Тип элемента" value={c.component_kind} options={kinds.map(k=>({value:k.value,label:k.label}))} onChange={v=>p.onComponentChange(c.key,{component_kind:v as ProgramComponent['component_kind']})}/></div>
            <label className={styles.field}>Название элемента<input value={c.title} disabled={disabled} onChange={e=>p.onComponentChange(c.key,{title:e.target.value})} placeholder="Конкретный проект, программа или мероприятие"/></label>
            <label className={styles.field}>Что сделает этот элемент для достижения цели<input value={c.goal_text} disabled={disabled} onChange={e=>p.onComponentChange(c.key,{goal_text:e.target.value})} placeholder="Например: построить две поликлиники в удалённых районах"/></label>
            <label className={styles.field}>Начало реализации<input type="date" disabled={disabled} min={p.startDate||'2000-01-01'} max={p.endDate||'2100-12-31'} value={c.start_date} onChange={e=>p.onComponentChange(c.key,{start_date:e.target.value})}/></label>
            <label className={styles.field}>Завершение реализации<input type="date" disabled={disabled} min={c.start_date||p.startDate||'2000-01-01'} max={p.endDate||'2100-12-31'} value={c.end_date} onChange={e=>p.onComponentChange(c.key,{end_date:e.target.value})}/></label>
           </div>
           <section className={styles.treeExpenses} aria-label={'Расходы элемента '+(c.title||n+'.'+(i+1))}>
            <div className={styles.treeExpenseHead}><div><h5>Расходы элемента {n}.{i+1}</h5><p>{linked?'Финансирование элемента для достижения цели '+goalNo+'. ':'Выберите цель программы для этого элемента. '}Укажите, что оплачивается и почему требуется эта сумма.</p></div><strong>{sum}</strong></div>
            {costs.length>0&&<div className={styles.tableWrap}><table className={styles.table+' '+styles.treeExpenseTable}>
             <thead><tr><th>Что финансируется</th><th>Обоснование</th><th>Год</th><th>Сумма, ₽</th>{p.editable&&<th>Удалить</th>}</tr></thead>
             <tbody>{costs.map((e,j)=><tr key={e.key}>
              <td data-label="Что финансируется"><input aria-label={'Индикатор расхода '+(j+1)+' элемента '+n+'.'+(i+1)} maxLength={500} disabled={disabled} value={e.indicator_name} onChange={ev=>p.onExpenseChange(e.key,'indicator_name',ev.target.value)} placeholder="Например: строительство двух поликлиник"/></td>
              <td data-label="Обоснование"><textarea aria-label={'Обоснование расхода '+(j+1)} rows={2} maxLength={4000} disabled={disabled} value={e.justification} onChange={ev=>p.onExpenseChange(e.key,'justification',ev.target.value)} placeholder="Почему требуется эта сумма?"/></td>
              <td data-label="Год"><input type="number" aria-label={'Год расхода '+(j+1)} min={p.startDate.slice(0,4)||2000} max={p.endDate.slice(0,4)||2100} disabled={disabled} value={e.budget_year} onChange={ev=>p.onExpenseChange(e.key,'budget_year',ev.target.value)} placeholder="Год"/></td>
              <td data-label="Сумма, ₽"><input inputMode="decimal" aria-label={'Сумма расхода '+(j+1)+', рубли'} disabled={disabled} value={e.amount} onChange={ev=>p.onExpenseChange(e.key,'amount',ev.target.value)} placeholder="0,00"/></td>
              {p.editable&&<td className={styles.treeExpenseRemove}><IconAction variant="remove" disabled={p.busy} label={'Удалить расход '+(j+1)+' элемента '+n+'.'+(i+1)} onClick={()=>p.onExpenseRemove(e.key)}/></td>}
             </tr>)}</tbody>
            </table></div>}
            {p.editable&&<button type="button" className={styles.treeAddExpense} disabled={disabled||!filled||p.expenses.length>=200} onClick={()=>p.onExpenseAdd(c.key)}>＋ Добавить расход к элементу {n}.{i+1}</button>}
            {p.editable&&!filled&&<p className={styles.treeHint}>Чтобы добавить расходы, выберите цель программы, заполните название направления и элемента, укажите вклад элемента в достижение цели.</p>}
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
