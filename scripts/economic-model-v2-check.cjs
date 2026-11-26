// Isolated parity checks. No production requests or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{PGlite}=require('@electric-sql/pglite');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
const path=require('node:path'),Module=require('node:module'),resolve=Module._resolveFilename,root=path.resolve(__dirname,'..');
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
const m=require('../components/game/economicModelV2.ts');
const {fiscalEnvironment,fiscalForecast}=require('../components/game/fiscalMath');
const {calculateFederalBudget,defaultSimulatorState,newBudgetDraft}=require('../components/game/federalBudgetMath');
const near=(actual,expected,label)=>assert(Math.abs(Number(actual)-expected)<Math.max(1e-9,Math.abs(expected)*1e-13),label+': '+actual+' vs '+expected);
const compare=(a,b,label)=>Object.keys(b).forEach(k=>near(a[k],b[k],label+' '+k));
(async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE SCHEMA private;CREATE ROLE anon;CREATE ROLE authenticated;'+fs.readFileSync('scripts/economic-model-v2-core.sql','utf8'));
  const scenarios=[
   {key:16,fx:80,e:0,t:0,metrics:{},anchors:{},override:null,reference:null,law:0,count:269000,weighted:269000},
   {key:16,fx:80,e:10,t:10,metrics:{security:60,social_stability:60,elite_support:60,international_standing:60,legitimacy:60,media_climate:60,social_tension:60},anchors:{security:50,social_stability:50,elite_support:50,international_standing:50,legitimacy:50,media_climate:50},override:null,reference:null,law:10,count:269000,weighted:269000},
   {key:21,fx:65,e:-8,t:0,metrics:{social_tension:96.54},anchors:{},override:56,reference:1,law:-10,count:227000,weighted:227000},
   {key:16,fx:80,e:0,t:0,metrics:{social_tension:100},anchors:{},override:0,reference:1,law:0,count:269000,weighted:269000},
   {key:100,fx:200,e:-100,t:-100,metrics:{social_tension:100,security:0},anchors:{security:100},override:null,reference:null,law:-100,count:0,weighted:0},
   {key:0,fx:20,e:100,t:100,metrics:{legitimacy:100,media_climate:100},anchors:{legitimacy:0,media_climate:0},override:1000,reference:.2,law:100,count:400000,weighted:2000000},
   {key:16,fx:80,e:0,t:0,metrics:{},anchors:{},override:56,reference:1,law:0,count:242100,weighted:242100},
   {key:16,fx:80,e:0,t:0,metrics:{},anchors:{},override:56,reference:1,law:0,count:269000,weighted:269000}
  ];
  for(const s of scenarios){
   const aux=m.economicAuxV2(s.metrics,s.anchors),auto=m.economicAutomaticV2(s.key,s.fx,s.e,s.t,aux.activity_adjustment),activity=m.economicManualV2(auto.automatic,s.override,s.reference),collection=m.economicCollectionV2(activity,1,s.law,s.t,aux.collection_adjustment),factors=m.enterpriseFactorsV2(s.count,s.weighted,269000,activity);
   const row=(await db.query('SELECT private.economic_aux_v2($1::jsonb,$2::jsonb) aux,private.economic_automatic_v2($3,$4,$5,$6,$7) auto,private.economic_manual_v2($8,$9,$10) activity,private.economic_collection_v2($11,1,$12,$6,$13) collection,private.enterprise_factors_v2($14,$15,269000,$11) factors',[JSON.stringify(s.metrics),JSON.stringify(s.anchors),s.key,s.fx,s.e,s.t,aux.activity_adjustment,auto.automatic,s.override,s.reference,activity,s.law,aux.collection_adjustment,s.count,s.weighted])).rows[0];
   compare(row.aux,aux,'Aux');compare(row.auto,auto,'Automatic');near(row.activity,activity,'Manual');near(row.collection,collection,'Collection');compare(row.factors,factors,'Enterprises');
  }
  for(const raw of [-1,.70,.725,.95,.97,.995,1.041093,1.061093,2]){
   const value=m.boundedCollectionV2(raw,.70,.995);
   assert(value>=.70&&value<=.995);
   const row=(await db.query('SELECT private.bounded_collection_v2($1,.70,.995) value',[raw])).rows[0];
   near(row.value,value,'Smooth collection SQL/TS parity');
  }
  for(let i=-100;i<200;i++)assert(m.boundedCollectionV2((i+1)/100,.70,.995)>m.boundedCollectionV2(i/100,.70,.995),'Strict monotonicity');
  near(m.boundedCollectionV2(.95,.70,.995),.95,'Baseline unchanged');
  near(m.boundedCollectionV2(.97,.70,.995),.97,'Approved +10 legal points unchanged');
  assert(m.boundedCollectionV2(1.061093,.70,.995)>m.boundedCollectionV2(1.041093,.70,.995),'No plateau');
  near(m.economicManualV2(1,56,1),.56,'Manual base');
  near(m.enterpriseFactorsV2(242100,242100,269000,.56).activity,.504,'10% fewer enterprises at constant activity');
  near(m.economicCollectionV2(1,1,10,10,.015),.05,'Collection without enterprise count double counting');
  const region={region_code:'54',enterprises:269000,activity_multiplier:1,employees_per_firm:10,monthly_wage:50000,profit_per_firm:3,consumption_per_firm:4,expenditure:20000,transfer_in:3000,debt:4000,compliance:.95,cost_multiplier:1,profile:'industrial'};
  const context={policy:{economic_model_version:2,key_rate:16,fx_rate:80,oil_price:75,cutoff_price:60,inflation:6,baseline_economy:50,baseline_trust:50,collection_lawfulness_reference:50,tax_activity_reference:1},metrics:{economy:50,public_trust:50,lawfulness:50}};
  const state=defaultSimulatorState(context,[region]),draft=newBudgetDraft();
  const calc=(ctx,rs=[region])=>calculateFederalBudget(draft,state,ctx,rs,[],[]);
  const baseline=calc(context);
  near(baseline.revenue,40283300,'Neutral 2026 baseline');
  const manual={...context,policy:{...context.policy,activity_override:56,activity_reference:1}};
  const reduced=calc(manual,[{...region,enterprises:242100}]),normal=calc(manual);
  near(normal.business_activity,fiscalEnvironment(manual).activity,'Federal and regional macro activity');
  near(reduced.activity/normal.activity,.9,'Independent firm count');
  near(reduced.tax_collection,normal.tax_collection,'Firm count not included twice in collection');
  assert.equal(reduced.enterprise_count,242100);
  const zero=calc({...context,policy:{...context.policy,activity_override:0,activity_reference:1}});
  near(zero.activity,0,'Federal zero activity');
  assert.equal(zero.income_lines.find(x=>x.key==='turnover').amount,0);
  const zeroWithAdjustment=calculateFederalBudget({...draft,revenue_adjustments:{...draft.revenue_adjustments,turnover:123}},state,{...context,policy:{...context.policy,activity_override:0,activity_reference:1}},[region],[],[]);
  near(zeroWithAdjustment.income_lines.find(x=>x.key==='turnover').amount,123,'Zero base with direct adjustment');
  near(zeroWithAdjustment.income_details.filter(x=>x.group_key==='turnover').reduce((s,x)=>s+x.amount,0),123,'Adjustment detail reconciliation');
  assert.equal(zeroWithAdjustment.income_details.filter(x=>x.key==='adjustment:turnover').length,1);
  const legal={...context,metrics:{...context.metrics,lawfulness:60}};
  near(calc(legal).tax_collection-baseline.tax_collection,.02,'Federal law +10 points');
  const profitLine=fiscalForecast(region,[],undefined,legal).lines.find(x=>x.key==='profit');
  near(profitLine.amount/(profitLine.base*profitLine.rate*.01),.97,'Regional law +10 points');
  const stronger=calc({...context,metrics:{...context.metrics,economy:60}});
  assert(stronger.business_activity>1.10);
  for(const line of normal.income_lines)near(normal.income_details.filter(x=>x.group_key===line.key).reduce((sum,x)=>sum+x.amount,0),line.amount,'Income detail reconciliation '+line.key);
  console.log('PASS economic model v2: TS/SQL parity, manual and zero activity, separate enterprise factor, coefficient and extreme scenarios');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
