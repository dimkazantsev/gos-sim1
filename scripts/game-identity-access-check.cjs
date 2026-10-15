/* Execute the actual identity RPC and membership guard in isolated PostgreSQL.
 * Synthetic fixtures only: no network, production data or Auth accounts. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migrations=path.join(root,'supabase/migrations');
const read=name=>fs.readFileSync(path.join(migrations,name),'utf8');
function definition(sql,name){
 const start=sql.indexOf('create or replace function '+name+'(');
 assert(start>=0,'Missing real function '+name);
 const match=sql.slice(start).match(/\bas\s+(\$\w*\$)/i);
 assert(match,'Missing function body '+name);
 const end=sql.indexOf(match[1],start+match.index+match[0].length);
 assert(end>=0,'Unclosed function body '+name);
 return sql.slice(start,end+match[1].length)+';';
}
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
async function main(){
 const db=new PGlite();
 let passed=0,failed=0;
 async function check(name,test){
  try{await test();passed++;console.log('PASS '+name);}
  catch(error){failed++;console.error('FAIL '+name+': '+error.message);}
 }
 try{
  await db.exec(`
   create schema auth; create schema private;
   create role anon; create role authenticated;
   create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create table public.games(id uuid primary key,title text,settings jsonb);
   create table public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz,primary key(game_id,user_id));
   create table public.game_member_access_blocks(game_id uuid,user_id uuid,primary key(game_id,user_id));
   create table public.platform_admins(user_id uuid primary key);
   create function private.is_platform_admin() returns boolean language sql stable security definer set search_path='' as
    $$ select exists(select 1 from public.platform_admins where user_id=auth.uid()) $$;
   grant usage on schema public,auth to anon,authenticated;
   insert into public.games values('${uuid(100)}','Synthetic game A','{"internal":"synthetic"}'),('${uuid(101)}','Synthetic game B','{}');
   insert into public.game_members values
    ('${uuid(100)}','${uuid(1)}','student',null),
    ('${uuid(100)}','${uuid(2)}','teacher',null),
    ('${uuid(100)}','${uuid(3)}','observer',null),
    ('${uuid(100)}','${uuid(4)}','student',now()),
    ('${uuid(100)}','${uuid(5)}','student',null),
    ('${uuid(100)}','${uuid(6)}','student',now()),
    ('${uuid(100)}','${uuid(9)}','teacher',now());
   insert into public.game_member_access_blocks values
    ('${uuid(100)}','${uuid(5)}'),('${uuid(100)}','${uuid(6)}');
   insert into public.platform_admins values('${uuid(8)}'),('${uuid(9)}');
  `);
  await db.exec(definition(read('20261013191740_teacher_participant_access_20261014.sql'),'private.is_game_member'));
  await db.exec(definition(read('20261011002000_login_and_rls_stability.sql'),'public.get_my_game_identity'));
  // Model the existing production grants; the patch must preserve them.
  await db.exec('revoke all on function public.get_my_game_identity(uuid) from public; grant execute on function public.get_my_game_identity(uuid) to anon,authenticated;');
  const patch=fs.readdirSync(migrations).find(name=>name.endsWith('_game_identity_active_membership.sql'));
  if(patch)await db.exec(read(patch));
  const call=async(user,game=100,role='authenticated')=>{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user==null?'':uuid(user)]);
   await db.exec('set role '+role);
   try{return(await db.query('select public.get_my_game_identity($1::uuid) as identity',[uuid(game)])).rows[0].identity;}
   finally{await db.exec('reset role');}
  };
  for(const [id,kind]of [[1,'student'],[2,'teacher'],[3,'observer']]){
   await check('Active '+kind+' keeps the existing identity response',async()=>{
    const result=await call(id);
    assert.equal(result.game.id,uuid(100));assert.equal(result.member.user_id,uuid(id));assert.equal(result.member.kind,kind);
   });
  }
  for(const [id,name]of [[4,'Archived member'],[5,'Blocked member even before archival'],[6,'Blocked archived member'],[7,'Unrelated authenticated user']]){
   await check(name+' receives no game or membership data',async()=>assert.deepEqual(await call(id),{game:null,member:null}));
  }
  await check('Membership in one game grants no identity in another',async()=>assert.deepEqual(await call(1,101),{game:null,member:null}));
  await check('An unauthenticated caller is rejected with SQLSTATE 42501',async()=>{
   await assert.rejects(call(null,100,'anon'),error=>error.code==='42501');
  });
  await check('Platform admin without a roster row retains the existing contract',async()=>{
   const result=await call(8);assert.equal(result.game.id,uuid(100));assert.equal(result.member,null);
  });
  await check('Platform admin retains its explicit archive exception',async()=>{
   const result=await call(9);assert.equal(result.game.id,uuid(100));assert.equal(result.member.user_id,uuid(9));
  });
  await check('Unknown game returns the existing empty identity',async()=>assert.deepEqual(await call(8,999),{game:null,member:null}));
  if(patch){
   await check('Replacement preserves grants and can be reapplied without data changes',async()=>{
    const before=(await db.query("select md5(string_agg(row_to_json(m)::text,',' order by user_id)) as hash from public.game_members m")).rows[0].hash;
    await db.exec(read(patch));
    const after=(await db.query("select md5(string_agg(row_to_json(m)::text,',' order by user_id)) as hash from public.game_members m")).rows[0].hash;
    assert.equal(before,after);assert.equal((await call(1)).member.user_id,uuid(1));assert.deepEqual(await call(6),{game:null,member:null});
   });
   await check('The prior function can be restored and the reviewed patch reapplied',async()=>{
    await db.exec(definition(read('20261011002000_login_and_rls_stability.sql'),'public.get_my_game_identity'));
    assert.equal((await call(1)).member.user_id,uuid(1));
    assert.equal((await call(6)).game.id,uuid(100),'Restored definition must reproduce the original defect');
    await db.exec(read(patch));
    assert.deepEqual(await call(6),{game:null,member:null});
   });
  }
 }finally{await db.close();}
 console.log(`${passed} passed, ${failed} failed; isolated PostgreSQL, no live sessions or production mutations.`);
 if(failed)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
