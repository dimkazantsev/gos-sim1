'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const dir='content/events-v2-editorial';
const files=fs.readdirSync(dir).filter(p=>/^(collective-|individual-).*\.json$/.test(p));
const cases=files.flatMap(p=>JSON.parse(fs.readFileSync(dir+'/'+p,'utf8')).cases);
assert.equal(cases.length,330);assert.equal(new Set(cases.map(c=>c.case_key)).size,330);
let count=0,individual=0,collective=0,long=0,short=0,unknown=0,dominated=0,dominatedCases=0,ratio=0;const positions={};
// Match the inactive V2 collective server contract. Never treat editorial review as release permission.
const collectiveMetricKeys=new Set(['economy','elite_support','international_standing','media_climate','security','social_stability','social_tension']);
function checkCollectiveEffectContract(option,caseKey){
 const metrics=option.metric_effects===undefined?{}:option.metric_effects;
 const label=caseKey+' '+option.key;
 assert.ok(metrics!==null&&typeof metrics==='object'&&!Array.isArray(metrics),label+' invalid metric_effects');
 for(const [key,value] of Object.entries(metrics)){
  assert.ok(collectiveMetricKeys.has(key),label+' prohibited direct metric '+key);
  assert.ok(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=4,label+' invalid direct metric '+key);
 }
 if(Object.hasOwn(option,'fiscal_effect')){
  assert.ok(option.fiscal_effect!==null&&typeof option.fiscal_effect==='object'&&!Array.isArray(option.fiscal_effect),label+' invalid fiscal_effect');
  assert.ok(!Object.hasOwn(metrics,'economy'),label+' duplicate economy and fiscal_effect');
 }
}
// Local negative fixtures, without changing the catalogue or touching the database.
for(const [key,metrics] of [['lawfulness',{lawfulness:0}],['budget',{budget:1}],['legitimacy',{legitimacy:1}],['public_trust',{public_trust:1}],['range',{economy:5}],['type',{economy:'1'}],['array',[]],['null',null]]){
 assert.throws(()=>checkCollectiveEffectContract({key,metric_effects:metrics},'fixture'));
}
assert.throws(()=>checkCollectiveEffectContract({key:'duplicate',metric_effects:{economy:0},fiscal_effect:{}},'fixture'));
assert.throws(()=>checkCollectiveEffectContract({key:'invalid_fiscal',fiscal_effect:null},'fixture'));
assert.doesNotThrow(()=>checkCollectiveEffectContract({key:'valid',metric_effects:{economy:-1,elite_support:2}},'fixture'));
assert.doesNotThrow(()=>checkCollectiveEffectContract({key:'valid_fiscal',metric_effects:{elite_support:1},fiscal_effect:{}},'fixture'));

