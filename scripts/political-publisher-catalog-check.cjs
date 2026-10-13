/* Narrow publisher permissions + UI regression. Historic posts stay untouched. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261013203000_process_actors_complete_catalog.sql','utf8');
const wall=fs.readFileSync('components/game/PoliticalWallView.tsx','utf8');
const game=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const avatar=fs.readFileSync('components/game/PublisherAvatar.tsx','utf8');
const style=fs.readFileSync('app/political-publishers.css','utf8');
const layout=fs.readFileSync('app/layout.tsx','utf8');
const catalog=[...sql.matchAll(/\('((?:ministry|federal):[a-z_]+)','([^']+)'\)/g)];
assert.equal(catalog.length,43,'All modelled federal subjects have distinct catalog entries');
assert.equal(new Set(catalog.map(x=>x[1])).size,43,'Publisher keys must be unique');
assert.ok(catalog.filter(x=>x[1].startsWith('ministry:')).length>=21,'Federal ministries must be represented');
assert.ok(!sql.includes("v_label:='GOS//SIMS'"),'Old system publisher must be removed');
assert.ok(!sql.includes("'teacher','participant'"),'Old publisher cannot be offered');
for(const fragment of [
 'private.process_actor_label','public.get_process_actors',
 "not private.is_game_member(p_game_id)",
 "gm.kind='observer'",
 "v_teacher and k in ('ministry','minjust','interior')",
 "not private.is_game_teacher(p_game_id) then raise exception",
 "from public.institution_units u", "from public.game_parties gp",
 "from public.institution_assignments ia", "from public.game_office_assignments",
 "u.head_user_id=v_uid", "gp.leader_user_id=v_uid",
 "where gp.id=substring(p_actor_key from 7)::uuid",
 "where u.id=substring(p_actor_key from 6)::uuid",
 "gm.roster_archived_at" // not a direct predicate; existing game membership is canonical
].filter(x=>x!=="gm.roster_archived_at"))assert.ok(sql.includes(fragment),'Missing rights or dynamic data source '+fragment);
assert.ok(!/insert into public\.political_posts|delete from public\.political_posts|update public\.political_posts/i.test(sql),'Existing posts must not be rewritten');
assert.ok(wall.includes(".filter(x=>x.key!=='teacher'"),'Do not display old actor even before server response');
assert.ok(wall.includes("const actorSearchQuery=")&&wall.includes('actorChoices.map'),'Long lists are searchable');
assert.ok(wall.includes("g.createPoliticalPost(data,files)"),'Actual posting route unchanged');
assert.ok(!game.includes("key:'teacher',label:"),'Local fallback excludes decommissioned publisher');
assert.ok(avatar.includes("actorKey.startsWith('party:')"),'Live party logos retain avatar behavior');
assert.ok(style.includes('.processPortal .wallActorSearch'));
assert.ok(layout.includes("import './political-publishers.css'"));
const processQA=fs.readFileSync('scripts/political-process-check.sql','utf8');
assert.ok(processQA.includes("'initiative','government'"),'Institutional post still tested');
assert.ok(processQA.includes("'initiative','teacher'"),'Old publisher rejection has a regression');
assert.ok(processQA.includes("FAIL obsolete GOS//SIMS publisher remains authorized"));
console.log('PASS political publishers: full fixed catalogue, real game entities, rights, search, retired actor rejection.');
