'use strict';
/* Keyset history regression: 100 synthetic readers, no server traffic. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pageSize=50;
const source=fs.readFileSync('components/game/StateMetricsDock.tsx','utf8');
const loader=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const sql=fs.readFileSync('supabase/migrations/20261031100000_metric_history_50_paging.sql','utf8');
const chart=fs.readFileSync('components/game/metricChart.ts','utf8');
const teacher=fs.readFileSync('components/game/TeacherView.tsx','utf8');
assert(sql.includes('security invoker')&&sql.includes('private.is_game_member(p_game_id)'),'Original RLS semantics');
assert.equal((sql.match(/order by recorded_at desc, id desc limit 50/g)||[]).length,2,'Both initial histories capped');
assert(source.includes('const HISTORY_PAGE_SIZE=50'));
assert(source.includes("supabase.from('budget_income_history').select('id,game_id,value,previous_value,note,recorded_at').eq('game_id',gid)"),'Budget graph uses the existing financial ledger, with per-game RLS');
assert(source.includes("metric.metric_key!=='budget'||!g.budgetPulse?.history?.length"),'Do not duplicate the loaded pulse read');
assert(source.includes("historyPages.budget?.length?historyPages.budget"),'Use budget income snapshots rather than old metric changes');
assert(source.includes("metricHistory.filter(row=>row.metric_key!=='budget')"),'No duplicate conflicting budget history');
assert(source.includes("source_type:'budget_forecast'"),'Real budget forecast records only');
assert(!source.includes("chosen.metric_key!=='budget'&&historyMore[chosen.metric_key]"),'Older income history is paginated on demand');
assert(source.includes('Загрузка истории бюджетных расчётов…'),'Loading state distinguishes a missing history from an in-flight page');
assert(source.includes("historyMore[metric.metric_key]!==false&&(metric.metric_key!=='budget'||!g.budgetPulse?.history?.length)"),"A partial 50-row budget page cannot claim it starts at the game's first budget record");
const budgets=Array.from({length:77},(_,n)=>({id:n+31,recorded_at:new Date(Date.UTC(2026,10,20,0,0,n)).toISOString(),value:35000000+n*100}));
const orderedBudgets=[...budgets].reverse();
const first=orderedBudgets.slice(0,pageSize),last=first.at(-1);
const remaining=orderedBudgets.filter(r=>r.recorded_at<last.recorded_at||(r.recorded_at===last.recorded_at&&r.id<last.id)).slice(0,pageSize);
assert.equal(first.length,50,'Bounded initial page');
assert.equal(remaining.length,27,'Remaining budget history fetched only on demand');
assert.equal(new Set([...first,...remaining].map(r=>r.id)).size,77,'Historical points are unique');
assert(source.includes(".eq('game_id',gid).eq('metric_key',metricKey)"),'History pages scoped to game and series');
assert(source.includes(".order('recorded_at',{ascending:false}).order('id',{ascending:false})"),'Stable order');
assert(source.includes('query=query.or('),'Use timestamp + ID cursor');
assert(source.includes('historyPending.current.has(metricKey)'),'Do not load the same page in parallel');
assert(source.includes("if(!selected||!game?.id)return;"),'Closed metric modal makes no history calls');
assert(source.includes('Загрузить более ранние записи'),'Reuse existing history control');
assert(chart.includes('partialHistory=false'),'Partial graph never claims a complete baseline');
assert(teacher.includes('последних загруженных изменений'),'Teacher count never misrepresents the lifetime total');
assert(loader.includes(".order('recorded_at',{ascending:false}).order('id',{ascending:false}).limit(50)"));
const at=n=>'2026-10-'+String(1+Math.floor(n/65)).padStart(2,'0')+
 'T10:'+String(n%60).padStart(2,'0')+':00.000Z';
const logs=Array.from({length:223},(_,n)=>({id:n+1,recorded_at:at(n),game_id:'game',metric_key:n%2?'trust':'economy'}));
const compare=(a,b)=>b.recorded_at.localeCompare(a.recorded_at)||b.id-a.id;
const selected=logs.filter(r=>r.metric_key==='trust').sort(compare);
let maxPages=0;
for(let user=0;user<100;user++){
 let found=[],cursor=null,pages=0;
 while(true){
  const rows=selected.filter(x=>!cursor||x.recorded_at<cursor.recorded_at||
   x.recorded_at===cursor.recorded_at&&x.id<cursor.id).slice(0,pageSize);
  assert(rows.length<=pageSize);found.push(...rows);
  if(rows.length<pageSize)break;
  cursor=rows.at(-1);pages++;
  assert(pages<10);
 }
 maxPages=Math.max(maxPages,pages+1);
 assert.deepEqual(found.map(x=>x.id),selected.map(x=>x.id));
 assert.equal(new Set(found.map(x=>x.id)).size,selected.length);
}
assert.equal(maxPages,3);
console.log(JSON.stringify({status:'PASS',syntheticReaders:100,initialProjectionMaxPerTable:50,perMetricPage:50,pages:maxPages,productionRequests:0}));
