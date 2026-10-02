'use client';
import {Calculator,FileText} from 'lucide-react';
import type {FormalDocument} from './types';
import type {BudgetCalculation} from './federalBudgetMath';
import {billions} from './federalBudgetMath';
import styles from './BudgetDocumentAnnex.module.css';
export default function BudgetDocumentAnnex({document,onOpenBudget}:{document:FormalDocument;onOpenBudget?:()=>void}){
 const c=document.metadata?.budget_snapshot as BudgetCalculation|undefined;
 if(!document.metadata?.budget_simulator_plan_id||!c||!Array.isArray(c.income_lines)||!Array.isArray(c.expense_lines))return null;
 return <section className={styles.annex} aria-label="Расчетные приложения к бюджету"><header><div><FileText size={19}/><b>Числовые приложения к проекту</b></div>{onOpenBudget&&<button type="button" className="secondary" onClick={onOpenBudget}><Calculator size={18}/> Бюджетный калькулятор</button>}</header><p>Эти суммы сформированы из общего расчета и связаны с принятием бюджета. Пояснения можно редактировать здесь; изменение сумм оформляйте новой редакцией через калькулятор.</p><dl>{[['Доходы',c.revenue],['Расходы',c.expenditure],['Дефицит',c.deficit],['Источники финансирования',c.financing]].map(([label,n])=><div key={String(label)}><dt>{String(label)}</dt><dd>{billions(Number(n))}</dd></div>)}</dl><details><summary>Доходы и расходы по разделам</summary>{[['Доходы',c.income_lines],['Расходы',c.expense_lines]].map(([title,rows])=><div key={String(title)}><h4>{String(title)}</h4><ul>{(rows as BudgetCalculation['income_lines']).map(l=><li key={l.key}><span>{l.label}</span><b>{billions(l.amount)}</b></li>)}</ul></div>)}<p>Разница округления доходов: +0,2 млрд ₽; расходов: −0,1 млрд ₽. Долговые проценты входят в расходы, основной долг — в финансирование.</p></details></section>;
}
