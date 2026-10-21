/* Guard the entire repository's client-facing case SELECT contract. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const migration=fs.readFileSync('supabase/migrations/20261021104919_prepare_visible_event_cases_outcome_rpc.sql','utf8');
const privilegeLock=fs.readFileSync('supabase/migrations/20261021110319_lock_event_effect_plan_column.sql','utf8');
const workspace=fs.readFileSync('components/game/EventWorkspace.tsx','utf8');
assert(workspace.includes("supabase.rpc('list_visible_event_cases'"),
 'Case details must come through a permission-aware server RPC');
assert(!workspace.includes("from('event_cases').select('*')"),
 'A wildcard request leaks the effect_plan after column permissions are reduced');
assert(privilegeLock.includes('revoke select on public.event_cases from anon,authenticated'),
 'Table-level SELECT must be revoked before column privileges matter');
assert(privilegeLock.includes('revoke select(effect_plan) on public.event_cases from anon,authenticated'),
 'Remove residual per-column grants for the confidential effect_plan');
assert(privilegeLock.includes('grant select (id,game_id,case_key'),
 'Other safe fields stay accessible under the current RLS policies');
assert(migration.includes("when private.is_game_teacher(c.game_id) then c.effect_plan"),
 'Teachers retain authorized access to complete plan details');
assert(migration.includes('when exists (select 1 from public.event_case_outcomes'),
 'Other members only see answer details after the official outcome');
assert(migration.includes('else null')&&migration.includes("'effect_plan'"),
 'Pending student and guest cases must not include an answer key');
assert(migration.includes('auth.uid()')&&migration.includes('private.is_game_member(c.game_id)'),
 'Cross-game RPC access requires authentication and checked membership');
assert(migration.includes('cardinality(p_case_ids)>400'),
 'Bound the size of each case-list RPC to avoid unbounded requests');
assert(migration.includes("Explanation is available after final outcome"),
 'Old feedback RPC must not bypass the outcome gate');
assert(migration.includes("revoke all on function public.list_visible_event_cases(uuid,uuid[]) from public,anon,authenticated"),
 'Anonymous users cannot execute the answer-bearing RPC');
const all=[];
function walk(dir){
 if(!fs.existsSync(dir))return;
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,entry.name);
  if(entry.isDirectory())walk(p);
  else if(/\.(tsx?|jsx?)$/.test(entry.name))all.push(p);
 }
}
['app','components','lib'].forEach(walk);
const violations=[];
for(const p of all){
 const code=fs.readFileSync(p,'utf8');
 const pattern=/\.from\(\s*(['"])event_cases\1\s*\)\s*\.select\(\s*(['"])\*\2\s*\)/g;
 if(pattern.test(code))violations.push(p);
 const secret=/\.from\(\s*(['"])event_cases\1\s*\)\s*\.select\(\s*(['"])[^'"]*\beffect_plan\b[^'"]*\2\s*\)/g;
 if(secret.test(code))violations.push(p+' reads effect_plan');
}
assert.deepEqual(violations,[],'No client can perform direct wildcard or sensitive field reads');
console.log('PASS: '+all.length+' client modules checked; pending answers hidden in API; teacher access and outcome gate retained.');
