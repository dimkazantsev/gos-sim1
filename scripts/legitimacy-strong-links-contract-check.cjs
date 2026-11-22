const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'20261122190859_legitimacy_strong_existing_metrics_no_polling_20261123.sql'.replace(/^/,'supabase/migrations/')),'utf8');
const required=[
 'private.apply_legitimacy_social_links',
 "('social_stability'::text,2::numeric)",
 "('social_tension'::text,-3::numeric)",
 "('media_climate'::text,1.5::numeric)",
 "('international_standing'::text,1::numeric)",
 "WHEN (NEW.metric_key='legitimacy' AND NEW.delta<>0)",
 "m.game_id=NEW.game_id",
 "m.value+NEW.delta*weights.k",
 "NEW.source_type IS DISTINCT FROM 'derived:legitimacy-social'",
 'private.reconcile_budget_driver_once',
 'PERFORM private.reconcile_budget_driver_once(NEW.game_id)',
 'gos.budget_driver_processed',
 'private.sync_budget_from_fiscal_ledger'
];
for(const x of required)assert(sql.includes(x),'Missing strong-legitimacy contract '+x);
for(const forbidden of [/create\s+table/i,/create\s+(?:subscription|publication)/i,/pg_cron|pg_net|net\.http|http_post/i])assert(!forbidden.test(sql),'Disallowed workload');
const model=fs.readFileSync(path.join(root,'components/game/fiscalMath.ts'),'utf8');
assert(model.includes("'social_stability'")&&model.includes("'social_tension'")&&model.includes("'international_standing'")&&model.includes("'legitimacy'")&&model.includes("'media_climate'"));
const modelFederal=fs.readFileSync(path.join(root,'components/game/federalBudgetMath.ts'),'utf8');
assert(modelFederal.includes('modelBAdditionalChannels')||modelFederal.includes('collection_adjustment'));
console.log('PASS: strong legitimacy, no loops/extra client calls, existing B model intact');
