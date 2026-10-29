const assert=require('node:assert/strict');
const fs=require('node:fs');
const migration=fs.readFileSync('supabase/migrations/20261029100000_party_rename_process_actor_catalog.sql','utf8');
const parties=fs.readFileSync('components/game/PartiesView.tsx','utf8');
const game=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const guest=fs.readFileSync('components/GameClient.tsx','utf8');
const wall=fs.readFileSync('components/game/PoliticalWallView.tsx','utf8');
assert.match(migration,/create or replace function public.rename_game_party\(p_party_id uuid,p_new_name text\)/i);
for(const fragment of ["private.is_game_teacher(p.game_id)","p.leader_user_id=v_uid",
 "m.kind='student'","m.roster_archived_at is null","update public.game_members set team=v_name",
 "update public.chat_channels set name=","other.game_id=p.game_id","other.id<>p.id",
 "pg_advisory_xact_lock","revoke all on function public.rename_game_party",
 "grant execute on function public.rename_game_party"]){
 assert.ok(migration.includes(fragment),'Party rename safety or membership dependency missing: '+fragment);
}
assert.ok(!migration.includes("update public.formal_documents"),'Signed historic acts must remain immutable');
assert.ok(!migration.includes('update public.political_posts'),'Historic posts must not be rewritten');
assert.ok(parties.includes('selected.leader_user_id===me.user_id')&&parties.includes('teacher||selected.leader_user_id'),'Chair and teacher UI, but not ordinary party members');
assert.ok(parties.includes('g.renameParty(selected.id,renameName)')&&parties.includes('data-party-rename'),'Rename editor must use guarded server RPC');
assert.ok(game.includes("supabase.rpc('rename_game_party'")&&game.includes('invalidatePartyRows()'),'Rename should invalidate party cache');
assert.ok(guest.includes('renameParty:blocked as typeof g.renameParty'),'Guests cannot rename parties');
const official=[
 'Министерство по социальной политике',
 'Министерство по экономической политике',
 'Министерство по внешней политике',
 'Министерство по обороне и внутренней безопасности',
 'Министерство по внутренней политике и государству'];
for(const ministry of official)assert.ok(migration.includes(ministry),'Missing approved ministry '+ministry);
assert.ok(migration.includes("if not private.is_game_teacher(p_game_id) then raise exception 'Нет полномочий выбранного министерства'"),'Students must not spoof an unassigned ministry');
assert.ok(migration.includes("when 'social'")&&migration.includes("when 'internal'"),'Teacher catalog incomplete');
assert.ok(migration.includes("array['participant','ksrf','office'"),'KSRF actor available');
assert.ok(migration.includes("if not v_teacher and not private.process_actor_active_now"),'Student role eligibility must remain limited to formed actors');
assert.ok(migration.includes("select distinct on (lower(btrim(role_title)))"),'Repeated office roles must be collapsed at the source');
assert.ok(wall.includes('seenActorLabels')&&wall.includes("120000);"),'Picker must deduplicate and reduce redundant polling');
assert.ok(wall.includes("useGameTableSync("),'Actor refresh still listens for live game changes');
console.log('PASS guarded party rename; game membership, chat and cache links; teacher catalogue and unique actors; guest denial and throttled fallback.');
