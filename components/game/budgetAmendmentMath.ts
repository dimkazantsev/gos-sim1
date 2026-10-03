import baseline from '@/data/federal-budget-2026.json';
import type {BudgetCalculation,BudgetDraft,BudgetTransfer} from './federalBudgetMath';

export type BudgetPlanSummary={id:string;title:string;draft:BudgetDraft;revision:number;status:'draft'|'document'|'published';document_id:string|null};
export type BudgetAmendment={id:string;plan_id:string;plan_title:string;party_name:string;author_name:string;created_by:string;title:string;reason:string;from_section:string;to_section:string;amount:number;base_revision:number;base_calculation:BudgetCalculation;proposal_calculation:BudgetCalculation;status:'submitted'|'withdrawn'|'applied';vote_id:string|null;vote_status:string|null;vote_result:string|null;vote_yes:number|null;vote_no:number|null;vote_abstain:number|null;vote_eligible:number|null;stale:boolean;created_at:string;applied_revision:number|null;document_id:string|null};
export const amendmentSections=baseline.expense_lines.filter(l=>l.key!=='13');
const round=(n:number)=>Math.round(n*100)/100;
export function previewBudgetAmendment(draft:BudgetDraft,base:BudgetCalculation,requests:BudgetTransfer[],from:string,to:string,amount:number):{draft:BudgetDraft;calculation:BudgetCalculation;error:string}{
 const failure=(error:string)=>({draft,calculation:base,error});
 const source=baseline.expense_lines.find(l=>l.key===from),target=baseline.expense_lines.find(l=>l.key===to);
 if(!source||!target||from===to||from==='13'||to==='13')return failure('Выберите два разных раздела. Обслуживание долга не перераспределяется этой формой.');
 if(!Number.isFinite(amount)||amount<=0||amount>1000000)return failure('Укажите сумму больше нуля и не более 1 000 млрд ₽.');
 const sourceLine=base.expense_lines.find(l=>l.key===from),targetLine=base.expense_lines.find(l=>l.key===to);
 if(!sourceLine||!targetLine||!Number.isFinite(base.cost)||base.cost<=0)return failure('Обновите исходный бюджетный расчет.');
 const protectedExpense=requests.filter(r=>draft.transfer_ids.includes(r.id)&&r.status!=='rejected'&&r.kind!=='budget_credit'&&r.section_key===from).reduce((sum,r)=>sum+r.amount,0);
 if(amount>sourceLine.amount-protectedExpense)return failure('Нельзя сокращать включенные в проект целевые трансферты. Выберите другой источник или меньшую сумму.');
 const fromChange=(draft.spending_changes[from]??0)-amount/(source.amount*base.cost)*100,toChange=(draft.spending_changes[to]??0)+amount/(target.amount*base.cost)*100;
 if(fromChange< -80||toChange>200)return failure('Перераспределение выходит за пределы модели: от −80 % до +200 % к исходным расходам раздела. Уменьшите сумму.');
 const nextDraft={...draft,spending_changes:{...draft.spending_changes,[from]:fromChange,[to]:toChange}};
 const expense_lines=base.expense_lines.map(l=>l.key===from?{...l,amount:round(l.amount-amount)}:l.key===to?{...l,amount:round(l.amount+amount)}:l);
 // A reallocation preserves revenue, total spending, debt and financing.
 return {draft:nextDraft,calculation:{...base,expense_lines},error:''};
}
export function amendmentStatus(a:BudgetAmendment):string{
 if(a.status==='applied')return 'Включена в расчет';
 if(a.status==='withdrawn')return 'Отозвана';
 if(a.stale)return 'Нужен новый расчет';
 if(a.vote_status==='open')return 'Идет голосование';
 if(a.vote_result==='passed')return 'Одобрена · ожидает включения';
 if(a.vote_result==='rejected')return 'Отклонена';
 if(a.vote_result==='no_quorum')return 'Нет кворума';
 return 'Направлена на рассмотрение';
}
