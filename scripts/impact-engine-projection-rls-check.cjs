/* Impact rules/ledger read projection: isolated PGlite RLS and 10-row cap.
 * No production database requests, no mutation of score or game data. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261029144000_impact_engine_projection_invoker.sql'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261031165000_impact_ledger_ten_projection.sql'),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=id(900),other=id(901);
assert(sql.includes('security invoker')&&!sql.includes('security definer'),'Projection must not bypass RLS');
assert(sql.includes('private.is_game_member(p_game_id)'),'Foreign game access must be forbidden');
assert(sql.includes('revoke all on function public.get_impact_engine_projection(uuid) from public, anon'),'Anon must not execute');
assert(sql.includes('limit 10'),'Latest ledger projection must cap the result at ten');
async function main(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,kind text,primary key(game_id,user_id));");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid())$$;");
  await db.exec("create table public.impact_rules(id uuid,game_id uuid,rule_key text,priority int,enabled boolean,effects jsonb,conditions jsonb);");
  await db.exec("create table public.impact_ledger(id bigserial primary key,game_id uuid,rule_id uuid,rule_key text,created_at timestamptz,effects jsonb,status text);");
  for(const table of ['impact_rules','impact_ledger']){
   await db.exec('alter table public.'+table+' enable row level security;');
   await db.exec('create policy read_scoped on public.'+table+' for select to authenticated using(private.is_game_member(game_id));');
  }
  await db.exec("grant usage on schema public,auth,private to authenticated;grant usage on schema public to anon;grant execute on function auth.uid(),private.is_game_member(uuid) to authenticated;grant select on all tables in schema public to authenticated;");
  for(let i=1;i<=42;i++)await db.query('insert into public.game_members values($1,$2,$3)',[game,id(i),i===41?'teacher':i===42?'observer':'student']);
  await db.query("insert into public.impact_rules values($1,$2,'education',20,true,'{\"score\":2}'::jsonb,'{}'::jsonb),($3,$4,'budget',10,false,'{\"score\":-1}'::jsonb,'{}'::jsonb),($5,$6,'other',5,true,'{}'::jsonb,'{}'::jsonb)",[id(10),game,id(11),game,id(12),other]);
  await db.query("insert into public.impact_ledger(game_id,rule_id,rule_key,created_at,effects,status) select $1,$2,'education','2026-10-01'::timestamptz + n*interval '1 minute','{\"score\":2}'::jsonb,'applied' from generate_series(1,620) n",[game,id(10)]);
  await db.query("insert into public.impact_ledger(game_id,rule_id,rule_key,created_at,effects,status) values($1,$2,'other','2026-10-30'::timestamptz,'{}'::jsonb,'applied')",[other,id(12)]);
  await db.exec(sql);
  async function as(n){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');}
  async function projection(g=game){return(await db.query('select public.get_impact_engine_projection($1) v',[g])).rows[0].v;}
  for(let i=1;i<=42;i++){
   await as(i);const data=await projection();
   assert.deepEqual(data.rules.map(r=>r.rule_key),['budget','education'],'Rule priority preserved for role '+i);
   assert.equal(data.rules[0].enabled,false,'Preserve disabled rule');
   assert.equal(data.ledger.length,10,'Ledger returns exactly newest 10 for role '+i);
   assert(data.ledger[0].created_at>data.ledger[9].created_at,'Newest-first order preserved');
   assert(data.ledger.every(r=>r.game_id===game),'No foreign ledger rows');
   assert.equal(data.ledger[0].effects.score,2,'Original effect values unchanged');
   assert.equal(data.rules[1].effects.score,2,'Rule effect left unchanged');
  }
  await as(1);await assert.rejects(projection(other),e=>e.code==='42501','Foreign game access denied');
  await as(null);await assert.rejects(projection(),e=>e.code==='42501','Missing JWT denied');
  await db.exec('reset role');await db.exec('set role anon');await assert.rejects(projection(),e=>e.code==='42501','Anon execution denied');
  console.log('PASS: 40 students + teacher + observer; 10 latest ledger rows, rule priority, original effects, cross-game/anon/JWT denied (PGlite)');
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
