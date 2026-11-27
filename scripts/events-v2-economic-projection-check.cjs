'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const m=require('../components/game/economicModelV2.ts');
const budget=require('../data/federal-budget-2026.json');
const dir=path.join(root,'content/events-v2-editorial');
const cases=fs.readdirSync(dir).filter(n=>/^collective-.*\.json$/.test(n)).sort().flatMap(n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')).cases);
function runProjection(m,budget,cases){
 const clamp=(x,l,h)=>Math.max(l,Math.min(h,x)),round=(v,n=6)=>Number(v.toFixed(n));
 const keys=["economy","public_trust","elite_support","international_standing","media_climate","security","social_stability","social_tension","legitimacy","lawfulness"],metrics=Object.fromEntries(keys.map(k=>[k,k==="social_tension"?60:50]));
 const neutral={state:metrics,keyRate:16,baseFx:80,oil:75,override:null,reference:null,firmFactor:1};
 const scenarios=[
 {key:"neutral",...neutral},{key:"manual_56",...neutral,override:56,reference:1},
 {key:"stress",...neutral,state:{...metrics,economy:42,public_trust:40,security:35,social_stability:35,elite_support:40,international_standing:40,media_climate:35,lawfulness:40,social_tension:96},keyRate:21,baseFx:65,oil:60,firmFactor:.9},
 {key:"near_lower_bounds",...neutral,state:Object.fromEntries(keys.map(k=>[k,k==="social_tension"?99:1]))},
 {key:"near_upper_bounds",...neutral,state:Object.fromEntries(keys.map(k=>[k,k==="social_tension"?1:99]))},
 {key:"manual_zero",...neutral,override:0,reference:1}];
 const taxable=new Set(["oil_gas","turnover","income","rent","recycling"]);
 function project(s,state){
  const aux=m.economicAuxV2(state,metrics),e=state.economy-50,t=state.public_trust-50;
  const auto=m.economicAutomaticV2(s.keyRate,s.baseFx,e,t,aux.activity_adjustment);
  const macro=m.economicManualV2(auto.automatic,s.override,s.reference);
  const factors=m.enterpriseFactorsV2(269000*s.firmFactor,269000*s.firmFactor,269000,macro);
  const collection=m.boundedCollectionV2(.95+m.economicCollectionV2(macro,1,state.lawfulness-50,t,aux.collection_adjustment),.70,.995);
  const oil=clamp(s.oil/75*auto.fx/80,.1,3)*clamp(1+e*.002,.7,1.3);
  const revenue=round(budget.income_rounding+budget.income_lines.reduce((sum,l)=>sum+round(Math.max(0,l.amount*(l.driver==="oil"?oil:l.driver==="activity"?factors.activity:1)*(taxable.has(l.key)?collection/.95:1)),2),0),2);
  return {business:macro,activity:factors.activity,collection,fx:auto.fx,revenue};
 }
 const baseline=scenarios.map(s=>project(s,s.state)),allowed=new Set(["economy","elite_support","international_standing","media_climate","security","social_stability","social_tension"]),result=[],errors=[];
 let options=0,projections=0,baseDominated=0,basePairs=0,noAdvantage=0,revAdvantage=0,revNeutral=0;
 const ranges=scenarios.map(s=>({key:s.key,minRevenueDelta:Infinity,maxRevenueDelta:-Infinity,minBusinessDelta:Infinity,maxBusinessDelta:-Infinity,minCollectionDelta:Infinity,maxCollectionDelta:-Infinity,clippedOptions:0}));
 const ge=(a,b)=>b.every((x,k)=>x>=a[k]-1e-9)&&b.some((x,k)=>x>a[k]+1e-9);
 for(const c of cases){
  const os=c.effect_plan.options,labels=c.decision_options,metricKeys=[...new Set(os.flatMap(o=>Object.keys(o.metric_effects??{})))].sort();
  if(c.effect_plan.best_option_key||c.audience==="single"||os.length!==labels.length)errors.push(c.case_key+": shape");
  const v=os.map(o=>[o.trust,...metricKeys.map(k=>(k==="social_tension"?-1:1)*(o.metric_effects?.[k]??0))]);
  const items=os.map((o,i)=>{
   options++;
   if(o.lawful!==true||o.fiscal_effect||o.key!==`option_${i+1}`||!Number.isFinite(o.trust)||Math.abs(o.trust)>4||Object.entries(o.metric_effects??{}).some(([k,x])=>!allowed.has(k)||!Number.isFinite(x)||Math.abs(x)>4))errors.push(c.case_key+":"+o.key+": validator");
   const delta={public_trust:o.trust,...o.metric_effects};
   const effects=scenarios.map((s,j)=>{
    let state={...s.state},clipped=false;for(const [k,d] of Object.entries(delta)){const proposed=state[k]+d;state[k]=clamp(proposed,0,100);if(state[k]!==proposed)clipped=true;}
    const p=project(s,state),b=baseline[j],revenue=round(p.revenue-b.revenue,2),business=round(p.business-b.business),collection=round((p.collection-b.collection)*100),activity=round(p.activity-b.activity),fx=round(p.fx-b.fx);
    if(![revenue,business,collection,activity,fx].every(Number.isFinite)||p.collection<.70-1e-9||p.collection>.995+1e-9||p.activity<0||p.activity>10||(s.key==="manual_zero"&&p.activity!==0))errors.push(c.case_key+":"+o.key+": projection");
    const z=ranges[j];z.minRevenueDelta=Math.min(z.minRevenueDelta,revenue);z.maxRevenueDelta=Math.max(z.maxRevenueDelta,revenue);z.minBusinessDelta=Math.min(z.minBusinessDelta,business);z.maxBusinessDelta=Math.max(z.maxBusinessDelta,business);z.minCollectionDelta=Math.min(z.minCollectionDelta,collection);z.maxCollectionDelta=Math.max(z.maxCollectionDelta,collection);z.clippedOptions+=+clipped;
    projections++;return [business,activity,collection,fx,revenue,+clipped];
   });
   return {key:o.key,metrics:delta,scenario_deltas:effects};
  });
  const dominated=[];
  for(let i=0;i<os.length;i++){
   const better=[];for(let j=0;j<os.length;j++){
    if(i===j||!ge(v[i],v[j]))continue;basePairs++;
    const revenueAdvantage=scenarios.filter((s,k)=>items[i].scenario_deltas[k][4]>items[j].scenario_deltas[k][4]+.01).map(s=>s.key);
    const economicAdvantage=scenarios.filter((s,k)=>[0,1,2,4].some(col=>items[i].scenario_deltas[k][col]>items[j].scenario_deltas[k][col]+1e-6)).map(s=>s.key);
    if(revenueAdvantage.length)revAdvantage++;if(revenueAdvantage.includes("neutral"))revNeutral++;if(!economicAdvantage.length)noAdvantage++;
    better.push({by:os[j].key,revenue_advantage_scenarios:revenueAdvantage,any_economic_advantage_scenarios:economicAdvantage});
   }if(better.length){baseDominated++;dominated.push({key:os[i].key,better})}
  }
  result.push({case_key:c.case_key,options:items,direct_dominance:dominated});
 }
 if(cases.length!==189||options!==947||projections!==947*scenarios.length)errors.push("catalog totals");
 if(Math.abs(baseline[0].revenue-40283300)>.01||Math.abs(baseline[0].business-1)>1e-9||Math.abs(baseline[0].collection-.95)>1e-9)errors.push("neutral baseline");
 return {status:"diagnostic_only_unapproved_coefficients",model:"economicModelV2.ts pure functions and income-line formula from migration 20261126183036; neutral tax rates, fixed enterprise counts, no direct ledger effects; not full budget or runtime test",units:{business:"multiplier delta",activity:"multiplier delta",collection:"percentage points",fx:"rubles per model foreign currency unit",revenue:"million rubles forecast delta, NOT cash or appropriations",clipped:"1 if metric bound applied"},array_order:["business","activity","collection","fx","revenue","clipped"],scenarios,baseline,summary:{cases:cases.length,options,projections,baseDominated,basePairs,basePairsWithRevenueAdvantageInSomeScenario:revAdvantage,basePairsWithRevenueAdvantageNeutral:revNeutral,basePairsWithNoEconomicAdvantageInAnyScenario:noAdvantage,scenarioRanges:ranges},errors,cases:result};
}
const r=runProjection(m,budget,cases);
assert.deepEqual(r.errors,[]);
console.log(JSON.stringify({summary:r.summary,baseline:r.baseline},null,2));
if(process.argv.includes('--report'))fs.writeFileSync(process.argv[process.argv.indexOf('--report')+1],JSON.stringify(r,null,2)+'\n');
console.log('PASS synthetic economic projection; not release authorization');
