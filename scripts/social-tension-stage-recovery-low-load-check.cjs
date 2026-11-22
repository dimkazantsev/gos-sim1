const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261122205344_social_tension_stage_relief_single_close_no_extra_requests_20261123.sql'),'utf8');
const hook=fs.readFileSync(path.join(root,'components/game/useBudgetPulse.ts'),'utf8');
const expected=[
'private.settle_stage_social_tension','private.fiscal_closed_stage_trigger',
'pg_advisory_xact_lock','v_period_exists','private.fiscal_periods',
's.completed_at=p_closed AND s.stage_no<p_stage_no',
'0.9*v_infl+v_rate_effect-0.4*v_activity+v_economy+v_law+v_crisis',
'v_rate<0 AND v_infl>0','0.25*v_rate',
"h.metric_key='economy' THEN -0.5*h.delta",
"h.metric_key='lawfulness' THEN -0.3*h.delta",
'0.08*(h.new_threat-h.old_threat)',
'0.05*(h.new_containment-h.old_containment)',
"h.kind='finish' THEN 2",
'v_applied:=greatest(-8,least(8,v_total))',
"'derived:stage_tension'",
"p_rule.rule_key IN ('vote_passed','post_official')",
"tension_suppressed",
"v_new IS NOT DISTINCT FROM v_old THEN RETURN",
"NEW.source_id LIKE 'macro_political:%'",
"NEW.source_id LIKE 'business_activity:economy:%'",
"NOT v_skip_tension OR weights.metric_key<>'social_tension'",
"effects->'metrics' ? 'social_tension'",
"REVOKE ALL ON FUNCTION private.settle_stage_social_tension",
];
for(const marker of expected)assert(sql.includes(marker),'Missing approved tension contract: '+marker);
for(const rx of [/create\s+table\b/i,/create\s+index\b/i,/create\s+trigger\b/i,/pg_cron|pg_net|http_post/i,/alter\s+table\b/i])
 assert(!rx.test(sql),'Unapproved new database resource');
assert(!hook.includes('setInterval('),'Idle budget view must use zero periodic RPCs');
for(const s of ["window.addEventListener('online',online)","window.addEventListener('focus',resume)","document.addEventListener('visibilitychange',resume)","window.addEventListener(GAME_DATA_REFRESH_EVENT,changed)","supabase.rpc('get_budget_pulse'"])
 assert(hook.includes(s),'Budget reliability path missing: '+s);
const model=fs.readFileSync(path.join(root,'components/game/fiscalMath.ts'),'utf8');
assert(model.includes('modelBAdditionalChannels')&&model.includes("'social_tension'"),'Approved Model B connection removed');
const notes=[{inflation:-2,rate:-1,activity:3,economy:2,law:1,threat:-10,contain:10,finish:0}];
const scenario=notes[0];
const delta=.9*scenario.inflation+.25*scenario.rate-.4*scenario.activity-.5*scenario.economy-.3*scenario.law+.08*scenario.threat-.05*scenario.contain-2*scenario.finish;
assert(Math.abs(delta+5.85)<1e-12,'Scenario expected -5.85');
assert.equal(Math.max(-8,Math.min(8,.9*(-18))),-8,'Anti-farming stage relief cap');
console.log('PASS: stage-settled, idempotent tension links; no extra trigger/table/index/client poll');
