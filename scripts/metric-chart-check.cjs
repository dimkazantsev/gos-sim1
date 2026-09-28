/* Event-sourced chart regression checks. No database or browser required. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const Module=require('node:module');
const file='components/game/metricChart.ts';
const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const mod=new Module(file,module);
mod.filename=file;
mod.paths=module.paths;
mod._compile(compiled,file);
const {pointsForMetric,drawMetricChart,metricDomain}=mod.exports;
const metric=(key,value,unit='%',min=0,max=100)=>({
 id:key,metric_key:key,label:key,value,unit,min_value:min,max_value:max
});
const row=(key,at,value,previous,id,source_type='decision')=>({
 id,metric_key:key,recorded_at:at,value,previous_value:previous,
 source_type,note:'Событие '+id
});
const start='2026-09-01T08:00:00Z';
const m=metric('public_trust',58);
const rows=[
 row('public_trust','2026-09-03T10:00:00Z',58,54,3),
 row('public_trust','2026-09-01T08:00:00Z',50,null,1,'baseline'),
 row('public_trust','2026-09-02T10:00:00Z',54,50,2),
];
const points=pointsForMetric(m,rows,'changes',start);
assert.deepEqual(points.map(p=>p.value),[50,54,58]);
assert.deepEqual(points.map(p=>p.kind),['baseline','change','change']);
assert.deepEqual(points.map(p=>p.at),[Date.parse(start),Date.parse('2026-09-02T10:00:00Z'),Date.parse('2026-09-03T10:00:00Z')]);
console.log('PASS actual event dates and baseline are preserved');
const noHistory=pointsForMetric(metric('economy',54),[],'changes',start,Date.parse('2026-09-04T13:00:00Z'));
assert.equal(noHistory.length,1);
assert.equal(noHistory[0].kind,'snapshot');
assert.equal(noHistory[0].value,54);
const singleChart=drawMetricChart([{metric:metric('economy',54),color:'#4169C9',points:noHistory}]);
assert.equal(singleChart.lines[0].pointsOnChart.length,1);
assert(Number.isFinite(singleChart.lines[0].pointsOnChart[0].x));
assert.equal(singleChart.xTicks.length,1);
console.log('PASS single-point chart is drawable without invented history');
const reconstructed=pointsForMetric(metric('lawfulness',70),[
 row('lawfulness','2026-09-03T10:00:00Z',70,65,9)
],'changes',start);
assert.equal(reconstructed[0].value,65);
assert.equal(reconstructed[0].at,Date.parse(start));
console.log('PASS first event previous_value supplies the real reconstructed baseline');
const duplicate=pointsForMetric(metric('public_trust',55),[
 row('public_trust',start,50,null,1,'baseline'),
 row('public_trust','2026-09-02T10:00:00Z',53,50,2),
 row('public_trust','2026-09-02T12:00:00Z',55,53,3),
],'day',start);
assert.deepEqual(duplicate.map(p=>p.value),[50,55]);
console.log('PASS day grouping retains end-of-day values');
const budget=metric('budget',742,' млн',null,null);
const budgetPoints=pointsForMetric(budget,[
 row('budget',start,700,null,1,'baseline'),
 row('budget','2026-09-03T10:00:00Z',742,700,2),
]);
const domain=metricDomain(budget,budgetPoints,true);
assert(domain[0]<700&&domain[1]>742);
const chart=drawMetricChart([
 {metric:m,color:'#4169C9',points},
 {metric:budget,color:'#C26496',points:budgetPoints},
]);
assert.equal(chart.lines.length,2);
assert(chart.lines.every(line=>line.pointsOnChart.every(p=>p.y>=chart.top&&p.y<=chart.height-chart.bottom)));
assert.equal(chart.comparing,true);
console.log('PASS mixed units are normalized independently and event times remain aligned');
