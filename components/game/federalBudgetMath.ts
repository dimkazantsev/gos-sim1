import baseline from '@/data/federal-budget-2026.json';
import type {FiscalContext,FiscalRate,FiscalRegion} from './fiscalMath';

export const FINANCING_SOURCES = [
 {key:'ofz_fixed',label:'ОФЗ с постоянным купоном',lender:'Банки, фонды и граждане через рынок ценных бумаг',debt:'internal',spread:0,risk:'Стоимость фиксируется при размещении. Остаются риск слабого спроса и необходимость погашения.'},
 {key:'ofz_float',label:'ОФЗ с переменным купоном',lender:'Участники рынка государственных облигаций',debt:'internal',spread:0.5,risk:'Платежи растут при увеличении ставки. Риск проверяется в следующем финансовом периоде.'},
 {key:'bank_credit',label:'Кредит кредитной организации',lender:'Учебный банк «Казначейский партнер»',debt:'internal',spread:3,risk:'Зависимость от одного кредитора и его платежной инфраструктуры. Банкротство банка не прекращает долг.'},
 {key:'external',label:'Внешнее заимствование',lender:'Иностранный кредитор в учебном сценарии',debt:'external',spread:0,risk:'Валютная переоценка, платежные ограничения и договорный порядок исполнения.'},
 {key:'reserves',label:'Средства ФНБ',lender:'Резервные активы государства',debt:'none',spread:0,risk:'Долг не растет, запас доступных резервов уменьшается. Требуется предусмотренное законом основание.'},
 {key:'privatization',label:'Приватизация акций',lender:'Покупатели государственной доли',debt:'none',spread:0,risk:'Разовый источник: государство теряет долю будущих дивидендов. Продажа нефинансового имущества учитывается иначе.'},
 {key:'other',label:'Прочие источники и изменение остатков',lender:'Казначейские остатки и сальдо иных операций',debt:'none',spread:0,risk:'Отрицательное значение означает отток средств. Нельзя считать эту строку налоговым доходом.'}
] as const;
export type FundingKey=typeof FINANCING_SOURCES[number]['key'];
export type BudgetTransfer={id:string;region_code:string;region_name:string;kind:'grant'|'subsidy'|'subvention'|'budget_credit';amount:number;cofinancing:number;purpose:string;section_key:string;status:'requested'|'included'|'granted'|'rejected';document_id?:string|null;repaid_at?:string|null};
export type BudgetDraft={title:string;income_changes:Record<string,number>;spending_changes:Record<string,number>;revenue_adjustments:Record<string,number>;financing:Record<FundingKey,number>;terms:Record<string,number>;transfer_ids:string[];note:string};
export type SimulatorAnchor={enterprises:number;key_rate:number;fx_rate:number;oil_price:number;inflation:number;economy:number;trust:number};
export type SimulatorState={anchor:SimulatorAnchor;internal_debt:number;external_debt:number;reserve_remaining:number;service_adjustment:number;revenue_adjustment:number;last_financing:Record<FundingKey,number>;financing_rates?:Record<string,number>;month:number;last_document_id:string|null;last_plan_id:string|null;version:number};
export type BudgetCalculation={income_lines:{key:string;label:string;amount:number;baseline:number}[];expense_lines:{key:string;label:string;amount:number;baseline:number}[];revenue:number;expenditure:number;balance:number;deficit:number;surplus:number;deficit_pct_gdp:number;financing:number;funding_need:number;funding_gap:number;cash_excess:number;internal_debt:number;external_debt:number;debt_total:number;debt_pct_gdp:number;annual_interest:number;interest_delta:number;transfer_expense:number;credit_outflow:number;reserve_remaining:number;activity:number;cost:number;fx:number;uncertainty:number;revenue_low:number;revenue_high:number;expenditure_low:number;expenditure_high:number};
export function newBudgetDraft():BudgetDraft {return {title:'Проект федерального бюджета на 2026 год',income_changes:{},spending_changes:{},revenue_adjustments:{},financing:{...baseline.financing},terms:{ofz_fixed:60,ofz_float:60,bank_credit:12,external:60},transfer_ids:[],note:''};}
export function defaultSimulatorState(context:FiscalContext|null,regions:FiscalRegion[]):SimulatorState {
 const p=context?.policy;return {anchor:{enterprises:regions.reduce((s,r)=>s+r.enterprises*r.activity_multiplier,0)||1,key_rate:p?.key_rate??16,fx_rate:p?.fx_rate??80,oil_price:Math.max(.01,p?.oil_price??75),inflation:p?.inflation??6,economy:context?.metrics.economy??50,trust:context?.metrics.public_trust??50},internal_debt:baseline.internal_debt_end,external_debt:baseline.external_debt_end,reserve_remaining:baseline.reserve_available_model,service_adjustment:0,revenue_adjustment:0,last_financing:{...baseline.financing},month:0,last_document_id:null,last_plan_id:null,version:0};
}
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function financingRate(key:string,keyRate:number){return key==='external'?7.5:key==='bank_credit'?keyRate+3:key==='ofz_float'?keyRate+.5:key==='ofz_fixed'?keyRate:0;}
export function fundingAnnualInterest(key:FundingKey,draft:BudgetDraft,state:SimulatorState,keyRate:number){
 const amount=draft.financing[key],issued=state.last_plan_id?Math.min(amount,state.last_financing[key]):0;
 const quote=financingRate(key,keyRate),locked=state.financing_rates?.[key]??financingRate(key,state.anchor.key_rate);
 return key==='ofz_float'?amount*quote/100:(issued*locked+(amount-issued)*quote)/100;
}
/** All monetary calculations use millions of roubles, including cross-budget transfers. */
export function calculateFederalBudget(draft:BudgetDraft,state:SimulatorState,context:FiscalContext|null,regions:FiscalRegion[],rates:FiscalRate[],requests:BudgetTransfer[]):BudgetCalculation {
 const a=state.anchor,p=context?.policy,economy=(context?.metrics.economy??a.economy)-a.economy,trust=(context?.metrics.public_trust??a.trust)-a.trust,key=p?.key_rate??a.key_rate;
 const fx=(p?.fx_rate??a.fx_rate)*clamp(1-economy*.001-trust*.001-(key-a.key_rate)*.0015,.75,1.3);
 const firms=regions.reduce((s,r)=>s+r.enterprises*r.activity_multiplier,0)/Math.max(1,a.enterprises);
 const activity=clamp(firms*(1-(key-a.key_rate)*.007+economy*.002+trust*.001),.2,2);
 const cost=clamp(1+((p?.inflation??a.inflation)-a.inflation)*.004+(fx/a.fx_rate-1)*.02,.7,1.6);
 const oil=clamp((p?.oil_price??a.oil_price)/a.oil_price*fx/a.fx_rate,.1,3);
 const vat=rates.find(r=>r.region_code==='00'&&r.tax_key==='vat')?.rate??22,profit=rates.find(r=>r.region_code==='00'&&r.tax_key==='profit')?.rate??25;
 const income_lines=baseline.income_lines.map(l=>{const driver=l.driver==='oil'?oil:l.driver==='activity'?activity:1;const tax=l.key==='turnover'?1+.72*(vat/22-1):l.key==='income'?1+.8*(profit/25-1):1;return {key:l.key,label:l.label,baseline:l.amount,amount:round(Math.max(0,l.amount*driver*tax*(1+(draft.income_changes[l.key]??0)/100)+(draft.revenue_adjustments[l.key]??0)))};});
 const selected=requests.filter(r=>draft.transfer_ids.includes(r.id)&&r.status!=='rejected');
 const transfer_expense=selected.filter(r=>r.kind!=='budget_credit').reduce((s,r)=>s+r.amount,0),credit_outflow=selected.filter(r=>r.kind==='budget_credit').reduce((s,r)=>s+r.amount,0);
 const annual_interest=FINANCING_SOURCES.filter(s=>s.debt!=='none').reduce((sum,s)=>sum+fundingAnnualInterest(s.key,draft,state,key),0);
 // Half-year convention for new net borrowings; this is an explicit teaching assumption.
 const interest_delta=(annual_interest-baseline.financing.ofz_fixed*a.key_rate/100)*.5+state.service_adjustment;
 const expense_lines=baseline.expense_lines.map(l=>({key:l.key,label:l.label,baseline:l.amount,amount:round(Math.max(0,l.amount*(1+(draft.spending_changes[l.key]??0)/100)*cost+(l.key==='13'?interest_delta:0)+selected.filter(r=>r.kind!=='budget_credit'&&r.section_key===l.key).reduce((s,r)=>s+r.amount,0)))}));
 const revenue=round(income_lines.reduce((s,r)=>s+r.amount,baseline.income_rounding)+state.revenue_adjustment),expenditure=round(expense_lines.reduce((s,r)=>s+r.amount,baseline.expense_rounding));
 const balance=round(revenue-expenditure),deficit=Math.max(0,-balance),surplus=Math.max(0,balance),financing=round(FINANCING_SOURCES.reduce((s,f)=>s+draft.financing[f.key],0));
 const internal=FINANCING_SOURCES.filter(s=>s.debt==='internal').reduce((s,f)=>s+draft.financing[f.key]-state.last_financing[f.key],0);
 const internal_debt=round(Math.max(0,state.internal_debt+internal)),external_debt=round(Math.max(0,state.external_debt*fx/a.fx_rate+draft.financing.external-state.last_financing.external));
 const funding_need=round(deficit+credit_outflow),funding_gap=round(Math.max(0,funding_need-financing)),cash_excess=round(Math.max(0,financing-funding_need)+surplus);
 const uncertainty=clamp(.04+Math.abs(economy)*.001+Math.abs(trust)*.001+Math.abs((p?.inflation??a.inflation)-a.inflation)*.003,.025,.2);
 return {income_lines,expense_lines,revenue,expenditure,balance,deficit,surplus,deficit_pct_gdp:deficit/baseline.gdp*100,financing,funding_need,funding_gap,cash_excess,internal_debt,external_debt,debt_total:internal_debt+external_debt,debt_pct_gdp:(internal_debt+external_debt)/baseline.gdp*100,annual_interest,interest_delta,transfer_expense,credit_outflow,reserve_remaining:round(state.reserve_remaining-draft.financing.reserves+(state.last_plan_id?state.last_financing.reserves:0)),activity,cost,fx,uncertainty,revenue_low:revenue*(1-uncertainty),revenue_high:revenue*(1+uncertainty),expenditure_low:expenditure*(1-uncertainty),expenditure_high:expenditure*(1+uncertainty)};
}
export function coverFundingGap(draft:BudgetDraft,key:FundingKey,state:SimulatorState,context:FiscalContext|null,regions:FiscalRegion[],rates:FiscalRate[],requests:BudgetTransfer[]){
 const next={...draft,financing:{...draft.financing}};
 for(let i=0;i<12;i++){const c=calculateFederalBudget(next,state,context,regions,rates,requests);if(c.funding_gap<=.01)break;next.financing[key]=round(next.financing[key]+c.funding_gap);}
 return next;
}
export const billions=(n:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n/(Math.abs(n)>=1000000?1000000:1000))+(Math.abs(n)>=1000000?' трлн ₽':' млрд ₽');
export const transferLabels={grant:'Дотация',subsidy:'Субсидия',subvention:'Субвенция',budget_credit:'Бюджетный кредит'};
