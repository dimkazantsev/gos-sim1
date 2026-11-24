/* ГОС.ID: zero-network audit of every state-indicator relationship description. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const Module=require('node:module');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'components/game/metricRelationshipCopy.ts');
const tsText=fs.readFileSync(source,'utf8');
const code=ts.transpileModule(tsText,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod=new Module(source,module);
mod.filename=source;mod.paths=module.paths;mod._compile(code,source);
const actual=mod.exports.METRIC_RELATIONSHIPS;
const expected=['public_trust','legitimacy','elite_support','social_stability','social_tension','media_climate','international_standing','lawfulness','economy','security','budget'];
assert.deepEqual(Object.keys(actual).sort(),expected.sort(),'Explain every existing index exactly once, without added or stale keys');
for(const [key,item] of Object.entries(actual)){
 for(const field of ['meaning','incoming','outgoing','note']){
  assert.equal(typeof item[field],'string',key+' missing '+field);
  assert(item[field].length>=45,key+' has insufficient text in '+field);
 }
}
const component=fs.readFileSync(path.join(root,'components/game/MetricRelationships.tsx'),'utf8');
const dock=fs.readFileSync(path.join(root,'components/game/StateMetricsDock.tsx'),'utf8');
const teacher=fs.readFileSync(path.join(root,'components/game/TeacherMetricStudio.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'app/design-readability.css'),'utf8');
assert(component.includes('metricRelationsGrid')&&component.includes('compact=false'),'Shared explanation component not installed');
assert(!/supabase|fetch\(|setInterval\(|setTimeout\(|\.rpc\(/.test(component),'Explanations must not trigger network or polling');
assert(dock.includes('<MetricRelationships metricKey={chosen.metric_key}/>'),'Metric detail missing explanations');
assert(teacher.includes('<MetricRelationships metricKey={metric?.metric_key||""} compact/>'),'Teacher editor missing explanations');
assert(css.includes('.metricRelationsGrid')&&css.includes('@media(max-width:650px)'), 'Missing branded, narrow-screen layout');
assert(actual.lawfulness.outgoing.includes('ниже 40%')&&actual.lawfulness.outgoing.includes('ниже 30%')&&actual.lawfulness.outgoing.includes('2/3 голосов от общего числа депутатов')&&/Федеральный конституционный закон одной Думой преодолеть нельзя/.test(actual.lawfulness.outgoing),'Legal thresholds must be explained');
assert(actual.social_tension.meaning.includes('снижение'),'Inverse social-tension direction missing');
assert(actual.budget.meaning.includes('не процентный индекс'),'Budget units must not be confused with percentages');
console.log('PASS: 11/11 indices covered; two surfaces; no requests; 40/30 legal thresholds; responsive branded layout.');
