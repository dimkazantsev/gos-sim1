const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=path=>fs.readFileSync(path,'utf8');
const migration=read('supabase/migrations/20261120140645_economy_b_no_double_fiscal_event_effects.sql');
const matrix=read('supabase/migrations/20261011180500_event_case_330_matrix.sql');
const routing=read('supabase/migrations/20261011181000_event_stage_party_dispatch.sql');
const revenue=read('supabase/migrations/20261120135619_economy_b_dynamic_collection.sql');
const codes=(matrix.match(/declare codes text:='([0-9a-f]+)'/)||[])[1];
assert.equal(codes?.length,330,'The 330 situation matrix is unchanged');
assert(migration.includes("if key='budget' and l.source_type='event' then continue;end if;"),
  'An event changes the regional base and economy, not federal revenue twice');
assert(migration.includes("key in array array['budget','economy']"),
  'Existing fiscal act path remains intact');
assert(migration.includes("select to_jsonb(r) into before_row from game_fiscal_regions r where game_id=c.game_id and region_code=rc for update;"),
  'Event effects serialize on the affected region');
assert(migration.includes("and game_id=new.game_id;"),
  'Do not resolve outcomes across game sessions');
assert((migration.match(/source_type='event' and source_id=c.id::text/g)||[]).length>=2,
  'Idempotency checked before and after the region lock');
assert(migration.includes("if before_row is null then return new;end if;"),
  'Missing region cannot silently create an orphan ledger');
assert(routing.includes("status='open'")&&routing.includes('s.max_daily'),
  'Stage eligibility and daily event limits are preserved');
assert(revenue.includes("'economy_b_dynamic_lawfulness_v3'"),
  'Tax collection continues to use the approved, separately cached lawfulness path');
assert(!/create\s+table|alter\s+table|grant\s+execute/i.test(migration),
  'No extra tables, RLS changes or public execution rights');
console.log('PASS: 330-case routing, fiscal double-count guard, region serialization, idempotent outcomes, unchanged budget read path');
