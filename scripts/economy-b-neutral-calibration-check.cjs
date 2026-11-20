const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {calculateFederalBudget,defaultSimulatorState,newBudgetDraft}=require('../components/game/federalBudgetMath');
const {fiscalEnvironment,fiscalForecast}=require('../components/game/fiscalMath');
const r={game_id:'offline',region_code:'22',profile:'industrial',enterprises:1000,activity_multiplier:1,employees_per_firm:10,monthly_wage:50000,profit_per_firm:3,consumption_per_firm:4,expenditure:20000,transfer_in:0,debt:0,compliance:.95,cost_multiplier:1};
const p={key_rate:16,fx_rate:80,oil_price:75,inflation:6,baseline_economy:50,baseline_trust:50};
const context={policy:p,metrics:{economy:50,public_trust:50}},state=defaultSimulatorState(context,[r]),draft=newBudgetDraft();
const run=(c=context,regions=[r])=>calculateFederalBudget(draft,state,c,regions,[],[]);
const base=run();
assert.equal(base.revenue,40283300,'Do not alter the accepted budget');
assert.equal(base.expenditure,44069700);
assert.equal(base.income_details.length,12);
assert(Math.abs(base.income_details.reduce((s,l)=>s+l.amount,0)-40283100)<.02);
const nonTax=new Set(['dividends','asset_interest','other']);
for(const l of base.income_details){
 assert.equal(l.collection,nonTax.has(l.key)?1:.95,l.key+' classification');
 const factor=l.rate_unit==='rubles'?l.rate/1e6:l.rate/100;
 assert(Math.abs(l.base*factor*l.collection*l.federal_share-l.amount)<.00001,l.key+' calculation');
}
for(const group of base.income_lines){
 const total=base.income_details.filter(l=>l.group_key===group.key).reduce((s,l)=>s+l.amount,0);
 assert(Math.abs(total-group.amount)<.02,group.key+' group reconciliation');
}
const manualContext={...context,policy:{...p,activity_override:55.7,activity_reference:1}};
const manual=run(manualContext);
assert(Math.abs(manual.activity-.557)<1e-10,'Manual activity affects federal forecasts');
assert.equal(fiscalEnvironment(manualContext).activity,.557);
assert(manual.revenue<base.revenue);
assert(fiscalForecast(r,[],undefined,manualContext).revenue<fiscalForecast(r,[],undefined,context).revenue);
assert(run({...context,policy:{...p,key_rate:18}}).revenue<base.revenue,'Automatic rate path still works');
assert(run(context,[{...r,activity_multiplier:.98}]).revenue<base.revenue,'Event activity changes federal base');
assert(run({...context,metrics:{economy:50,public_trust:52}}).revenue>base.revenue,'Trust retains prior effect, no new double accounting');
assert(run({...context,policy:{...p,oil_price:65}}).revenue<base.revenue,'Oil effects remain');
console.log('PASS Economy B: 12 articles, 7 groups, neutral 95% calibration, 55.7% override, federal and regional consistency');
