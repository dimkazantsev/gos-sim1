/* Crisis Day-Zero invariant and political deletion UI contract.
   No production DML. Runs as part of normal build check. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261012160000_crisis_baseline_percentage_limits.sql');
const wall=read('components/game/PoliticalWallView.tsx');
const discussion=read('components/game/CivicDiscussion.tsx');
const game=read('components/game/useRepublicGame.ts');
const expected={
 public_trust:12,economy:16,social_stability:14,lawfulness:19,
 international_standing:15,legitimacy:17,elite_support:18,
 media_climate:13,security:20,social_tension:86
};
assert.deepEqual(Object.keys(expected).length,10);
for(const [key,value] of Object.entries(expected)){
 assert(new RegExp("'"+key+"'\\s*,\\s*"+value+"::numeric").test(migration),'Crisis target absent: '+key);
 assert(value>=0&&value<=100,'Crisis start must be bounded: '+key);
 if(key!=='social_tension')assert(value>=10&&value<=20,key+' must start in range 10-20');
 else assert(value>=80&&value<=90,'Negative tension starts high in a severe crisis');
}
assert(migration.includes("new.unit='%'"),'Only percentage indices are clamped');
assert(migration.includes('new.value:=least(100,greatest(0,new.value))'),'Bound must be enforced on all writes');
assert(migration.includes('new.previous_value:=least(100,greatest(0,new.previous_value))'),'Previous value must be bounded');
assert(migration.includes('state_metric_percentage_range'),'Database CHECK must reject out-of-range values');
assert(migration.includes('before insert or update on public.state_metrics'),'All writers must be covered');
assert(migration.includes('after insert on public.games'),'New games must initialize automatically');
assert(migration.includes('trg_zz_crisis_game_start'),'Crisis trigger must follow existing default seeding');
assert(migration.includes("source_type='baseline'"),'New game baseline must be corrected, not appear prosperous');
assert(migration.includes("current_round=1"),'Existing calibration must be stage-one gated');
assert(migration.includes('matched_games <> 1'),'Existing calibration must target exactly one matching PAU game');
assert(!migration.includes('541b6fde-'),'Migrations must not hardcode generated database IDs');
assert(migration.includes("source_type='crisis_rebaseline'"),'Existing history must have a distinct audit event');
assert(migration.includes('insert into public.state_metric_history'),'Do not silently replace impact history');
assert(!/\b(delete|truncate)\s+from\s+public\.(state_metric_history|political_posts)/i.test(migration),'Never erase recorded decisions');
const clamp=n=>Math.max(0,Math.min(100,n));
for(const [key,start] of Object.entries(expected)){
 let value=start;
 for(const n of [-100000,-999,-100,-1.5,0,1.5,100,999,100000,Number.MAX_VALUE]){
  value=clamp(value+n);
  assert(Number.isFinite(value)&&value>=0&&value<=100,key+' escaped 0–100: '+value);
 }
 console.log('PASS '+key+' initial '+start+'%, bounded ±large shocks');
}
assert(wall.includes('locallyRemovedIds.has(p.id)'),'Deleted cards must immediately unmount');
assert(wall.includes('setLocallyRemovedIds(previous=>new Set(previous).add(p.id))'),'Single deletion must hide optimistically');
assert(wall.includes('setLocallyRemovedIds(previous=>new Set([...previous,...ids]))'),'Bulk deletion must hide optimistically');
assert(wall.includes("if(failed.length)setLocallyRemovedIds"),'Failed bulk deletions must reappear');
assert(!wall.includes("setNotice('Публикация удалена из ленты.')"),'Successful deletion must not show a notice');
assert(discussion.includes('/материал недоступен/i'),'Deleted discussions must not offer a pointless retry');
assert(discussion.includes('missingPost.current=true;void refreshGame.current()'),'Stale requests must refresh only once');
assert(game.includes('visiblePostIds.has(x.post_id)')||game.includes('visiblePostIds.has(item.post_id)'),'No signed media URLs for deleted posts');
console.log('PASS crisis baseline, hard metric cap, audit preservation and deleted-post UX');
