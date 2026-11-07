/* Privilege regression in an isolated PGlite DB; never writes to production. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261108000500_restrict_legacy_qwiz_anon_rpc.sql'),'utf8');
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
  await db.exec('CREATE FUNCTION public.get_my_game_identity(p_game uuid) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;');
  const allowed=async(role,signature)=>{const result=await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,signature]);return result.rows[0].allowed};
  for(const fn of funcs){assert(await allowed('anon',fn),'Mock baseline anon callable: '+fn);assert(await allowed('authenticated',fn));assert(await allowed('service_role',fn))}
  await db.exec(sql);
  for(const fn of funcs){
   assert.equal(await allowed('anon',fn),false,'Anonymous must be denied: '+fn);
   assert.equal(await allowed('authenticated',fn),true,'Authenticated access must remain: '+fn);
   assert.equal(await allowed('service_role',fn),true,'Service access must remain: '+fn);
  }
  assert.equal(await allowed('anon','public.get_my_game_identity(p_game uuid)'),true,'Active ГОС.ID entry privileges must be untouched');
  console.log('PASS: 13 legacy RPCs lose anon/PUBLIC EXECUTE; authenticated and service roles remain; GOС.ID entry untouched');
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
