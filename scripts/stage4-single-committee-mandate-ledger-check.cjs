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
 create schema auth;
 create schema private;
 create function auth.uid() returns uuid language sql stable as 'select ''00000000-0000-0000-0000-000000000010''::uuid';
 create function private.is_game_member(uuid) returns boolean language sql as 'select true';
 create function private.is_game_observer(uuid) returns boolean language sql as 'select false';
 create function private.game_role(uuid,uuid) returns text language sql as 'select ''председатель правительства''::text';
 create table institution_units(id uuid primary key,game_id uuid,unit_kind text,head_user_id uuid);
 create table game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
 create table institution_assignments(id uuid primary key default gen_random_uuid(),game_id uuid,unit_id uuid,unit_kind text,user_id uuid,party_id uuid,created_by uuid,created_at timestamptz default now(),unique(unit_id,user_id));
 create unique index institution_assignments_single_ministry_per_student on institution_assignments(game_id,user_id) where unit_kind='ministry';
 insert into institution_units values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','ministry','00000000-0000-0000-0000-000000000010'),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000099','ministry','00000000-0000-0000-0000-000000000010'),
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000099','committee','00000000-0000-0000-0000-000000000010');
 insert into game_members values ('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000011','student',null);
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
 const gamer='00000000-0000-0000-0000-000000000011';
 const u1='00000000-0000-0000-0000-000000000001';
 const u2='00000000-0000-0000-0000-000000000002';
 await db.query('select public.assign_institution_member($1,$2)',[u1,gamer]);
 await db.query('select public.assign_institution_member($1,$2)',[u2,gamer]);
 const office=await db.query("select unit_id from institution_assignments where user_id=$1 and unit_kind='ministry'",[gamer]);
 assert.equal(office.rows.length,1,'Ministry staffing remains exclusive');
 assert.equal(office.rows[0].unit_id,u2,'Repeated ministry assignment moves the appointment');
 await assert.rejects(()=>db.query('select public.assign_institution_member($1,$2)',[
 '00000000-0000-0000-0000-000000000003',gamer
 ]),/Для комитетов используйте распределение/,'Legacy committee appointment cannot bypass canonical mandate ledger');
 console.log('PASS: obsolete allocator revoked; canonical allocator remains enabled; ministry reassignment works and legacy committee paths are blocked.');
}finally{await db.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