for(const c of cases){
 const plan=c.effect_plan,o=plan.options,labels=c.decision_options;
 assert.equal(plan.rules_version,2,c.case_key);assert.equal(o.length,labels.length,c.case_key);assert.equal(o.length,c.original_option_count,c.case_key);assert.equal(new Set(labels).size,labels.length,c.case_key);assert.ok(labels.every(x=>typeof x==='string'&&x.trim()),c.case_key);
 assert.ok(c.legal_review.basis,c.case_key);assert.ok(c.editorial_status==='draft'||c.editorial_status==='approved',c.case_key);
 o.forEach((x,i)=>assert.equal(x.key,'option_'+(i+1),c.case_key));count+=o.length;
 if(c.audience==='single'){
  individual++;const i=Number(plan.best_option_key.split('_')[1])-1;assert.ok(i>=0&&i<o.length,c.case_key);assert.equal(o[i].lawful,true,c.case_key);unknown+=o.filter(x=>x.lawful===null).length;
  const l=labels.map(x=>x.length);long+=l[i]===Math.max(...l);short+=l[i]===Math.min(...l);ratio+=l[i]/((l.reduce((a,b)=>a+b,0)-l[i])/(l.length-1));positions[i+1]=(positions[i+1]||0)+1;
 }else{
  collective++;assert.ok(c.mandatory_boundary,c.case_key);assert.ok(!('best_option_key' in plan),c.case_key);assert.ok(o.every(x=>x.lawful===true),c.case_key);o.forEach(x=>checkCollectiveEffectContract(x,c.case_key));const metricKeys=[...new Set(o.flatMap(x=>Object.keys(x.metric_effects??{})))].sort(); const v=o.map(x=>[x.trust,...metricKeys.map(k=>(k==='social_tension'?-1:1)*(x.metric_effects?.[k]??0))]);assert.ok(v.every(x=>x.every(Number.isFinite)),c.case_key);assert.ok(v.every(x=>x.every(y=>Math.abs(y)<=4)),c.case_key);
  const d=v.filter((a,i)=>v.some((b,j)=>i!==j&&b.every((x,k)=>x>=a[k])&&b.some((x,k)=>x>a[k]))).length;dominated+=d;dominatedCases+=d>0;
 }
}
const reviewed=cases.filter(c=>c.legal_review.option_analysis);assert.equal(reviewed.length,141);for(const c of reviewed){const a=c.legal_review.option_analysis;assert.equal(a.length,c.decision_options.length);assert.equal(a.filter(x=>x.classification==='best').length,1);for(const [i,x] of a.entries()){assert.equal(x.key,c.effect_plan.options[i].key);assert.ok(x.reason);assert.equal(x.lawfulness_proposal,c.effect_plan.options[i].lawful);}}
const financial=cases.filter(c=>c.financial_review);assert.equal(financial.length,30);for(const c of financial){const f=c.financial_review;assert.equal(f.automatic_budget_delta,0);assert.equal(f.automatic_enterprise_delta,0);assert.ok(f.note);if(f.kind==='pending_transfer')assert.equal(f.amount_mln,f.requested_federal_mln+f.regional_cofinance_mln,c.case_key);}
const calibrated=cases.filter(c=>c.balance_review);assert.equal(calibrated.length,30);for(const c of calibrated){assert.ok(c.effect_plan.options.every(o=>o.calibration_reason&&Number.isFinite(o.metric_effects[c.balance_review.additional_dimension])));}
console.log(JSON.stringify({reviewedIndividualCases:reviewed.length,reviewedIndividualOptions:reviewed.reduce((n,c)=>n+c.decision_options.length,0),financialCases:financial.length,checkedCofinancing:financial.filter(c=>c.financial_review.kind==='pending_transfer').length,calibratedCases:calibrated.length,calibratedOptions:calibrated.reduce((n,c)=>n+c.decision_options.length,0)},null,2));
const collectiveReviews=cases.filter(c=>c.implementation_review);assert.equal(collectiveReviews.length,189);let extendedDominated=0;for(const c of collectiveReviews){const os=c.effect_plan.options,keys=[...new Set(os.flatMap(o=>Object.keys(o.metric_effects??{})))];const v=os.map((o,i)=>{const p=o.implementation_review;assert.equal(p.action,c.decision_options[i]);assert.ok([0,1,2,3].includes(p.additional_resource_level));assert.ok([0,1,2,3].includes(p.result_time_level));assert.equal(p.financial_posting,'none_until_authorized_and_confirmed');assert.ok(p.cost_basis&&p.time_basis);return [o.trust,...keys.map(k=>(k==='social_tension'?-1:1)*(o.metric_effects[k]??0)),-p.additional_resource_level,-p.result_time_level];});extendedDominated+=v.filter((a,i)=>v.some((b,j)=>i!==j&&b.every((x,k)=>x>=a[k])&&b.some((x,k)=>x>a[k]))).length;}console.log(JSON.stringify({implementationReviewedCases:collectiveReviews.length,implementationReviewedOptions:collectiveReviews.reduce((n,c)=>n+c.decision_options.length,0),extendedDominated},null,2));
assert.equal(count,1660);assert.equal(individual,141);assert.equal(collective,189);
assert.ok(long/individual<=.30,'Longest answer remains too predictive');
assert.ok(short/individual<=.30,'Shortest answer remains too predictive');
assert.ok(ratio/individual>=.95&&ratio/individual<=1.05,'Mean answer length imbalance');
const reg=JSON.parse(fs.readFileSync(dir+'/source-register.json','utf8'));assert.equal(reg.cases.length,330);assert.deepEqual(reg.cases.map(c=>c.case_key).sort(),cases.map(c=>c.case_key).sort());
// The register has two historical names for the number of explicitly reviewed alternatives.
// Accept both without rewriting older evidence; the review itself is still not legal certification.
const registerByKey=new Map(reg.cases.map(c=>[c.case_key,c]));
// Keep dated, case-specific evidence in both the catalogue and the source register.
const acceptedRecheckStatuses=new Set(['targeted_norm_and_all_individual_alternatives_reviewed_not_full_acceptance','targeted_norm_and_individual_alternatives_reviewed_not_full_acceptance']);
let individualRecheckCount=0;
for(const c of cases.filter(c=>c.audience==='single')){
 const evidence=c.legal_review.norm_recheck_2026_11_28;
 assert.ok(evidence&&acceptedRecheckStatuses.has(evidence.status),c.case_key+' individual recheck missing');
 assert.ok(typeof evidence.limitation==='string'&&evidence.limitation.trim(),c.case_key+' missing limitations');
 assert.ok(Array.isArray(evidence.urls)&&evidence.urls.length>0,c.case_key+' missing checked norm source');
 assert.deepEqual(registerByKey.get(c.case_key)?.norm_recheck_2026_11_28,evidence,c.case_key+' individual source evidence mismatch');
 individualRecheckCount++;
}
assert.equal(individualRecheckCount,141);
console.log(JSON.stringify({individualRecheckCount},null,2));

 // A single current proposal is authoritative for editorial routing, never for authorization.
 const competenceMatrix=JSON.parse(fs.readFileSync('docs/EVENTS_V2_COMPETENCE_APPROVAL_CANDIDATE_2026-11-28.json','utf8'));
 const competenceByKey=new Map(competenceMatrix.cases.map(c=>[c.case_key,c]));
 assert.equal(competenceMatrix.cases.length,141,'Competence matrix coverage');
 assert.equal(competenceByKey.size,141,'Duplicate competence matrix key');
 function checkCompetenceProposal(c,m){
  assert.ok(m,c.case_key+' missing competence proposal');
  assert.equal(m.title,c.title,c.case_key+' competence title mismatch');
  assert.equal(m.best_option,c.effect_plan.best_option_key,c.case_key+' competence best option mismatch');
  const p=c.legal_review.competence_review?.game_portfolio_candidate;
  assert.ok(p,c.case_key+' missing catalogue competence proposal');
  assert.equal(p.office_key,m.primary.office_key,c.case_key+' stale portfolio key');
  assert.equal(p.office_title,m.primary.office_title,c.case_key+' stale portfolio title');
  assert.ok(['owner_approved_editorial_pending_legal_and_runtime','owner_approved_educational_candidate_runtime_reviewed'].includes(competenceMatrix.status));
  assert.equal(m.owner_approved,true,c.case_key);
  assert.equal(p.owner_approved,true,c.case_key);
  assert.equal(p.status,'owner_approved_editorial_not_authorization',c.case_key);
  assert.deepEqual(p.secondary_profiles,m.secondary??[],c.case_key);
  if(c.verified!==true)assert.equal(m.activation_allowed,false,c.case_key);
 }
 for(const c of cases.filter(c=>c.audience==='single'))checkCompetenceProposal(c,competenceByKey.get(c.case_key));
 if(process.argv.includes('--release')){
  assert.notEqual(competenceMatrix.status,'owner_decision_candidate_not_for_import','Competence proposal still awaits owner approval');
  assert.ok(competenceMatrix.cases.every(c=>c.activation_allowed===true&&c.runtime_review?.status==='verified_current'),'Competence route activation not approved');
 }


 // Check approved effects against the immutable proposals and the exact seven corrections.
 const scopeProposal=JSON.parse(fs.readFileSync('docs/EVENTS_V2_SCOPE_CALIBRATION_PROPOSAL_2026-11-27.json','utf8'));
 const balanceProposal=JSON.parse(fs.readFileSync('docs/EVENTS_V2_DIRECT_BALANCE_PROPOSAL_2026-11-28.json','utf8'));
 const scopeByKey=new Map(scopeProposal.candidate_cases.map(c=>[c.case_key,c]));
 const balanceByKey=new Map(balanceProposal.cases.map(c=>[c.case_key,c]));
 assert.equal(scopeByKey.size,189);assert.equal(balanceByKey.size,6);
 const remainingByKey=new Map();
 for(const letter of ['A','B','C','D','E']){
  const pack=JSON.parse(fs.readFileSync('docs/EVENTS_V2_REMAINING_BALANCE_PROPOSAL_'+letter+'_2026-11-28.json','utf8'));
  for(const c of pack.cases){assert.ok(!remainingByKey.has(c.case_key),c.case_key+' duplicate approved case');remainingByKey.set(c.case_key,c.changes);}
 }
 assert.equal(remainingByKey.size,90);
 let verifiedRemainingCorrections=0,addedRemainingFields=0;
 let verifiedApprovedCorrections=0,verifiedScaledOptions=0,scope89=0,scope16=0;
 for(const c of cases.filter(c=>c.audience!=='single')){
  const p=scopeByKey.get(c.case_key),b=balanceByKey.get(c.case_key),d=p.scope.denominator;
  assert.ok(d===89||d===16,c.case_key);if(d===89)scope89++;else scope16++;
  assert.equal(c.approved_effect_scaling.denominator,d,c.case_key);
  assert.equal(c.approved_effect_scaling.pre_scale_abs_limit,4,c.case_key);
  assert.equal(c.approved_effect_scaling.decimal_places,6,c.case_key);
  assert.equal(c.approved_effect_scaling.approved_correction_count,b?.changes.length??0,c.case_key);
  for(const o of c.effect_plan.options){
   const src=p.options.find(x=>x.key===o.key).original;
   const raw={trust:src.trust,metric_effects:{...src.metric_effects}};
   for(const ch of b?.changes.filter(x=>x.option===o.key)??[]){
    assert.equal(c.decision_options[Number(o.key.slice(7))-1],ch.label,c.case_key);
    if(ch.metric==='trust'){assert.equal(raw.trust,ch.before,c.case_key);raw.trust=ch.after;}
    else{assert.equal(raw.metric_effects[ch.metric],ch.before,c.case_key);raw.metric_effects[ch.metric]=ch.after;}
    verifiedApprovedCorrections++;
   }
   for(const ch of (remainingByKey.get(c.case_key)??[]).filter(x=>x.option===o.key)){
    assert.equal(c.decision_options[Number(o.key.slice(7))-1],ch.label,c.case_key);
    const before=ch.metric==='trust'?raw.trust:raw.metric_effects[ch.metric];
    assert.equal(before??0,ch.raw_before,c.case_key+' remaining raw before');
    assert.equal(Number((ch.raw_before/d).toFixed(6)),ch.scaled_before,c.case_key);
    assert.equal(Number((ch.raw_after/d).toFixed(6)),ch.scaled_after,c.case_key);
    if(ch.metric==='trust')raw.trust=ch.raw_after;
    else{if(!Object.hasOwn(raw.metric_effects,ch.metric))addedRemainingFields++;raw.metric_effects[ch.metric]=ch.raw_after;}
    verifiedRemainingCorrections++;
   }
   assert.ok([raw.trust,...Object.values(raw.metric_effects)].every(x=>Number.isFinite(x)&&Math.abs(x)<=4),c.case_key);
   const scaled=x=>Number((x/d).toFixed(6));
   assert.equal(o.trust,scaled(raw.trust),c.case_key+' trust');
   assert.deepEqual(o.metric_effects,Object.fromEntries(Object.entries(raw.metric_effects).map(([k,v])=>[k,scaled(v)])),c.case_key+' effects');
   verifiedScaledOptions++;
  }
 }
 assert.equal(verifiedApprovedCorrections,7);assert.equal(verifiedScaledOptions,947);
 assert.equal(verifiedRemainingCorrections,125);assert.equal(addedRemainingFields,14);
 assert.equal(dominated,0,'Approved collective direct dominance');
 assert.equal(scope89,179);assert.equal(scope16,10);
 console.log(JSON.stringify({verifiedApprovedCorrections,verifiedRemainingCorrections,addedRemainingFields,verifiedScaledOptions,scope89,scope16},null,2));

