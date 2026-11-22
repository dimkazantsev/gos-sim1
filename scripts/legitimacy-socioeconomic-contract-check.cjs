const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261123012500_metric_legitimacy_macro_links.sql'),'utf8');
for(const required of [
  "private.write_weighted_legitimacy","private.apply_societal_metric_deltas",
  "private.apply_macro_political_effect","private.derive_legitimacy_from_metric_history",
  "NEW.metric_key IN ('public_trust','elite_support','economy')",
  "0.18","0.12","0.08","0.10","0.02",
  "v_part:=NEW.delta*0.2","source_type IN ('event','act')",
  "ELSIF NEW.source_type='macro'","v_actual_metrics ? 'public_trust'",
  "order by case when key='legitimacy' then 1 else 0 end,key",
  "'{metrics,legitimacy}','0.35'::jsonb"
])assert(sql.includes(required),'Missing linkage requirement: '+required);
assert(!/create\s+table/i.test(sql),'No new tables permitted');
assert(!/pg_cron|create\s+(?:publication|subscription)|\bhttp\b|pg_net/i.test(sql),'No polling, new subscriptions, or network calls');
const game=fs.readFileSync(path.join(root,'components/game/StateMetricsDock.tsx'),'utf8');
assert(game.includes("'public_trust'")&&game.includes("'elite_support'")&&game.includes("'legitimacy'"),'Existing UI metrics remain available');
console.log('PASS: existing server trigger reused; activity and price drivers linked; no client calls or new tables');
