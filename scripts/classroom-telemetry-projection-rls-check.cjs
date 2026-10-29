/* Step 2/9 — isolated, zero-production-I/O telemetry projection contract.
 * This verifies 40 students, teacher, observer, cross-game, anonymous access.
 * It is NOT a 40-client concurrency/load test. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261029162000_classroom_telemetry_projection_invoker.sql'),'utf8');
const client=fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=id(900),other=id(901);
assert(sql.includes('security invoker')&&!sql.includes('security definer'),'Original RLS must be enforced');
assert(sql.includes('private.is_game_teacher(p_game_id)'),'Only teacher/admin may read telemetry');
assert(sql.includes('limit 250'),'Existing activity cap must remain');
assert(sql.includes('revoke all on function public.get_classroom_telemetry_projection(uuid) from public, anon'),'Anonymous execution denied');
assert(client.includes("supabase.rpc('get_classroom_telemetry_projection',{p_game_id:gameId})"),'UI must call the projection');
assert(client.includes("['PGRST202','42883']"),'Only an absent RPC permits the legacy fallback');

async function main(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,kind text,primary key(game_id,user_id));");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid())$$;");
  await db.exec("create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid() and m.kind='teacher')$$;");
  await db.exec("create table public.game_activity(id bigserial primary key,game_id uuid,actor_id uuid,event_type text,label text,view_key text,payload jsonb,created_at timestamptz);");
  await db.exec("create table public.game_presence(game_id uuid,user_id uuid,current_view text,last_seen_at timestamptz,primary key(game_id,user_id));");
  for(const table of ['game_activity','game_presence'])await db.exec('alter table public.'+table+' enable row level security;');
  await db.exec("create policy activity_own_read on public.game_activity for select to authenticated using(actor_id=auth.uid() and private.is_game_member(game_id));");
  await db.exec("create policy activity_teacher_read on public.game_activity for select to authenticated using(private.is_game_teacher(game_id));");
  await db.exec("create policy presence_own_read on public.game_presence for select to authenticated using(user_id=auth.uid() and private.is_game_member(game_id));");
  await db.exec("create policy presence_teacher_read on public.game_presence for select to authenticated using(private.is_game_teacher(game_id));");
  await db.exec("grant usage on schema public,auth,private to authenticated;grant usage on schema public to anon;");
  await db.exec("grant execute on function auth.uid(),private.is_game_member(uuid),private.is_game_teacher(uuid) to authenticated;");
  await db.exec("grant select on public.game_activity,public.game_presence to authenticated;");
  for(let n=1;n<=42;n++)await db.query("insert into public.game_members values($1,$2,$3)",[game,id(n),n===41?'teacher':n===42?'observer':'student']);
  await db.query("insert into public.game_members values($1,$2,'teacher')",[other,id(43)]);
  await db.query("insert into public.game_activity(game_id,actor_id,event_type,label,view_key,payload,created_at) select $1,$2,'action','Audit entry','work','{}'::jsonb,'2026-10-01'::timestamptz + n*interval '1 minute' from generate_series(1,300) n",[game,id(1)]);
  await db.query("insert into public.game_activity(game_id,actor_id,event_type,label,view_key,payload,created_at) values ($1,$2,'action','Foreign','work','{}'::jsonb,now())",[other,id(43)]);
  for(let n=1;n<=42;n++)await db.query("insert into public.game_presence values($1,$2,'work','2026-10-02'::timestamptz + $3*interval '1 minute')",[game,id(n),n]);
  await db.query("insert into public.game_presence values($1,$2,'work',now())",[other,id(43)]);
  await db.exec(sql);
  async function as(n){
   await db.exec('reset role');
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);
   await db.exec('set role authenticated');
  }
  async function read(g=game){return (await db.query('select public.get_classroom_telemetry_projection($1) v',[g])).rows[0].v;}
  await as(41);
  const data=await read();
  assert.equal(data.activity.length,250,'Newest 250 activity rows only');
  assert.equal(data.activity[0].label,'Audit entry');
  assert(data.activity[0].created_at>data.activity[249].created_at,'Activity is newest-first');
  assert.equal(data.presence.length,42,'Teacher sees all 40 students, teacher and observer');
  assert(data.activity.every(row=>row.game_id===game),'No other room activity');
  assert(data.presence.every(row=>row.game_id===game),'No other room presence');
  await assert.rejects(read(other),error=>error.code==='42501','Teacher cannot read another game');
  for(let n=1;n<=40;n++){
   await as(n);
   await assert.rejects(read(),error=>error.code==='42501','Student must not access classroom projection');
  }
  await as(42);await assert.rejects(read(),error=>error.code==='42501','Observer denied');
  await as(null);await assert.rejects(read(),error=>error.code==='42501','No JWT denied');
  await db.exec('reset role');await db.exec('set role anon');
  await assert.rejects(read(),error=>error.code==='42501','Anon denied');
  console.log('PASS: RLS, 40 students+teacher+observer, 250-row cap, no foreign-game data (PGlite). No production load tested.');
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
