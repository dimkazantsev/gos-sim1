const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261122200756_economy_macro_existing_ledger_no_feedback_20261123.sql'),'utf8');
const required=[
  'private.apply_macro_economy_effect',
  'private.fiscal_ledger_metrics_trigger',
  'PERFORM private.apply_macro_economy_effect(NEW.game_id,NEW.before_values',
  'round(-0.9*di-0.6*dr+0.5*da-0.08*dfx+0.06*doil,6)',
  'greatest(-4,least(4,',
  "jsonb_typeof(p_before->'activity_override')='number'",
  "jsonb_typeof(p_after->'activity_override')='number'",
  "m.game_id=p_game AND m.metric_key='economy'",
  "'derived:macro_economy'",
  'trg_derived_legitimacy_on_metric_history',
  'trg_security_independent_metrics',
  'publish_public_metric_rating',
  "NEW.source_type IS DISTINCT FROM 'derived:macro_economy'",
];
for(const x of required)assert(sql.includes(x),'Missing macro economy contract: '+x);
for(const forbidden of [/create\s+table/i,/create\s+index/i,/create\s+publication/i,/pg_cron|pg_net|http_post/i])
  assert(!forbidden.test(sql),'Unexpected resource or external call');
assert(!/create\s+trigger\s+\w+_economy/i.test(sql),'New macro trigger would waste work');
const fiscal=fs.readFileSync(path.join(root,'components/game/fiscalMath.ts'),'utf8');
assert(fiscal.includes('economy*.002')&&fiscal.includes('modelBAdditionalChannels'));
const old=fs.readFileSync(path.join(root,'supabase/migrations/20261122194657_security_macro_social_crisis_events_low_load_20261123.sql'),'utf8');
assert(old.includes('private.security_from_macro_ledger'));
console.log('PASS: economy macro coefficients, one existing ledger trigger, no political/safety loop, budget model intact');
