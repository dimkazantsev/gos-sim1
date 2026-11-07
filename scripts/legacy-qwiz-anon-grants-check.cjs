/* Privilege regression in an isolated PGlite DB; never writes to production. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261108000500_restrict_legacy_qwiz_anon_rpc.sql'),'utf8');
const extraSQL=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261108093000_restrict_anon_authenticated_only_rpc.sql'),'utf8');
const protectedFuncs=["public.get_my_game_identity(p_game uuid)","public.teacher_update_party_statistics(p_party_id uuid, p_rating numeric, p_support numeric, p_mandates integer, p_expected_rating numeric, p_expected_support numeric, p_expected_mandates integer)"];
assert.equal((extraSQL.match(/^REVOKE EXECUTE ON FUNCTION /gm)||[]).length,2,'Only the two authenticated-only RPCs change');
assert.equal((extraSQL.match(/^GRANT EXECUTE ON FUNCTION /gm)||[]).length,2,'Matching grants');
for(const fn of protectedFuncs){
 assert.equal(extraSQL.split('REVOKE EXECUTE ON FUNCTION '+fn+' FROM PUBLIC, anon;').length-1,1,'Exact anon revoke: '+fn);
 assert.equal(extraSQL.split('GRANT EXECUTE ON FUNCTION '+fn+' TO authenticated, service_role;').length-1,1,'Exact authorized grant: '+fn);
}
assert(!/(DROP|DELETE|TRUNCATE|ALTER TABLE|CREATE POLICY)/i.test(extraSQL));
const funcs=[
 "public.qwiz_apply_round_boost()",
 "public.qwiz_arcade_extras(p_code text)",
 "public.qwiz_arcade_state(p_code text)",
 "public.qwiz_audience_active_room()",
 "public.qwiz_geo_projection(p_code text)",
 "public.qwiz_lobby_view(p_room uuid, p_public boolean)",
 "public.qwiz_party_arcade(p_code text)",
 "public.qwiz_party_projection(p_code text)",
 "public.qwiz_projector_music(p_room uuid, p_enable boolean)",
 "public.qwiz_public_screen(p_code text)",
 "public.qwiz_release_countdown(p_code text)",
 "public.qwiz_result_deadline()",
 "public.qwiz_tick(p_code text)"
];
assert.equal(funcs.length,13);
assert.equal(new Set(funcs).size,13);
assert(!/(DROP|DELETE|TRUNCATE|ALTER TABLE|CREATE POLICY)/i.test(sql),'No schema/data/RLS destruction');
for(const fn of funcs){
 assert.equal(sql.split('REVOKE EXECUTE ON FUNCTION '+fn+' FROM PUBLIC, anon;').length-1,1,'One exact anonymous/public revoke: '+fn);
 assert.equal(sql.split('GRANT EXECUTE ON FUNCTION '+fn+' TO authenticated, service_role;').length-1,1,'Preserve only previous authorized roles: '+fn);
}
assert.equal((sql.match(/^REVOKE EXECUTE ON FUNCTION /gm)||[]).length,13,'No other function is affected');
async function main(){
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const fn of funcs)await db.exec('CREATE FUNCTION '+fn+' RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;');
  for(const fn of protectedFuncs)await db.exec('CREATE FUNCTION '+fn+' RETURNS integer LANGUAGE sql SECURITY DEFINER AS $ SELECT 1 $;');
  await db.exec('CREATE FUNCTION public.get_public_presidential_poll(p_slug text) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $ SELECT 1 $;');
  const allowed=async(role,signature)=>{const name=signature.slice('public.'.length,signature.indexOf('(')),args=signature.slice(signature.indexOf('(')+1,-1);const result=await db.query("SELECT has_function_privilege($1,p.oid,'EXECUTE') AS allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$2 AND pg_get_function_identity_arguments(p.oid)=$3",[role,name,args]);assert.equal(result.rows.length,1,'Exact function resolved: '+signature);return result.rows[0].allowed};
  for(const fn of funcs){assert(await allowed('anon',fn),'Mock baseline anon callable: '+fn);assert(await allowed('authenticated',fn));assert(await allowed('service_role',fn))}
  await db.exec(sql);
  for(const fn of funcs){
   assert.equal(await allowed('anon',fn),false,'Anonymous must be denied: '+fn);
   assert.equal(await allowed('authenticated',fn),true,'Authenticated access must remain: '+fn);
   assert.equal(await allowed('service_role',fn),true,'Service access must remain: '+fn);
  }
  // Baseline: authenticated-only functions had an unused anonymous grant.
  for(const fn of protectedFuncs)assert.equal(await allowed('anon',fn),true);
  await db.exec(extraSQL);
  for(const fn of protectedFuncs){
   assert.equal(await allowed('anon',fn),false,'Anonymous access denied: '+fn);
   assert.equal(await allowed('authenticated',fn),true,'Authenticated remains: '+fn);
   assert.equal(await allowed('service_role',fn),true,'Service role remains: '+fn);
  }
  assert.equal(await allowed('anon','public.get_public_presidential_poll(p_slug text)'),true,'The deliberately public poll must remain available');
  for(const fn of funcs)assert.equal(await allowed('anon',fn),false,'Old QWIZ RPC may not regain anon privileges');
  console.log('PASS: 13 QWIZ and 2 authenticated-only RPCs deny anon; authenticated/service retained, public polling unaffected');
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
