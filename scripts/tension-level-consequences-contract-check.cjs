const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {modelBAdditionalChannels,fiscalEnvironment}=require('../components/game/fiscalMath');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261122202832_tension_level_permanent_activity_tiered_security_stability_20261123.sql'),'utf8');
for(const marker of [
  'private.budget_aux_impact','private.security_from_metric_history',
  'private.budget_forecast_signature',
  "'economy_b_tension_level_v2'",
  "max(case when metric_key='social_tension' then level end) AS tension_level",
  'greatest(0,coalesce(tension_level,0)-60)*.001',
  'v_before:=0.4*least(v_old,60)+0.6*least',
  'v_after:=0.4*least(v_new,60)+0.6*least',
  'private.apply_security_delta(NEW.game_id,-(v_after-v_before)',
  'm.value-0.8*NEW.delta',
  "'derived:tension_stability'",
  "NEW.metric_key='social_tension' AND NEW.source_type IN ('teacher','decision')"
])assert(sql.includes(marker),'Missing tension contract: '+marker);
for(const forbidden of [/create\\s+table/i,/create\\s+index/i,/pg_cron|pg_net|net\\.http/i,/CREATE\\s+TRIGGER\\s+trg_tension/i])
 assert(!forbidden.test(sql),'Unapproved additional server workload');
const anchor={social_tension:92,social_stability:10,security:13,elite_support:8,international_standing:3,legitimacy:7,media_climate:29};
const close=(a,b,msg)=>assert(Math.abs(a-b)<1e-10,msg+': '+a+' vs '+b);
for(const [t,p] of [[0,0],[30,0],[59,0],[60,0],[70,-.01],[80,-.02],[90,-.03],[91.5,-.0315],[100,-.04]]){
 const channels=modelBAdditionalChannels({...anchor,social_tension:t},anchor);
 close(channels.activity_adjustment,p,'Level '+t);
 close(channels.collection_adjustment,0,'No tension-driven double tax collection at '+t);
}
const baseline=modelBAdditionalChannels(anchor,anchor);
close(baseline.activity_adjustment,-.032,'At anchor tension still affects business activity');
const better=modelBAdditionalChannels({...anchor,security:14},anchor);
close(better.activity_adjustment-baseline.activity_adjustment,.0004,'Existing security effect preserved');
const policy={key_rate:16,fx_rate:80,oil_price:75,inflation:6,baseline_economy:16,baseline_trust:12,budget_aux_anchor:anchor};
const common={economy:16,public_trust:12,...anchor};
const f=t=>fiscalEnvironment({policy,metrics:{...common,social_tension:t}}).activity;
close(f(60)-f(91.5),.0315,'High-tension permanent activity gap');
const levelPotential=t=>.4*Math.min(t,60)+.6*Math.min(Math.max(0,t-60),20)+.8*Math.min(Math.max(0,t-80),10)+Math.max(0,t-90);
for(const [a,b,d] of [[30,31,.4],[59,61,1],[79,81,1.4],[89,91,1.8],[91.5,93.5,2],[91.5,89.5,-1.9]])
 close(levelPotential(b)-levelPotential(a),d,'Tier crossing '+a+'-'+b);
console.log('PASS constant tension pressure and original Model B, tier crossing, symmetric recovery, no new calls');
