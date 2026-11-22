/* ГОС.ID: isolated compatibility check for impact-model load reductions.
 * No production calls, game writes, Auth or additional subscriptions. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

const sql=fs.readFileSync('supabase/migrations/20261123060000_impact_metric_trigger_when_scope.sql','utf8');
const shell=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const panel=fs.readFileSync('components/game/ImpactRulesPanel.tsx','utf8');
const dock=fs.readFileSync('components/game/StateMetricsDock.tsx','utf8');
assert(!/create\s+table|alter\s+table|grant\s+|revoke\s+|drop\s+function/i.test(sql),
 'No schema, RLS, permissions or formulas may change');
assert(shell.includes("['stages','event','tools','parties','participants','analytics','grades'].includes(workspace)"),
 'Consequence editor must not load unrelated office assignments');
assert(panel.includes('hidden={!visibleRuleIds.has(rule.id)}'),'Rule filtering must retain existing mounted editors');
assert(dock.includes('const historyByMetric=useMemo('),'Metric history is grouped only once per update');
assert(dock.includes("select('id,label,conditions,effects,enabled,auto_apply')"),
 'Formula modal must not download unused rule fields');

async function main(){
 const db=new PGlite();
 try{
  await db.exec(`
   create schema private;
   create table public.state_metrics(metric_key text primary key,unit text,value numeric not null);
   create table private.trigger_calls(kind text not null);
   create function private.bridge_budget_income_change() returns trigger language plpgsql as
    $$begin insert into private.trigger_calls values('budget');return new;end$$;
   create function private.clamp_percentage_state_metric() returns trigger language plpgsql as
    $$begin insert into private.trigger_calls values('clamp');
    if new.unit='%' then new.value:=least(100,greatest(0,new.value));end if;
    return new;end$$;
  `);
  await db.exec(sql);
  await db.exec(`
   insert into public.state_metrics(metric_key,unit,value) values
    ('budget','млн ₽',100),('lawfulness','%',40),('social_tension','%',80);
  `);
  async function counts(){
   return Object.fromEntries((await db.query('select kind,count(*)::int n from private.trigger_calls group by kind')).rows.map(r=>[r.kind,r.n]));
  }
  assert.deepEqual(await counts(),{clamp:2},'Only percentage inserts invoke bounds');
  await db.exec('update public.state_metrics set value=value+1');
  assert.deepEqual(await counts(),{budget:1,clamp:4},'Unrelated metric updates skip budget bridge');
  await db.exec("update public.state_metrics set value=value where metric_key='budget'");
  assert.deepEqual(await counts(),{budget:1,clamp:4},'Identical budget values skip bridge work');
  await db.exec("update public.state_metrics set value=500 where metric_key='lawfulness'");
  assert.equal((await db.query("select value from public.state_metrics where metric_key='lawfulness'")).rows[0].value,100,
   'Percentage bounds still enforce 0–100');
  assert.deepEqual(await counts(),{budget:1,clamp:5},'Percentage update still clamps');
  await db.exec("update public.state_metrics set unit='%' where metric_key='budget'");
  assert.deepEqual(await counts(),{budget:1,clamp:6},'Switching a unit to percentage still clamps');
  await db.exec("update public.state_metrics set value=106 where metric_key='budget'");
  assert.deepEqual(await counts(),{budget:2,clamp:7},'Budget updates still invoke bridge and new percentage bounds');
  assert.equal((await db.query("select value from public.state_metrics where metric_key='budget'")).rows[0].value,100);
  // Compare the new indexed grouping to the former per-metric filter, without touching data.
  const source=[
   {id:3,metric_key:'lawfulness',recorded_at:'2026-01-03'},
   {id:1,metric_key:'public_trust',recorded_at:'2026-01-01'},
   {id:2,metric_key:'lawfulness',recorded_at:'2026-01-02'}
  ];
  const grouped=new Map();
  for(const item of source){const rows=grouped.get(item.metric_key);if(rows)rows.push(item);else grouped.set(item.metric_key,[item]);}
  for(const key of ['lawfulness','public_trust','security'])
   assert.deepEqual(grouped.get(key)||[],source.filter(r=>r.metric_key===key),'History grouping preserves visible rows');
  console.log('PASS: identical budget/percentage effects; irrelevant trigger calls skipped; renderer contracts preserved.');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
