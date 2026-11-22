const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {modelBAdditionalChannels,MODEL_B_AUX_KEYS,fiscalForecast}=require('../components/game/fiscalMath');
const {calculateFederalBudget,newBudgetDraft,defaultSimulatorState}=require('../components/game/federalBudgetMath');
const metrics={economy:16,public_trust:12,lawfulness:24,social_stability:10,security:13,elite_support:8,international_standing:3,social_tension:92,legitimacy:7,media_climate:29};
const policy={key_rate:16,fx_rate:80,oil_price:75,inflation:6,baseline_economy:16,baseline_trust:12,collection_lawfulness_reference:24,budget_aux_anchor:Object.fromEntries(MODEL_B_AUX_KEYS.map(k=>[k,metrics[k]]))};
const region={game_id:'offline',region_code:'54',profile:'industrial',enterprises:3200,activity_multiplier:1,employees_per_firm:14,monthly_wage:50000,profit_per_firm:2,consumption_per_firm:4,expenditure:14000,transfer_in:0,debt:0,compliance:.95,cost_multiplier:1};
const context={policy,metrics},state=defaultSimulatorState(context,[region]),draft=newBudgetDraft();
const run=m=>calculateFederalBudget(draft,state,{policy,metrics:m},[region],[],[]);
const base=run(metrics);
assert.deepEqual(base.model_b_additional_channels,{activity_adjustment:0,collection_adjustment:0});
const polarity={social_stability:1,security:1,elite_support:1,international_standing:1,social_tension:-1,legitimacy:1,media_climate:1};
for(const [k,sign] of Object.entries(polarity)){
 const changed={...metrics,[k]:metrics[k]+1};
 assert(sign*(run(changed).revenue-base.revenue)>0,k+' federal revenue');
 const regional=fiscalForecast(region,[],undefined,context).revenue;
 const updated=fiscalForecast(region,[],undefined,{policy,metrics:changed}).revenue;
 assert(sign*(updated-regional)>0,k+' regional revenue');
}
assert.equal(run(metrics).revenue,base.revenue,'Original forecast stays fixed at anchor');
assert(run({...metrics,economy:17}).revenue>base.revenue,'Economy channel preserved');
assert(run({...metrics,public_trust:13}).revenue>base.revenue,'Trust channel preserved');
assert(run({...metrics,lawfulness:25}).revenue>base.revenue,'Legal channel preserved');
const high=Object.fromEntries(MODEL_B_AUX_KEYS.map(k=>[k,100]));
const low=Object.fromEntries(MODEL_B_AUX_KEYS.map(k=>[k,0]));
assert.equal(modelBAdditionalChannels({...high,social_tension:-100},low).activity_adjustment,.03);
console.log('PASS: all ten indicators affect federal revenues; additional seven affect regional forecasts; anchor and caps preserved');
