/* ГОС.ID: isolated RLS contract for combined pinned chat messages.
 * 40 role scenarios, not a concurrent load test; never contacts production. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const base=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(base,'supabase/migrations/20261029173000_chat_pins_projection_invoker.sql'),'utf8');
const hook=fs.readFileSync(path.join(base,'components/game/useRepublicGame.ts'),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const g=id(900),g2=id(901),publicChat=id(800),privateChat=id(801),otherChat=id(802);
assert(migration.includes('security invoker')&&!migration.includes('security definer'),'Public RPC must not bypass RLS');
assert(migration.includes('private.can_access_channel(p_channel_id)'),'Channel membership must be checked');
assert(migration.includes('limit 12'),'Do not load more than 12 pins');
assert(migration.includes('from public.chat_messages'),'Messages still queried under their own RLS');
assert(migration.includes('revoke all on function public.get_chat_pins_projection(uuid) from public, anon'),'Anon blocked');
assert(hook.includes("supabase.rpc('get_chat_pins_projection'"),'Client must use projection');
assert(hook.includes("['PGRST202','42883']"),'No unbounded fallback on overloaded requests');
assert(hook.includes("signedAssetUrl('game-media',m.storage_path)"),'Media signed URLs kept');
assert(hook.includes("if(readCurrent(ticket)&&channelRef.current===cid){setChatPins(pins);setPinnedMessages(media)}"),'Pinned view remains scoped');

async function main(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,kind text,primary key(game_id,user_id));");
  await db.exec("create table public.chat_channels(id uuid primary key,game_id uuid,kind text);");
  await db.exec("create table public.channel_members(channel_id uuid,user_id uuid);");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid())$$;");
  await db.exec("create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid() and m.kind='teacher')$$;");
  await db.exec("create function private.can_access_channel(c uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.chat_channels cc where cc.id=c and private.is_game_member(cc.game_id) and (cc.kind='public' or private.is_game_teacher(cc.game_id) or exists(select 1 from public.channel_members cm where cm.channel_id=cc.id and cm.user_id=auth.uid())))$$;");
  await db.exec("create table public.chat_pins(id uuid primary key,game_id uuid,channel_id uuid,message_id uuid,pinned_by uuid,pinned_at timestamptz);");
  await db.exec("create table public.chat_messages(id uuid primary key,game_id uuid,channel_id uuid,author_id uuid,kind text,text text,storage_path text,mime_type text,created_at timestamptz,voice_meta jsonb);");
  await db.exec("alter table public.chat_pins enable row level security;alter table public.chat_messages enable row level security;");
  await db.exec("create policy chat_pins_read on public.chat_pins for select to authenticated using(private.can_access_channel(channel_id));");
  await db.exec("create policy messages_read on public.chat_messages for select to authenticated using(private.can_access_channel(channel_id));");
  await db.exec("grant usage on schema public,auth,private to authenticated;grant usage on schema public to anon;");
  await db.exec("grant execute on function auth.uid(),private.is_game_member(uuid),private.is_game_teacher(uuid),private.can_access_channel(uuid) to authenticated;");
  await db.exec("grant select on public.chat_pins,public.chat_messages to authenticated;");
  for(let i=1;i<=42;i++)await db.query("insert into public.game_members values($1,$2,$3)",[g,id(i),i===41?'teacher':i===42?'observer':'student']);
  await db.query("insert into public.game_members values($1,$2,'teacher')",[g2,id(43)]);
  for(const [chat,game,kind] of [[publicChat,g,'public'],[privateChat,g,'private'],[otherChat,g2,'public']]){
   await db.query("insert into public.chat_channels values($1,$2,$3)",[chat,game,kind]);
  }
  await db.query("insert into public.channel_members values($1,$2)",[privateChat,id(1)]);
  for(let k=1;k<=15;k++){
   const msg=id(100+k),pin=id(200+k);
   await db.query("insert into public.chat_messages values($1,$2,$3,$4,'text',$5,null,null,'2026-10-20'::timestamptz+$6*interval '1 minute','{}'::jsonb)",[msg,g,publicChat,id(1),'message '+k,k]);
   await db.query("insert into public.chat_pins values($1,$2,$3,$4,$5,'2026-10-20'::timestamptz+$6*interval '1 minute')",[pin,g,publicChat,msg,id(1),k]);
  }
  for(const [chat,game,k] of [[privateChat,g,300],[otherChat,g2,301]]){
   await db.query("insert into public.chat_messages values($1,$2,$3,$4,'text','private',null,null,now(),'{}'::jsonb)",[id(k),game,chat,id(1)]);
   await db.query("insert into public.chat_pins values($1,$2,$3,$4,$5,now())",[id(k+200),game,chat,id(k),id(1)]);
  }
  await db.exec(migration);
  async function as(n,role='authenticated'){
   await db.exec('reset role');
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);
   await db.exec('set role '+role);
  }
  async function get(cid){return (await db.query("select public.get_chat_pins_projection($1) as snapshot",[cid])).rows[0].snapshot;}
  await as(41);
  const snapshot=await get(publicChat);
  assert.equal(snapshot.pins.length,12,'At most 12 pins');
  assert.equal(snapshot.messages.length,12,'Only messages referenced by the recent 12 pins');
  assert.equal(snapshot.pins[0].message_id,id(115),'Latest pin first');
  assert.equal(snapshot.pins[11].message_id,id(104),'Oldest returned pin correct');
  assert(snapshot.messages.every(x=>x.channel_id===publicChat),'No other channels');
  assert.equal((await get(privateChat)).messages.length,1,'Teacher sees private channel');
  await assert.rejects(get(otherChat),e=>e.code==='42501','Teacher cannot see another game');
  await as(1);
  assert.equal((await get(privateChat)).messages.length,1,'Invited student sees private channel');
  for(let n=1;n<=40;n++){
   await as(n);
   assert.equal((await get(publicChat)).pins.length,12,'Public channel accessible to game member '+n);
   if(n!==1)await assert.rejects(get(privateChat),e=>e.code==='42501','Non-invited student blocked '+n);
  }
  await as(42);
  assert.equal((await get(publicChat)).pins.length,12,'Observer can read public pins');
  await assert.rejects(get(privateChat),e=>e.code==='42501','Observer cannot read private channel');
  await as(43);
  await assert.rejects(get(publicChat),e=>e.code==='42501','Foreign game's teacher cannot read room');
  await as(null);
  await assert.rejects(get(publicChat),e=>e.code==='42501','No authenticated user');
  await as(null,'anon');
  await assert.rejects(get(publicChat),e=>e.code==='42501','Anonymous role denied');
  console.log('PASS: 40 students, teacher, guest; public/private/cross-game; 12-item bound, ordering, RLS, anonymous blocked (PGlite)');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
