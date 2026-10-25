/* A07 concurrency regression contract. This does not use live game data.
 * Structural assertions inspect the migration's actual PL/pgSQL definitions;
 * 40-operation fixture illustrates serialization, not measured DB throughput. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const file='supabase/migrations/20261025003300_lock_concurrent_impact_metric_updates.sql';
const sql=fs.readFileSync(file,'utf8');
const names=['private.apply_post_effects','private.apply_rule_effects','public.revert_impact_entry'];
assert.equal((sql.match(/CREATE OR REPLACE FUNCTION /gi)||[]).length,3,'Exactly three targeted existing functions');
assert.equal((sql.match(/\$function\$;/g)||[]).length,3,'Each CREATE OR REPLACE FUNCTION must terminate with a semicolon for Postgres migration');
assert(!/\b(drop|truncate|alter\s+table|delete\s+from\s+public\.games)\b/i.test(sql),'No destructive schema or game operation');
for(const [i,name] of names.entries()){
 const start=sql.indexOf('CREATE OR REPLACE FUNCTION '+name+'(');
 assert(start>=0,'Missing existing '+name);
 const next=sql.indexOf('CREATE OR REPLACE FUNCTION ',start+10);
 const body=sql.slice(start,next<0?undefined:next);
 assert(/SECURITY DEFINER/i.test(body)&&/search_path/i.test(body),'Preserve security context '+name);
 assert(/for\s+kv\s+in\s+select\s+key,value\s+from\s+jsonb_each_text[\s\S]*?order\s+by\s+key[\s\S]*?loop/i.test(body),'Stable metric lock acquisition order '+name);
 assert(/select\s+\*\s+into\s+m\s+from\s+public\.state_metrics\s+where\s+game_id\s*=[^\n]+metric_key\s*=\s*kv\.key\s+for\s+update\s*;/i.test(body),
  'Read-and-increment must own metric row lock BEFORE reading current value: '+name);
 assert(body.indexOf('select * into m from public.state_metrics')<body.indexOf('private.record_metric_change'),'Lock precedes calculation and history write '+name);
 if(i===0){
  assert(body.includes('p.effects_applied then return'),'An accepted post applies exactly once');
  assert(body.includes('effects_applied=true'),'Mark post effect completed');
 }else{
  assert(/limit\s+1\s+for\s+update\s+of\s+gp\s*;/i.test(body),'Actor party support must also be read under row lock '+name);
 }
 if(i===1){
  assert(body.includes('impact_ledger')&&body.includes('source_id'),'Keep source deduplication');
  assert(body.includes('v_actual_metrics'),'Record actual delta, not theoretical delta');
 }
 if(i===2)assert(body.includes("if l.status='reverted' then return"),'Revert operation remains idempotent');
}
(async()=>{
 // Illustration only: each task corresponds to an independent action on the
 // SAME metric. Never mistake this for a real 40-client Supabase load test.
 let value=50;let chain=Promise.resolve();
 const serialized=async(delta)=>{
  const before=chain;let release;chain=new Promise(resolve=>{release=resolve});
  await before;try{const current=value;await Promise.resolve();value=current+delta}finally{release()}
 };
 await Promise.all(Array.from({length:40},()=>serialized(1)));
 assert.equal(value,90,'40 independently confirmed +1 effects must be reflected in the final value');
 console.log('PASS A07: three live-function lock contracts, source guards and 40-operation isolated serialization model');
})().catch(e=>{console.error(e);process.exitCode=1});
