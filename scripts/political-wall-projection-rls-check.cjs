/* Isolated political feed/RLS verification. Never calls production Supabase. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261029150000_political_wall_projection_invoker.sql'),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=id(900),other=id(901),privatePost=id(100),deletedPost=id(101),party=id(700);
assert(sql.includes('security invoker'),'Must obey full political posts RLS');
assert(sql.includes('private.is_game_member(p_game_id)'),'Server membership guard');
for(const marker of ['limit 250','limit 3000','revoke all on function public.get_political_wall_projection(uuid) from public, anon']){
 assert(sql.includes(marker),'Preserve cap/authorization: '+marker);
}
async function main(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,kind text,team text,roster_archived_at timestamptz);");
  await db.exec("create table public.game_parties(id uuid,game_id uuid,name text);");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.game_members where game_id=g and user_id=auth.uid())$$;");
  await db.exec("create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.game_members where game_id=g and user_id=auth.uid() and kind='teacher')$$;");
  await db.exec("create function private.party_registration_published(p uuid) returns boolean language sql stable as $$select false$$;");
  await db.exec("create table public.political_posts(id uuid,game_id uuid,actor_key text,context jsonb,deleted_at timestamptz,created_at timestamptz,title text,source_key text);");
  await db.exec("create table public.political_post_media(id uuid,game_id uuid,post_id uuid,created_at timestamptz);");
  await db.exec("create table public.political_post_formal_links(id uuid,game_id uuid,post_id uuid);");
  await db.exec("create table public.state_metric_history(id uuid,game_id uuid,recorded_at timestamptz);");
  await db.exec("create table public.party_support_history(id uuid,game_id uuid,recorded_at timestamptz);");
  await db.exec("create table public.state_metrics(id uuid,game_id uuid,sort_order int,value numeric);");
  for(const t of ['political_posts','political_post_media','political_post_formal_links','state_metric_history','party_support_history','state_metrics'])await db.exec('alter table public.'+t+' enable row level security;');
  await db.exec("create policy post_read on public.political_posts for select to authenticated using (deleted_at is null and private.is_game_member(game_id) and (actor_key is distinct from 'minjust' or not coalesce(context ? 'party_id',false) or private.is_game_teacher(game_id) or exists(select 1 from public.game_parties p where p.game_id=political_posts.game_id and p.id::text=context->>'party_id' and (private.party_registration_published(p.id) or exists(select 1 from public.game_members m where m.game_id=p.game_id and m.user_id=auth.uid() and m.kind='student' and m.team=p.name and m.roster_archived_at is null)))));");
  for(const t of ['political_post_media','political_post_formal_links','state_metric_history','party_support_history','state_metrics'])await db.exec('create policy scoped_read on public.'+t+' for select to authenticated using(private.is_game_member(game_id));');
  await db.exec("grant usage on schema public,private,auth to authenticated;grant usage on schema public to anon;grant select on all tables in schema public to authenticated;grant execute on function auth.uid() to authenticated;grant execute on function private.is_game_member(uuid),private.is_game_teacher(uuid),private.party_registration_published(uuid) to authenticated;");
  for(let n=1;n<=42;n++)await db.query('insert into public.game_members values($1,$2,$3,$4,null)',[game,id(n),n===41?'teacher':n===42?'observer':'student',n===1?'Alpha':'Beta']);
  await db.query("insert into public.game_parties values($1,$2,'Alpha')",[party,game]);
  await db.query("insert into public.political_posts values($1,$2,'minjust',jsonb_build_object('party_id',$3::text),null,'2026-10-28','Private party registration','media-party-registration:foo')",[privatePost,game,party]);
  await db.query("insert into public.political_posts values($1,$2,'system','{}','2026-10-28','2026-10-28','Deleted post',null)",[deletedPost,game]);
  await db.query("insert into public.political_posts values($1,$2,'system','{}',null,'2026-10-28','Foreign post',null)",[id(105),other]);
  await db.query("insert into public.political_posts select ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,$1,'system','{}',null,'2026-10-01'::timestamptz+n*interval '1 minute','Published '||n,null from generate_series(1,260)n",[game]);
  await db.query("insert into public.political_post_media values($1,$2,$3,'2026-10-28')",[id(300),game,privatePost]);
  await db.query("insert into public.political_post_formal_links values($1,$2,$3)",[id(400),game,privatePost]);
  await db.query("insert into public.state_metric_history select ('00000000-0000-4000-8000-'||lpad((4000+n)::text,12,'0'))::uuid,$1,'2026-10-01'::timestamptz+n*interval '1 minute' from generate_series(1,3002)n",[game]);
  await db.query("insert into public.party_support_history values($1,$2,'2026-10-01')",[id(500),game]);
  await db.query("insert into public.state_metrics values($1,$2,1,10)",[id(600),game]);
  await db.exec(sql);
  async function as(n){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');}
  async function read(g=game){return (await db.query('select public.get_political_wall_projection($1) value',[g])).rows[0].value;}
  for(let n=1;n<=42;n++){
   await as(n);const p=await read();
   assert.equal(Object.keys(p).length,6);
   assert.equal(p.posts.length,250,'Published feed remains capped at 250');
   const allowed=n===1||n===41;
   assert.equal(p.posts.some(x=>x.id===privatePost),allowed,'Private party registration visible only to own team or teacher');
   assert(!p.posts.some(x=>x.id===deletedPost),'Deleted posts never leak');
   assert(!p.posts.some(x=>x.game_id===other),'Foreign posts never leak');
   assert.equal(p.metric_history.length,3000,'History cap preserved');
   assert.equal(p.support_history.length,1);
   assert.equal(p.metrics[0].value,10);
   assert.equal(p.media.length,1,'Media scope preserved (client filters by visible post)');
   assert.equal(p.formal_links.length,1);
  }
  await as(2);await assert.rejects(read(other),e=>e.code==='42501','Foreign room rejected');
  await as(null);await assert.rejects(read(),e=>e.code==='42501','No JWT rejected');
  await db.exec('reset role');await db.exec('set role anon');
  await assert.rejects(read(),e=>e.code==='42501','Anon function permission denied');
  console.log('PASS: 40 student actors, teacher, observer; 250 posts, 3000 metric history, private party news, deleted and foreign rows isolated; anon denied (PGlite)');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
