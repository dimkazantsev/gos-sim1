/* Independent accounting invariants against the real TypeScript model. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {calculateFederalBudget:calculate,newBudgetDraft,defaultSimulatorState,coverFundingGap,budgetMoney}=require('../components/game/federalBudgetMath');
const {fiscalForecast}=require('../components/game/fiscalMath');
const baseline=require('../data/federal-budget-2026.json'),model=require('../data/budget-revenue-model.json');
const near=(actual,expected,label,tolerance=.000001)=>assert(Math.abs(actual-expected)<=tolerance,label+': '+actual+' != '+expected);
const sum=(rows,key='amount')=>rows.reduce((n,row)=>n+Number(row[key]||0),0);
const kopecks=value=>{const fixed=Math.abs(value).toFixed(8),[whole,fraction]=fixed.split('.');return (BigInt(whole)*100000000n+BigInt(fraction))*(value<0?-1n:1n);};
const regions=[{game_id:'qa-game',region_code:'54',name:'Учебный регион',profile:'industrial',disputed:false,budget_year:2026,enterprises:1000,activity_multiplier:1,employees_per_firm:10,monthly_wage:50000,profit_per_firm:3,consumption_per_firm:4,expenditure:20000,transfer_in:3000,debt:4000,compliance:1,cost_multiplier:1,observations:{},source_url:'',source_year:2025}];
const context={policy:{key_rate:16,fx_rate:80,oil_price:75,cutoff_price:60,inflation:6,federal_expenditure:0,municipal_expenditure:0,baseline_economy:50,baseline_trust:50,updated_at:''},metrics:{economy:50,public_trust:50},can_change_rate:true};
const state=defaultSimulatorState(context,regions),draft=newBudgetDraft();
const run=(d=draft,s=state,c=context,r=regions,rates=[],requests=[])=>calculate(d,s,c,r,rates,requests);
const first=run(),article=(calculation,key)=>calculation.income_details.find(l=>l.key===key),section=(calculation,key)=>calculation.expense_lines.find(l=>l.key===key);
assert.equal(budgetMoney(16.1*1000),16100,'Billion-ruble input yields a canonical million-ruble JSON amount');assert.equal(budgetMoney(32.3*1000),32300,'A second decimal-billion conversion is canonical');assert.equal(budgetMoney(Number('100000039457.31')/1e6),100000.03945731,'A large signed annual amount preserves rubles and kopecks');assert.equal(budgetMoney(Number('123456789.12')/1e6),123.45678912,'A signed annual amount cannot emit an extra ninth fractional digit rejected by PostgreSQL');

assert.equal(new Set(model.map(l=>l.key)).size,model.length,'Each detailed revenue article appears once');
for(const group of baseline.income_lines)near(sum(model.filter(l=>l.group_key===group.key),'share'),1,'Complete, non-overlapping allocation of '+group.key);
assert.equal(first.revenue,40283300);assert.equal(first.expenditure,44069700);assert.equal(first.deficit,3786400);assert.equal(first.funding_gap,0);

function accounting(c,label,eventRevenue=0){
 assert.equal(c.income_details.length,12,label+': all detailed articles are present');
 for(const row of c.income_details){
  const denominator=row.rate_unit==='rubles'?1e6:100;
  near(row.amount,row.base*row.rate/denominator*row.collection*row.federal_share,label+': rate × base formula '+row.key);
  assert(Number.isFinite(row.base)&&row.base>=0,label+': finite non-negative base '+row.key);
  assert(Number.isFinite(row.amount)&&row.amount>=0,label+': finite non-negative proceeds '+row.key);
 }
 for(const group of c.income_lines)near(sum(c.income_details.filter(l=>l.group_key===group.key)),group.amount,label+': detailed sum '+group.key);
 near(sum(c.income_details)+baseline.income_rounding+eventRevenue,c.revenue,label+': detailed revenue grand total');
 near(sum(c.expense_lines)+baseline.expense_rounding,c.expenditure,label+': expenditure grand total');
 near(c.revenue-c.expenditure,c.balance,label+': balance');
 near(Math.max(0,c.expenditure-c.revenue),c.deficit,label+': deficit');
 near(Math.max(0,c.revenue-c.expenditure),c.surplus,label+': surplus');
 near(c.deficit+c.credit_outflow,c.funding_need,label+': loan principal below the expenditure line');
 near(Math.max(0,c.funding_need-c.financing),c.funding_gap,label+': uncovered financing');
}
accounting(first,'Unchanged baseline');
assert.equal(article(first,'profit').federal_share,.32,'The federal income is only its assigned share of total profit tax');
assert.equal(article(first,'recycling').rate_unit,'rubles');assert.equal(article(first,'recycling').base_unit,'units');
near(article(first,'recycling').base*article(first,'recycling').rate/1e6,article(first,'recycling').amount,'Unit levy converted from rubles to millions');

const expanded=run(draft,state,context,[{...regions[0],enterprises:1100}]);
near(article(expanded,'vat').base/article(first,'vat').base,1.1,'An accepted enterprise-growth outcome changes VAT base');
assert(expanded.revenue>first.revenue,'Economic events alter federal receipts');accounting(expanded,'Enterprise event');
const slowdown=run(draft,state,context,[{...regions[0],activity_multiplier:.8}]);assert(article(slowdown,'profit').base<article(first,'profit').base);accounting(slowdown,'Regional crisis');
const oil=run(draft,state,{...context,policy:{...context.policy,oil_price:50}});assert(article(oil,'oil_ndpi').base<article(first,'oil_ndpi').base);accounting(oil,'Oil-price event');
const trust=run(draft,state,{...context,metrics:{economy:60,public_trust:55}});assert(article(trust,'vat').base>article(first,'vat').base);accounting(trust,'Accepted economic and trust decisions');
const vat=run(draft,state,context,regions,[{region_code:'00',tax_key:'vat',rate:24}]);
near(article(vat,'vat').amount/article(first,'vat').amount,24/22,'Only the adopted VAT rate is used');near(article(vat,'excise').amount,article(first,'excise').amount,'VAT changes do not also raise excises beyond aggregate forecast rounding',.01);near(article(vat,'profit').amount,article(first,'profit').amount,'VAT is not profit tax');accounting(vat,'Adopted VAT act');
const profit=run(draft,state,context,regions,[{region_code:'00',tax_key:'profit',rate:30}]);near(article(profit,'profit').amount/article(first,'profit').amount,30/25,'Adopted profit-tax rate');near(article(profit,'personal_income').amount,article(first,'personal_income').amount,'Profit change is not a personal-income-tax change');accounting(profit,'Adopted profit-tax act');
const zeroVat=run(draft,state,context,regions,[{region_code:'00',tax_key:'vat',rate:0}]);assert.equal(article(zeroVat,'vat').amount,0);near(article(zeroVat,'excise').amount,article(first,'excise').amount,'A zero VAT rate does not erase other turnover receipts');accounting(zeroVat,'Zero VAT');
const adjusted=run({...draft,income_changes:{turnover:-15},revenue_adjustments:{turnover:12345.67}});accounting(adjusted,'Legacy explicit forecast adjustments');
const collapsed=run({...draft,revenue_adjustments:{turnover:-100000000}});assert.equal(article(collapsed,'vat').amount,0);accounting(collapsed,'Exhausted forecast group');
const eventAdjustment=run(draft,{...state,revenue_adjustment:-500});accounting(eventAdjustment,'Separate one-time income consequence',-500);assert.equal(eventAdjustment.revenue,first.revenue-500);

const custom={id:'qa-item',section_key:'07',title:'Школьные места',indicator:'120 новых мест',justification:'Устранить дефицит учебных мест',amount:12.34567891,budget_year:2026};
const programme={id:'qa-program-item',section_key:'09',title:'Доступная медицина',indicator:'Результаты утверждённой программы',justification:'Годовые расходы по принятой программе',amount:123.45678912,program_id:'qa-program',budget_year:2026};
const withItems={...draft,expense_items:[custom,programme]},items=run(withItems);
near(items.expenditure-first.expenditure,custom.amount+programme.amount,'Rubles and kopecks survive conversion into millions');
near(section(items,'07').items_amount,custom.amount,'Individual expenditure stays in its functional section');near(section(items,'09').items_amount,programme.amount,'Annual program amount occurs once');near(section(items,'09').base_amount,section(first,'09').base_amount,'Programmes do not replace or silently rescale base obligations');accounting(items,'Itemised expenditure');
const reduced=run({...withItems,spending_changes:{'09':-20}});near(section(reduced,'09').items_amount,programme.amount,'A percentage adjustment cannot reduce an approved explicit annual program amount');accounting(reduced,'Separate baseline and annual programme');

const requests=[
 {id:'qa-subsidy',region_code:'54',region_name:'Учебный регион',kind:'subsidy',amount:1250,cofinancing:250,purpose:'Построить районную поликлинику',section_key:'09',status:'requested',event_case_id:'qa-regional-event',expected_result:'Открыта поликлиника на 300 посещений'},
 {id:'qa-grant',region_code:'54',region_name:'Учебный регион',kind:'grant',amount:500,cofinancing:0,purpose:'Обеспечить баланс бюджета региона',section_key:'14',status:'requested'},
 {id:'qa-credit',region_code:'54',region_name:'Учебный регион',kind:'budget_credit',amount:700,cofinancing:0,purpose:'Преодолеть временный кассовый разрыв',section_key:'04',status:'requested'},
 {id:'qa-rejected',region_code:'54',region_name:'Учебный регион',kind:'subvention',amount:9999,cofinancing:0,purpose:'Отклонённая заявка',section_key:'09',status:'rejected'}
];
const requested=run(draft,state,context,regions,[],requests);assert.equal(requested.expenditure,first.expenditure,'A request on the map is not an approved expenditure');assert.equal(requested.credit_outflow,0,'A submitted loan request does not create a cash outflow');
const includedDraft={...withItems,transfer_ids:requests.map(r=>r.id)},included=run(includedDraft,state,context,regions,[],requests);
near(included.expenditure-items.expenditure,1750,'Only subsidy and grant amounts add to expenditure');near(section(included,'09').transfer_amount,1250,'The subsidy is recorded in healthcare');near(section(included,'14').transfer_amount,500,'A grant belongs to general interbudgetary transfers');assert.equal(included.credit_outflow,700,'Loan principal is separately financed');assert.equal(included.revenue,items.revenue,'Neither grants nor borrowing increase federal income');near(included.funding_need-items.funding_need,2450,'Expense and loan cash needs are counted once');accounting(included,'Included regional requests');
const coveredDraft=coverFundingGap(includedDraft,'ofz_fixed',state,context,regions,[],requests),covered=run(coveredDraft,state,context,regions,[],requests);assert.equal(covered.funding_gap,0,'Funding includes its own extra coupon expenditure with no residual kopeck');assert(coveredDraft.financing.ofz_fixed>draft.financing.ofz_fixed+2450,'Borrowing pays for its own interest');accounting(covered,'Financed project');assert.equal(state.last_plan_id,null,'Forecast computation does not publish a law or grant a transfer');
const preciseTransfer=run({...draft,transfer_ids:['qa-subsidy']},state,context,regions,[],[{...requests[0],amount:1250.00000012}]);near(preciseTransfer.expenditure-first.expenditure,1250.00000012,'Transfer rubles and kopecks are not rounded out of expense appropriations');accounting(preciseTransfer,'Precise transfer appropriation');

const issued={...state,last_plan_id:'qa-published-plan',financing_rates:{ofz_fixed:16}},higherRate={...context,policy:{...context.policy,key_rate:24}};
assert.equal(run(draft,issued,higherRate).annual_interest,run(draft,issued).annual_interest,'Issued fixed coupons remain fixed after a central-bank decision');
const floatDraft={...draft,financing:{...draft.financing,ofz_float:1000}},floatIssued={...issued,last_financing:{...state.last_financing,ofz_float:1000}};assert(run(floatDraft,floatIssued,higherRate).annual_interest>run(floatDraft,floatIssued).annual_interest,'Floating coupons respond to the key rate');
const bank=run({...draft,financing:{...draft.financing,bank_credit:1000}});assert.equal(bank.revenue,first.revenue,'A bank loan is not budget revenue');assert.equal(bank.internal_debt-first.internal_debt,1000,'Bank loan principal creates debt');
const precisePrincipal=123.45678912,preciseLoan=run({...draft,financing:{...draft.financing,bank_credit:precisePrincipal}});near(preciseLoan.internal_debt-first.internal_debt,precisePrincipal,'Ruble-precise borrowing must create the same principal debt',.00000002);
const regional=fiscalForecast(regions[0],[]),regionalLoan=fiscalForecast({...regions[0],budget_credit_cash:700},[]);assert.equal(regionalLoan.revenue,regional.revenue,'A regional loan is not transfer income');assert.equal(regionalLoan.financing,700,'Regional loan cash is separate financing');

function reallocationInvariant(baseDraft,from,to,amount,c=context,label='Second reading',reloads=20){
 const cleanDraft={...baseDraft,transfer_ids:baseDraft.transfer_ids.filter(id=>requests.find(r=>r.id===id)?.status!=='rejected')};
 const before=run(cleanDraft,state,c,regions,[],requests);
 let voted={...cleanDraft,base_reallocations:{...(cleanDraft.base_reallocations||{}),[from]:budgetMoney((cleanDraft.base_reallocations?.[from]||0)-amount),[to]:budgetMoney((cleanDraft.base_reallocations?.[to]||0)+amount)}};
 const expected=kopecks(amount);
 for(let pass=0;pass<reloads;pass++){
  // The same stored appropriation must survive repeated transport/reloads,
  // without becoming another percentage change or being applied again.
  voted=JSON.parse(JSON.stringify(voted));const after=run(voted,state,c,regions,[],requests);
  assert.equal(kopecks(section(after,from).amount)-kopecks(section(before,from).amount),-expected,label+': exact source reduction, reload '+pass);
  assert.equal(kopecks(section(after,to).amount)-kopecks(section(before,to).amount),expected,label+': exact target increase, reload '+pass);
  for(const row of after.expense_lines){
   const original=section(before,row.key);assert.equal(kopecks(row.items_amount),kopecks(original.items_amount),label+': programme and individual appropriations are protected in '+row.key);assert.equal(kopecks(row.transfer_amount),kopecks(original.transfer_amount),label+': earmarked transfer is protected in '+row.key);
   assert.equal(kopecks(row.base_amount)+kopecks(row.items_amount)+kopecks(row.transfer_amount)+kopecks(row.interest_amount),kopecks(row.amount),label+': displayed constituents sum to the section appropriation in '+row.key);
  }
  for(const key of ['revenue','expenditure','balance','deficit','surplus','financing','funding_need','funding_gap','cash_excess','internal_debt','external_debt','annual_interest'])assert.equal(kopecks(after[key]),kopecks(before[key]),label+': redistribution preserves '+key);
  for(const key of ['activity','cost','fx','uncertainty','deficit_pct_gdp','debt_pct_gdp'])assert.equal(after[key],before[key],label+': redistribution preserves macro indicator '+key);
  assert.deepEqual(after.expense_items,before.expense_items,label+': signed programme and item details remain unchanged');assert.deepEqual(after.transfer_requests,before.transfer_requests,label+': selected requests remain unchanged');accounting(after,label+' reload '+pass);
 }
 return voted;
}
const afterKopeck=reallocationInvariant(includedDraft,'04','09',.00000001,context,'One-kopeck amendment');
reallocationInvariant(afterKopeck,'09','04',.00000001,context,'Reverse one-kopeck amendment');
reallocationInvariant(includedDraft,'09','07',5.12345678,context,'Precise reallocation alongside earmarked programme and subsidy');
const volatileContext={...context,policy:{...context.policy,key_rate:17.137,fx_rate:91.231,oil_price:63.337,inflation:9.913},metrics:{economy:47.119,public_trust:41.337}};
const volatileDraft={...includedDraft,spending_changes:{'04':12.3456789,'09':-12.3421876,'07':23.2185,'13':-3.218765},financing:{...includedDraft.financing,ofz_fixed:3980100.12345678,ofz_float:7.45678912,bank_credit:16100.10000001,external:32300.23232323}};
reallocationInvariant(volatileDraft,'09','07',5.12345678,volatileContext,'Interest and inflation rounding with exact second-reading appropriation');

// Section order changes which binary-float additions cancel; exercise every
// ordered pair against plain, earmarked and fractional-interest budgets.
const movableSections=baseline.expense_lines.filter(row=>row.key!=='13').map(row=>row.key);
assert.equal(movableSections.length,13,'All movable functional sections are covered');
let orderedPairs=0,pairReloads=0;
for(const from of movableSections)for(const to of movableSections){
 if(from===to)continue;
 orderedPairs++;
 for(const [base,c,label] of [[draft,context,'Baseline'],[includedDraft,context,'Earmarked'],[volatileDraft,volatileContext,'Interest-rounded']]){
  reallocationInvariant(base,from,to,.00000001,c,label+' one-kopeck pair '+from+' → '+to,2);
  pairReloads+=2;
 }
}
assert.equal(orderedPairs,156,'All ordered non-interest section pairs are exercised');

let stressed=0;
for(const enterprises of [600,1000,1400])for(const vatRate of [0,22,28])for(const oilPrice of [35,75,105]){
 const c=run(withItems,state,{...context,policy:{...context.policy,oil_price:oilPrice}},[{...regions[0],enterprises}],[{region_code:'00',tax_key:'vat',rate:vatRate}],requests);accounting(c,'Combined scenario '+(++stressed));
}
console.log('PASS Budget workflow math: 12 rate/base articles, group and grand totals, dynamic economic/tax/oil bases, exact itemised rubles, separate event adjustments, selected transfers vs loans, fixed/floating coupons, financing closure, '+orderedPairs+' ordered one-kopeck section pairs across 3 budgets, '+(80+pairReloads)+' exact second-reading JSON reloads and '+stressed+' combined scenarios');
