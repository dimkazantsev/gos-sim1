// Isolated parity checks. No production requests or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{PGlite}=require('@electric-sql/pglite');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const m=require('../components/game/economicModelV2.ts');
const near=(actual,expected,label)=>assert(Math.abs(Number(actual)-expected)<1e-9,label+': '+actual+' vs '+expected);
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
  near(m.economicManualV2(1,56,1),.56,'Manual base');
  near(m.enterpriseFactorsV2(242100,242100,269000,.56).activity,.504,'10% fewer enterprises at constant activity');
  near(m.economicCollectionV2(1,1,10,10,.015),.05,'Collection without enterprise count double counting');
  console.log('PASS economic model v2: TS/SQL parity, manual and zero activity, separate enterprise factor, coefficient and extreme scenarios');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
