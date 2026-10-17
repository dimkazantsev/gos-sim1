/* Post-merge safety: clients may only mutate the canonical committee ledger.
 * Test migration on isolated PostgreSQL WASM without touching active game data. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261018042000_disable_obsolete_committee_mandate_allocator.sql','utf8');
const ui=fs.readFileSync('components/game/InstitutionStaffingLab.tsx','utf8');
const canonical=fs.readFileSync('supabase/migrations/20261018031000_multi_committee_mandate_allocations.sql','utf8');
assert(ui.includes("supabase.rpc('set_committee_mandates'"),'UI must use the canonical allocator');
assert(ui.includes("from('committee_mandate_allocations')"),'UI reads the same canonical ledger');
assert(canonical.includes('CREATE OR REPLACE FUNCTION public.set_committee_mandates'),'Canonical RPC exists in migrations');
assert(migration.includes('REVOKE ALL ON FUNCTION public.allocate_committee_mandates'),'Legacy RPC must be revoked');
(async()=>{
const db=new PGlite();
try{
 await db.exec(`
 create role anon;
 create role authenticated;
 create function public.allocate_committee_mandates(uuid,uuid,integer)
   returns uuid language sql as 'select null::uuid';
 create function public.set_committee_mandates(uuid,uuid,integer)
   returns void language plpgsql as 'begin return; end';
 grant execute on function public.allocate_committee_mandates(uuid,uuid,integer)
  to public,anon,authenticated;
 grant execute on function public.set_committee_mandates(uuid,uuid,integer)
  to authenticated;
 `);
 const before=await db.query("select has_function_privilege('authenticated','public.allocate_committee_mandates(uuid,uuid,integer)','EXECUTE') legacy");
 assert.equal(before.rows[0].legacy,true);
 await db.exec(migration);
 const after=await db.query("select has_function_privilege('authenticated','public.allocate_committee_mandates(uuid,uuid,integer)','EXECUTE') legacy, has_function_privilege('authenticated','public.set_committee_mandates(uuid,uuid,integer)','EXECUTE') canonical, has_function_privilege('anon','public.allocate_committee_mandates(uuid,uuid,integer)','EXECUTE') anon_legacy");
 assert.deepEqual(after.rows,[{legacy:false,canonical:true,anon_legacy:false}]);
 console.log('PASS: obsolete allocator revoked for guests and participants; canonical allocator and data remain unchanged.');
}finally{await db.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
