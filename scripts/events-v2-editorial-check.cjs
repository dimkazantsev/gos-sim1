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
  collective++;assert.ok(c.mandatory_boundary,c.case_key);assert.ok(!('best_option_key' in plan),c.case_key);assert.ok(o.every(x=>x.lawful===true),c.case_key);const v=o.map(x=>[x.trust,x.metric_effects?.elite_support??0,x.metric_effects?.economy??0]);assert.ok(v.every(x=>x.every(Number.isFinite)),c.case_key);assert.ok(v.every(x=>x.every(y=>Math.abs(y)<=4)),c.case_key);
  const d=v.filter((a,i)=>v.some((b,j)=>i!==j&&b.every((x,k)=>x>=a[k])&&b.some((x,k)=>x>a[k]))).length;dominated+=d;dominatedCases+=d>0;
 }
}
assert.equal(count,1660);assert.equal(individual,141);assert.equal(collective,189);
assert.ok(long/individual<=.30,'Longest answer remains too predictive');
assert.ok(short/individual<=.30,'Shortest answer remains too predictive');
assert.ok(ratio/individual>=.95&&ratio/individual<=1.05,'Mean answer length imbalance');
const reg=JSON.parse(fs.readFileSync(dir+'/source-register.json','utf8'));assert.equal(reg.cases.length,330);assert.deepEqual(reg.cases.map(c=>c.case_key).sort(),cases.map(c=>c.case_key).sort());
const blocked=cases.filter(c=>c.verified!==true||c.editorial_status!=='approved'||c.legal_review.status!=='verified_current'||c.effect_plan.options.some(o=>typeof o.lawful!=='boolean')).length;
console.log(JSON.stringify({cases:cases.length,options:count,individual,collective,longestCorrect:long,shortestCorrect:short,meanCorrectToOtherLength:ratio/individual,positions,unknownIndividualLawfulness:unknown,dominatedOptions:dominated,dominatedCases,activationBlocked:blocked,documentaryFull:reg.cases.filter(c=>c.source_status==='official_article_read_core_episode_confirmed').length,documentaryIndexed:reg.cases.filter(c=>c.source_status==='official_search_index_core_episode_confirmed_full_text_unavailable').length},null,2));
if(process.argv.includes('--release')){assert.equal(blocked,0,'Legal/editorial release gate: unverified cases must never be activated');assert.equal(dominatedCases,0,'Collective consequences require final economic balance review');}
console.log('PASS draft integrity (not legal certification or release authorization)');
