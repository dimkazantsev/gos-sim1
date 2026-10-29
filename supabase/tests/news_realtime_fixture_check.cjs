'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {localOrigin,assertDisposable}=require('./news_realtime_disposable.cjs');
assert.equal(localOrigin('http://127.0.0.1:54321'),'http://127.0.0.1:54321');
for(const url of ['https://example.supabase.co','http://user:password@localhost:54321','http://localhost:54321/path'])assert.throws(()=>localOrigin(url));
assert.throws(()=>assertDisposable({}),/disposable/i);
(async()=>{
 const db=new PGlite();
 try{
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create publication supabase_realtime;");
  await db.exec(fs.readFileSync('supabase/tests/news_realtime_fixture.sql','utf8'));
  const game='11111111-1111-4111-8111-111111111111',otherGame='22222222-2222-4222-8222-222222222222';
  const users=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
  await db.exec(`insert into public.qa_news_members(game_id,user_id,kind) values ('${game}','${users[0]}','student'),('${game}','${users[1]}','teacher'),('${game}','${users[2]}','student'),('${otherGame}','${users[3]}','student'); insert into public.media_news_proposals(id,game_id,author_id,status,title) values ('33333333-3333-4333-8333-333333333333','${game}','${users[0]}','pending','Synthetic QA');`);
  await db.exec('set role authenticated');
  for(const [i,expected] of [1,1,0,0].entries()){
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[i]]);
   assert.equal((await db.query('select count(*)::integer as n from public.media_news_proposals')).rows[0].n,expected,'RLS reader '+i);
  }
  await assert.rejects(db.exec("insert into public.media_news_proposals(id,game_id,author_id,status,title) values ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pending','Forbidden')"));
 }finally{await db.close()}
 for(const scenario of ['existing-user','existing-game']){
  const guarded=new PGlite();
  try{
   await guarded.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid); create publication supabase_realtime;');
   if(scenario==='existing-user')await guarded.exec("insert into auth.users values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')");
   else await guarded.exec('create table public.games(id uuid)');
   await assert.rejects(guarded.exec(fs.readFileSync('supabase/tests/news_realtime_fixture.sql','utf8')),/must be empty/);
   assert.equal((await guarded.query("select to_regclass('public.qa_news_disposable_guard') as name")).rows[0].name,null);
  }finally{await guarded.close()}
 }
 console.log('PASS: isolated synthetic news fixture RLS and local-only guard; PGlite only, no WebSocket delivery or load measurement.');
})().catch(error=>{console.error(error);process.exitCode=1});
