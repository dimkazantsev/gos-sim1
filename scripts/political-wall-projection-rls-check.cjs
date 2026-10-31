/* Isolated political feed/RLS verification. Never calls production Supabase. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261029150000_political_wall_projection_invoker.sql'),'utf8');
const paging=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261031100000_metric_history_50_paging.sql'),'utf8');
const wallPages=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261031120000_political_wall_paged_projection.sql'),'utf8');
assert(wallPages.includes('security invoker')&&wallPages.includes('private.is_game_member(p_game_id)')&&wallPages.includes('limit 11'));
assert(wallPages.includes('m.post_id in (select id from page)')&&wallPages.includes('l.post_id in (select id from page)'));
assert(wallPages.includes('from public.political_posts p')&&wallPages.includes('revoke all on function public.get_political_wall_page'));
assert(paging.includes('security invoker')&&paging.includes('private.is_game_member(p_game_id)'));
assert(paging.includes('limit 50')&&!paging.includes('limit 3000'));
assert(paging.includes('order by recorded_at desc, id desc limit 50'));
assert(paging.includes("revoke all on function public.get_political_wall_projection(uuid) from public, anon"));
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
  await db.exec("create table public.political_posts(id uuid,game_id uuid,actor_key text,context jsonb,deleted_at timestamptz,created_at timestamptz,title text,source_key text,actor_label text,pinned boolean not null default false);");
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
  await db.query("insert into public.political_posts(id,game_id,actor_key,context,deleted_at,created_at,title,source_key,pinned) values($1,$2,'minjust',jsonb_build_object('party_id',$3::text),null,'2026-10-28','Private party registration','media-party-registration:foo',true)",[privatePost,game,party]);
  await db.query("insert into public.political_posts(id,game_id,actor_key,context,deleted_at,created_at,title,source_key) values($1,$2,'system','{}','2026-10-28','2026-10-28','Deleted post',null)",[deletedPost,game]);
  await db.query("insert into public.political_posts(id,game_id,actor_key,context,deleted_at,created_at,title,source_key) values($1,$2,'system','{}',null,'2026-10-28','Foreign post',null)",[id(105),other]);
  await db.query("insert into public.political_posts(id,game_id,actor_key,context,deleted_at,created_at,title,source_key) select ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,$1,'system','{}',null,'2026-10-01'::timestamptz+n*interval '1 minute','Published '||n,null from generate_series(1,260)n",[game]);
  await db.query("insert into public.political_post_media values($1,$2,$3,'2026-10-28')",[id(300),game,privatePost]);
  await db.query("insert into public.political_post_formal_links values($1,$2,$3)",[id(400),game,privatePost]);
  await db.query("insert into public.state_metric_history select ('00000000-0000-4000-8000-'||lpad((4000+n)::text,12,'0'))::uuid,$1,'2026-10-01'::timestamptz+n*interval '1 minute' from generate_series(1,3002)n",[game]);
  await db.query("insert into public.party_support_history select ('00000000-0000-4000-8000-'||lpad((8000+n)::text,12,'0'))::uuid,$1,'2026-10-01'::timestamptz+n*interval '1 minute' from generate_series(1,70)n",[game]);
  await db.query("insert into public.state_metrics values($1,$2,1,10)",[id(600),game]);
  await db.exec(sql);await db.exec(paging);await db.exec(wallPages);
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
   assert.equal(p.metric_history.length,50,'Only 50 newest metric rows in initial snapshot');
   assert.equal(p.support_history.length,50,'Only 50 newest party-support rows in initial snapshot');
   assert.equal(p.metric_history[0].id,id(6953),'Older 2952 metric rows must stay in database, not in payload');
   assert.equal(p.metric_history.at(-1).id,id(7002),'Latest metric row must remain available');
   assert.equal(p.support_history[0].id,id(8021),'Support history must be newest first, chronologically delivered');
   assert.equal(p.support_history.at(-1).id,id(8070));
   assert.equal(p.metrics[0].value,10);
   assert.equal(p.media.length,1,'Media scope preserved (client filters by visible post)');
   assert.equal(p.formal_links.length,1);
  }
  // The new, nonbreaking RPC returns ten authorized posts and only media
  // belonging to those posts. The 250-post legacy RPC remains unchanged.
  async function readPage(g=game,cursor=null){
   const args=[g,cursor?cursor.pinned:null,cursor?cursor.created_at:null,cursor?cursor.id:null];
   return (await db.query('select public.get_political_wall_page($1,$2,$3,$4) value',args)).rows[0].value;
  }
  for(let n=1;n<=42;n++){
   await as(n);
   const first=await readPage();
   assert.equal(first.posts.length,10,'Initial server payload must include ten posts');
   assert.equal(first.has_more,true);
   assert.equal(first.total_posts,n===1||n===41?261:260);
   assert.equal(first.metric_history.length,50);
   assert.equal(first.support_history.length,50);
   assert.equal(first.posts.some(x=>x.id===privatePost),n===1||n===41);
   assert.equal(first.media.length,n===1||n===41?1:0,'No attachments for posts outside page/RLS');
   assert.equal(first.formal_links.length,n===1||n===41?1:0);
   const last=first.posts.at(-1);
   const second=await readPage(game,last);
   assert.equal(second.posts.length,10,'One more click = ten posts, not 250');
   assert.equal(second.metric_history.length,0,'History metrics should not repeat on each older page');
   assert.equal(second.support_history.length,0);
   assert(!second.posts.some(x=>first.posts.some(p=>p.id===x.id)),'Cursor pages cannot overlap');
   assert(!second.posts.some(x=>x.game_id!==game));
  }
  await as(2);await assert.rejects(readPage(other),e=>e.code==='42501','Cross-game page denied');
  await as(null);await assert.rejects(readPage(),e=>e.code==='42501','Anonymous page denied');
  await db.exec('reset role');await db.exec('set role anon');
  await assert.rejects(readPage(),e=>e.code==='42501','Anon cannot execute page function');
  await db.exec('reset role');await db.exec('set role authenticated');
  await as(2);await assert.rejects(read(other),e=>e.code==='42501','Foreign room rejected');
  await as(null);await assert.rejects(read(),e=>e.code==='42501','No JWT rejected');
  await db.exec('reset role');await db.exec('set role anon');
  await assert.rejects(read(),e=>e.code==='42501','Anon function permission denied');
  console.log('PASS: 40 student actors, teacher, observer; 250 posts, 50 most recent metric and support histories, private party news, deleted and foreign rows isolated; anon denied (PGlite)');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
