'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const dir='content/events-v2-editorial';
const files=fs.readdirSync(dir).filter(p=>/^(collective-|individual-).*\.json$/.test(p));
const cases=files.flatMap(p=>JSON.parse(fs.readFileSync(dir+'/'+p,'utf8')).cases);
assert.equal(cases.length,330);assert.equal(new Set(cases.map(c=>c.case_key)).size,330);
let count=0,individual=0,collective=0,long=0,short=0,unknown=0,dominated=0,dominatedCases=0,ratio=0;const positions={};
for(const c of cases){
 const plan=c.effect_plan,o=plan.options,labels=c.decision_options;
 assert.equal(plan.rules_version,2,c.case_key);assert.equal(o.length,labels.length,c.case_key);assert.equal(o.length,c.original_option_count,c.case_key);assert.equal(new Set(labels).size,labels.length,c.case_key);assert.ok(labels.every(x=>typeof x==='string'&&x.trim()),c.case_key);
 assert.ok(c.legal_review.basis,c.case_key);assert.ok(c.editorial_status==='draft'||c.editorial_status==='approved',c.case_key);
 o.forEach((x,i)=>assert.equal(x.key,'option_'+(i+1),c.case_key));count+=o.length;
 if(c.audience==='single'){
  individual++;const i=Number(plan.best_option_key.split('_')[1])-1;assert.ok(i>=0&&i<o.length,c.case_key);assert.equal(o[i].lawful,true,c.case_key);unknown+=o.filter(x=>x.lawful===null).length;
  const l=labels.map(x=>x.length);long+=l[i]===Math.max(...l);short+=l[i]===Math.min(...l);ratio+=l[i]/((l.reduce((a,b)=>a+b,0)-l[i])/(l.length-1));positions[i+1]=(positions[i+1]||0)+1;
 }else{
  collective++;assert.ok(c.mandatory_boundary,c.case_key);assert.ok(!('best_option_key' in plan),c.case_key);assert.ok(o.every(x=>x.lawful===true),c.case_key);const metricKeys=[...new Set(o.flatMap(x=>Object.keys(x.metric_effects??{})))].sort(); const v=o.map(x=>[x.trust,...metricKeys.map(k=>(k==='social_tension'?-1:1)*(x.metric_effects?.[k]??0))]);assert.ok(v.every(x=>x.every(Number.isFinite)),c.case_key);assert.ok(v.every(x=>x.every(y=>Math.abs(y)<=4)),c.case_key);
  const d=v.filter((a,i)=>v.some((b,j)=>i!==j&&b.every((x,k)=>x>=a[k])&&b.some((x,k)=>x>a[k]))).length;dominated+=d;dominatedCases+=d>0;
 }
}
const reviewed=cases.filter(c=>c.legal_review.option_analysis);assert.equal(reviewed.length,20);for(const c of reviewed){const a=c.legal_review.option_analysis;assert.equal(a.length,c.decision_options.length);assert.equal(a.filter(x=>x.classification==='best').length,1);for(const [i,x] of a.entries()){assert.equal(x.key,c.effect_plan.options[i].key);assert.ok(x.reason);assert.equal(x.lawfulness_proposal,c.effect_plan.options[i].lawful);}}
const financial=cases.filter(c=>c.financial_review);assert.equal(financial.length,30);for(const c of financial){const f=c.financial_review;assert.equal(f.automatic_budget_delta,0);assert.equal(f.automatic_enterprise_delta,0);assert.ok(f.note);if(f.kind==='pending_transfer')assert.equal(f.amount_mln,f.requested_federal_mln+f.regional_cofinance_mln,c.case_key);}
const calibrated=cases.filter(c=>c.balance_review);assert.equal(calibrated.length,10);for(const c of calibrated){assert.ok(c.effect_plan.options.every(o=>o.calibration_reason&&Number.isFinite(o.metric_effects[c.balance_review.additional_dimension])));}
console.log(JSON.stringify({reviewedIndividualCases:reviewed.length,reviewedIndividualOptions:reviewed.reduce((n,c)=>n+c.decision_options.length,0),financialCases:financial.length,checkedCofinancing:financial.filter(c=>c.financial_review.kind==='pending_transfer').length,calibratedCases:calibrated.length,calibratedOptions:calibrated.reduce((n,c)=>n+c.decision_options.length,0)},null,2));
assert.equal(count,1660);assert.equal(individual,141);assert.equal(collective,189);
assert.ok(long/individual<=.30,'Longest answer remains too predictive');
assert.ok(short/individual<=.30,'Shortest answer remains too predictive');
assert.ok(ratio/individual>=.95&&ratio/individual<=1.05,'Mean answer length imbalance');
const reg=JSON.parse(fs.readFileSync(dir+'/source-register.json','utf8'));assert.equal(reg.cases.length,330);assert.deepEqual(reg.cases.map(c=>c.case_key).sort(),cases.map(c=>c.case_key).sort());
const blocked=cases.filter(c=>c.verified!==true||c.editorial_status!=='approved'||c.legal_review.status!=='verified_current'||c.effect_plan.options.some(o=>typeof o.lawful!=='boolean')).length;
console.log(JSON.stringify({cases:cases.length,options:count,individual,collective,longestCorrect:long,shortestCorrect:short,meanCorrectToOtherLength:ratio/individual,positions,unknownIndividualLawfulness:unknown,dominatedOptions:dominated,dominatedCases,activationBlocked:blocked,documentaryFull:reg.cases.filter(c=>c.source_status==='official_article_read_core_episode_confirmed').length,documentaryIndexed:reg.cases.filter(c=>c.source_status==='official_search_index_core_episode_confirmed_full_text_unavailable').length},null,2));
if(process.argv.includes('--release')){assert.equal(blocked,0,'Legal/editorial release gate: unverified cases must never be activated');assert.equal(dominatedCases,0,'Collective consequences require final economic balance review');}
console.log('PASS draft integrity (not legal certification or release authorization)');
