const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {calculateFederalBudget,defaultSimulatorState,newBudgetDraft}=require('../components/game/federalBudgetMath');
const {fiscalForecast}=require('../components/game/fiscalMath');
const r={game_id:'offline',region_code:'22',profile:'industrial',enterprises:1000,activity_multiplier:1,employees_per_firm:10,monthly_wage:50000,profit_per_firm:3,consumption_per_firm:4,expenditure:20000,transfer_in:0,debt:0,compliance:.95,cost_multiplier:1};
const policy={key_rate:16,fx_rate:80,oil_price:75,inflation:6,baseline_economy:50,baseline_trust:50,collection_lawfulness_reference:24};
const ctx=n=>({policy,metrics:{economy:50,public_trust:50,lawfulness:n}});
const state=defaultSimulatorState(ctx(24),[r]),draft=newBudgetDraft();
const run=n=>calculateFederalBudget(draft,state,ctx(n),[r],[],[]);
const base=run(24),up=run(25),down=run(23);
assert.equal(base.revenue,40283300,'95% must preserve pre-existing base budget');
assert.equal(base.income_details.length,12);
const taxable=new Set(['oil_gas','turnover','income','rent','recycling']);
assert(up.revenue>base.revenue && down.revenue<base.revenue,'Collection must affect total national revenue');
for(const l of base.income_details){
 const hi=up.income_details.find(x=>x.key===l.key),lo=down.income_details.find(x=>x.key===l.key);
 const nonTax=['dividends','asset_interest','other'].includes(l.key);
 assert.equal(l.collection,nonTax?1:.95,l.key+' baseline collection');
 assert.equal(hi.collection,nonTax?1:.9503,l.key+' higher collection');
 assert.equal(lo.collection,nonTax?1:.9497,l.key+' lower collection');
 if(nonTax){assert.equal(hi.amount,l.amount,l.key+' never changes from lawfulness')}else{
  assert(hi.amount>l.amount && lo.amount<l.amount,l.key+' paid tax changes');
  assert(Math.abs(hi.base-l.base)<2,l.key+' underlying taxable base must not jump from collection alone');
 }
}
const f0=fiscalForecast(r,[],undefined,ctx(24)),f1=fiscalForecast(r,[],undefined,ctx(25)),f2=fiscalForecast(r,[],undefined,ctx(23));
assert(f1.regionalTax>f0.regionalTax && f2.regionalTax<f0.regionalTax,'Regional collection follows same metric');
assert(run(24).income_details.every(l=>Number.isFinite(l.base)&&Number.isFinite(l.amount)));
assert(run(-999).income_details.every(l=>l.collection>=.85),'Lower bound');
assert(run(999).income_details.every(l=>l.collection<=1),'Upper bound');
const trustUp={...ctx(24),metrics:{...ctx(24).metrics,public_trust:52}};
const trust=calculateFederalBudget(draft,state,trustUp,[r],[],[]);
assert(trust.revenue>base.revenue,'Trust still changes the established business-activity channel');
assert(trust.income_details.filter(l=>taxable.has(l.group_key)).every(l=>l.collection===.95),'Trust does not trigger duplicate collection effects');
console.log('PASS Economy B dynamic: preserved baseline, national + regional collection, real income movements, bounded coefficients, no duplicate trust collection');
