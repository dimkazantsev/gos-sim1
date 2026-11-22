// ГОС.ID. Calendar-policy contract: no cron or new browser request.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261122165621_calendar_monetary_inflation_10_day_20261122.sql'),'utf8');
const panel=fs.readFileSync(path.join(root,'components/game/FiscalMacroPanel.tsx'),'utf8');
const overview=fs.readFileSync(path.join(root,'components/game/StateMetricsDock.tsx'),'utf8');
const read=fs.readFileSync(path.join(root,'components/game/BudgetView.tsx'),'utf8');
const weights=[9,13,16,17,15,11,8,5,4,2];
assert.equal(weights.reduce((s,n)=>s+n,0),100);
assert.equal(weights.slice(0,5).reduce((s,n)=>s+n,0),70);
assert(sql.includes('ARRAY['+weights.join(',')+']')&&sql.includes('-1.5*'));
assert(sql.includes("AT TIME ZONE 'Asia/Barnaul'"));
assert(sql.includes('greatest(-1,least(1,round(v_day.raw_effect,8)))'));
assert(sql.includes("l.before_values ? 'key_rate'")&&sql.includes("l.after_values ? 'key_rate'"));
assert(sql.includes('v_p.monetary_last_settled_on>=v_today'));
assert(sql.includes('FOR UPDATE')&&sql.includes("pg_advisory_xact_lock("));
assert(sql.includes("v_details:=v_details||jsonb_build_array("));
assert(sql.includes("monetary_cumulative_effect=monetary_cumulative_effect+v_total"));
assert(sql.includes('REVOKE ALL ON FUNCTION private.settle_monetary_inflation(uuid,date)'));
for(const api of ['get_budget_pulse(uuid)','get_fiscal_context(uuid)','get_budget_simulator(uuid)','set_fiscal_policy(uuid,jsonb,text)'])
 assert(sql.includes(api),'Existing API retained: '+api);
assert(!/pg_cron|create\s+trigger\s+on\s+public\.games|create\s+subscription/iu.test(sql));
assert(panel.includes('data-monetary-calendar-explanation'));
assert(panel.includes('data-monetary-actual-effect'));
assert(overview.includes('data-bank-rate-inflation-explanation'));
assert(read.includes('onSaved={changed=>'),'No extra UI RPC on policy save');
for(const [name,source] of [['FiscalMacroPanel.tsx',panel],['StateMetricsDock.tsx',overview]]){
 const compiled=ts.transpileModule(source,{fileName:name,reportDiagnostics:true,
 compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
 assert.equal(compiled.diagnostics.length,0,'Syntax and JSX: '+name);
 assert(!/учебн/iu.test(source),'No banned copy: '+name);
}
const effect=(rateDelta,day)=>-1.5*rateDelta*weights[day-1]/100;
const cumulative=(rateDelta,day)=>weights.slice(0,day).reduce((sum,w)=>sum-1.5*rateDelta*w/100,0);
assert(Math.abs(cumulative(2,5)+2.1)<1e-10);
assert(Math.abs(cumulative(2,10)+3)<1e-10);
assert(Math.abs(cumulative(-2,10)-3)<1e-10);
assert.equal(Math.max(-1,Math.min(1,effect(20,1))),-1,'Daily net cap');
console.log('PASS: 10-day real calendar monetary effects; 70% in 5 days, 1.5x, daily caps, single confirmed settlement, no new UI requests');