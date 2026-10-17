/* No production writes. Tests the real municipal election migration in PGlite. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261018023000_municipal_mayor_full_turnout_finish.sql','utf8');
assert(sql.includes('not exists(')&&sql.includes('roster_archived_at is null'),'All active eligible residents must cast');
assert(sql.includes('private.finish_municipal_mayor_election_locked(e.id)'),'Automatic and manual closers use one existing tally');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'create schema auth;create schema private;create role authenticated;create role anon;',
   'create table actor(user_id uuid,is_teacher boolean);',
   'insert into actor values(null,false);',
   'create function auth.uid() returns uuid language sql stable as $a$select user_id from actor$a$;',
   'create function private.is_game_member(uuid) returns boolean language sql stable as $a$select user_id is not null from actor$a$;',
   'create function private.is_game_teacher(uuid) returns boolean language sql stable as $a$select is_teacher from actor$a$;',
   'create table game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz,role_title text);',
   'create table municipal_mayor_elections(id uuid primary key,game_id uuid,status text,winner_user_id uuid,closed_at timestamptz);',
   'create table municipal_mayor_candidates(id uuid primary key,election_id uuid,user_id uuid);',
   'create table municipal_mayor_ballots(id uuid primary key default gen_random_uuid(),election_id uuid,game_id uuid,voter_user_id uuid,candidate_id uuid,created_at timestamptz default now(),unique(election_id,voter_user_id));'
  ].join('\n'));
  await db.exec(sql);
  const actor=async(uid,teacher=false)=>db.query('update actor set user_id=$1,is_teacher=$2',[uid,teacher]);
  const init=async(n,members)=>{
   const game=id(n),vote=id(n+200),one=id(n*1000+400),two=id(n*1000+401);
   await db.query("insert into municipal_mayor_elections(id,game_id,status) values($1,$2,'open')",[vote,game]);
   await db.query('insert into municipal_mayor_candidates values($1,$2,$3),($4,$2,$5)',[one,vote,members[0],two,members[1]||members[0]]);
   for(const user of members)await db.query("insert into game_members values($1,$2,'student',null,null)",[game,user]);
   return {game,vote,one,two};
  };
  const cast=async(vote,candidate,user)=>{await actor(user);await db.query('select public.cast_municipal_mayor_ballot($1,$2)',[vote,candidate])};
  const status=async vote=>(await db.query('select status,winner_user_id from municipal_mayor_elections where id=$1',[vote])).rows[0];
  const x=await init(1,[id(10),id(11),id(12)]);
  await db.query("insert into game_members values($1,$2,'observer',null,null),($1,$3,'student',now(),null)",[x.game,id(13),id(14)]);
  await cast(x.vote,x.one,id(10));
  assert.equal((await status(x.vote)).status,'open','One of three cannot close');
  await cast(x.vote,x.one,id(11));
  assert.equal((await status(x.vote)).status,'open','Two of three cannot close');
  await cast(x.vote,x.two,id(12));
  assert.equal((await status(x.vote)).status,'finished','Last active resident finalizes');
  assert.equal((await status(x.vote)).winner_user_id,id(10),'Original plurality winner preserved');
  assert.equal((await db.query("select role_title from game_members where game_id=$1 and user_id=$2",[x.game,id(10)])).rows[0].role_title,'Глава города Барнаула');
  let blocked=false;try{await cast(x.vote,x.two,id(12))}catch(e){blocked=true}assert(blocked,'Late ballot is blocked');

  const y=await init(2,[id(20),id(21)]);
  await cast(y.vote,y.one,id(20));await cast(y.vote,y.two,id(21));
  assert.equal((await status(y.vote)).status,'tie','Existing tie result preserved at full turnout');
  const z=await init(3,[id(30),id(31)]);
  await cast(z.vote,z.one,id(30));
  await actor(id(99),true);
  await db.query('select public.close_municipal_mayor_election($1)',[z.vote]);
  assert.equal((await status(z.vote)).status,'finished','Teacher manual closure remains available');

  const all=Array.from({length:40},(_,i)=>id(100+i));
  const big=await init(4,all);
  for(let i=0;i<39;i++)await cast(big.vote,big.one,all[i]);
  assert.equal((await status(big.vote)).status,'open','39 out of 40 is insufficient');
  await cast(big.vote,big.one,all[39]);
  assert.equal((await status(big.vote)).status,'finished','40th eligible ballot closes');
  assert.equal((await db.query('select count(*)::int n from municipal_mayor_ballots where election_id=$1',[big.vote])).rows[0].n,40);
  console.log('PASS municipal automatic close: eligible vs observer/archived, plurality, tie, teacher manual, final ballot of forty.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