let collectiveReviewCount=0,collectiveReviewOptions=0;
for(const c of cases){
 const review=c.legal_review.collective_option_analysis;
 if(!review)continue;
 assert.ok(c.audience!=='single',c.case_key);
 const source=registerByKey.get(c.case_key)?.targeted_option_review;
 assert.ok(source,c.case_key+' missing targeted source review');
 assert.equal(source.option_count??source.options,c.effect_plan.options.length,c.case_key);
 assert.equal(review.options.length,c.effect_plan.options.length,c.case_key);
 assert.ok(review.options.every((o,i)=>o.key===c.effect_plan.options[i].key&&typeof o.reason==='string'&&o.reason.trim()),c.case_key);
 assert.ok(review.urls.length>0,c.case_key+' missing norm source');
 collectiveReviewCount++;collectiveReviewOptions+=review.options.length;
}
console.log(JSON.stringify({collectiveReviewCount,collectiveReviewOptions},null,2));
// All collective alternatives must have explicit case-specific analysis before this editorial gate passes.
assert.equal(collectiveReviewCount,189,'Collective case review incomplete');
assert.equal(collectiveReviewOptions,947,'Collective option review incomplete');

const blocked=cases.filter(c=>c.verified!==true||c.editorial_status!=='approved'||c.legal_review.status!=='verified_current'||c.effect_plan.options.some(o=>typeof o.lawful!=='boolean')).length;
console.log(JSON.stringify({cases:cases.length,options:count,individual,collective,longestCorrect:long,shortestCorrect:short,meanCorrectToOtherLength:ratio/individual,positions,unknownIndividualLawfulness:unknown,dominatedOptions:dominated,dominatedCases,activationBlocked:blocked,documentaryFull:reg.cases.filter(c=>c.source_status==='official_article_read_core_episode_confirmed').length,documentaryIndexed:reg.cases.filter(c=>c.source_status==='official_search_index_core_episode_confirmed_full_text_unavailable').length},null,2));
// Preserve dated source-specific evidence without confusing it with legal acceptance.
assert.ok(reg.cases.every(c=>Array.isArray(c.checked_norm_urls)&&c.checked_norm_urls.length>0),'Source register missing checked norm URL');
let legalFollowupCount=0;
for(const c of cases){
 const followup=c.legal_review.legal_followup_2026_11_28;
 if(!followup)continue;
 const r=registerByKey.get(c.case_key);
 assert.deepEqual(followup,r.legal_followup_2026_11_28,c.case_key+' follow-up mismatch');
 // Historical evidence remains identical in both records; final review may add sources.
 assert.ok(followup.urls.every(url=>r.checked_norm_urls.includes(url)),c.case_key+' historical source missing from register');
 assert.ok(followup.urls.every(url=>c.legal_review.checked_norm_urls.includes(url)),c.case_key+' historical source missing from catalogue');
 assert.equal(followup.option_count,c.effect_plan.options.length,c.case_key);
 assert.equal(followup.status,'article_text_rechecked_specific_conditions_not_full_acceptance',c.case_key);
 legalFollowupCount++;
}
assert.equal(legalFollowupCount,10);
console.log(JSON.stringify({legalFollowupCount,registerCheckedNormCoverage:reg.cases.length},null,2));
// Educational review is not permission to activate or independent legal certification.
const finalStatus='case_specific_legal_acceptance_under_explicit_educational_facts';
function checkFinalReview(c,r){
 assert.equal(c.legal_review.status,r.legal_status,c.case_key+' legal status mismatch');
 if(r.legal_status!=='verified_current'){
  assert.equal(r.activation_allowed,false,c.case_key+' unreviewed case activation');
  return false;
 }
 const f=c.legal_review.final_case_review_2026_11_28;
 assert.ok(f&&(f.status??f.scope)===finalStatus,c.case_key+' missing final evidence');
 assert.deepEqual(f,r.final_case_review_2026_11_28,c.case_key+' final evidence mismatch');
 assert.equal(f.option_count,c.effect_plan.options.length,c.case_key+' final option count');
 assert.ok(typeof f.date==='string'&&f.date.trim()&&typeof f.remaining==='string'&&f.remaining.trim()&&typeof (f.finding??f.conclusion)==='string'&&(f.finding??f.conclusion).trim(),c.case_key+' incomplete final evidence');
 assert.ok(Array.isArray(f.urls)&&f.urls.length>0&&f.urls.every(u=>typeof u==='string'&&(u.startsWith('https://')||u.startsWith('http://'))),c.case_key+' final source URLs missing');
 assert.deepEqual(f.urls,r.checked_norm_urls,c.case_key+' final register source mismatch');
 assert.deepEqual(f.urls,c.legal_review.checked_norm_urls,c.case_key+' final catalogue source mismatch');
 return true;
}
let finalReviewCount=0,finalReviewOptions=0;
for(const c of cases){
 if(checkFinalReview(c,registerByKey.get(c.case_key))){
  finalReviewCount++;finalReviewOptions+=c.effect_plan.options.length;
 }
}
assert.equal(finalReviewCount,330,'Final educational review incomplete');
assert.equal(finalReviewOptions,1660,'Final alternative review incomplete');
console.log(JSON.stringify({finalReviewCount,finalReviewOptions},null,2));
const registerBlocked=reg.cases.filter(c=>c.activation_allowed!==true||c.legal_status!=='verified_current').length;
for(const c of cases){
 const source=registerByKey.get(c.case_key);
 assert.equal(source.source_url??null,c.source_url??null,c.case_key+' documentary source mismatch');
 assert.equal(source.audience,c.audience,c.case_key+' audience mismatch');
}
console.log(JSON.stringify({registerActivationBlocked:registerBlocked},null,2));
if(process.argv.includes('--release')){
 assert.equal(blocked,0,'Legal/editorial release gate: unverified cases must never be activated');
 assert.equal(registerBlocked,0,'Source register release gate: documented educational legal acceptance and activation permission required');
 assert.equal(dominatedCases,0,'Collective consequences require final economic balance review');
}
console.log(process.argv.includes('--release')?'PASS educational candidate release gates (not deployment or independent legal certification)':'PASS catalogue integrity (not deployment or independent legal certification)');
