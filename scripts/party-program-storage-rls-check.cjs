/* Execute the publication migration against an isolated PostgreSQL engine.
 * All people, files and games below are fixtures; production is never written. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [game,otherGame,party,draftParty,teacher,owner,member,outsider]=[1,2,3,4,5,6,7,8].map(id);
async function main(){
 const db=new PGlite();
 try{
 await db.exec(`
 create schema auth; create schema private; create schema storage;
 create role authenticated; create role anon;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.game_parties(id uuid primary key,game_id uuid,name text,leader_user_id uuid,ideology text,registration_status text);
 create table public.game_members(game_id uuid,user_id uuid,kind text,team text,roster_archived_at timestamptz);
 create table public.party_documents(id uuid primary key,game_id uuid,party_id uuid,storage_path text,status text,doc_kind text,version_no int);
 create table public.formal_documents(id uuid primary key,game_id uuid,doc_type text,metadata jsonb);
 create table public.formal_document_signatures(game_id uuid,signature_path text);
 create table public.political_posts(id uuid primary key,game_id uuid,actor_key text,source_key text,body text,context jsonb,deleted_at timestamptz);
 create table public.political_post_media(post_id uuid,storage_path text);
 create table storage.objects(bucket_id text,name text primary key);
 alter table storage.objects enable row level security;
 grant usage on schema public,private,auth,storage to authenticated,anon;
 grant select on all tables in schema public,storage to authenticated,anon;
 create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from game_members where game_id=g and user_id=auth.uid() and roster_archived_at is null)$$;
 create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from game_members where game_id=g and user_id=auth.uid() and kind='teacher' and roster_archived_at is null)$$;
 create function private.latest_party_document_version(p uuid,k text) returns integer language sql stable security definer set search_path=public,pg_temp as $$select max(version_no) from party_documents where party_id=p and doc_kind=k$$;
 insert into game_parties values('${party}','${game}','Партия А','${owner}','Позиция','registered'),('${draftParty}','${game}','Партия Б','${member}','Позиция','submitted');
 insert into game_members values('${game}','${teacher}','teacher',null,null),('${game}','${owner}','student','Партия А',null),('${game}','${member}','student','Партия Б',null),('${otherGame}','${outsider}','student','Партия В',null);
 insert into formal_documents values('${id(20)}','${game}','party_certificate','{"party_id":"${party}"}');
 insert into party_documents values
 ('${id(21)}','${game}','${party}','${game}/parties/${party}/docs/program-v1.pdf','accepted','program',1),
 ('${id(22)}','${game}','${party}','${game}/parties/${party}/docs/program-v2.pdf','accepted','program',2),
 ('${id(23)}','${game}','${draftParty}','${game}/parties/${draftParty}/docs/private.pdf','submitted','program',1);
 insert into storage.objects values
 ('game-assets','${game}/parties/${party}/docs/program-v1.pdf'),
 ('game-assets','${game}/parties/${party}/docs/program-v2.pdf'),
 ('game-assets','${game}/parties/${draftParty}/docs/private.pdf'),
 ('game-assets','${game}/profiles/${owner}/signature-private.png'),
 ('game-assets','${game}/shared/public.png'),
 ('game-assets','${otherGame}/shared/foreign.png');
 insert into political_posts values
 ('${id(30)}','${game}','media','media-party-registration:fixture',E'Партия зарегистрирована.\\nРегиональные отделения: 90\\nСвидетельство и официальный ответ Минюста приложены к публикации.','{"party_id":"${party}"}',null),
 ('${id(31)}','${game}','media','media-party-registration:uncertified','Региональные отделения: 90','{"party_id":"${draftParty}"}',null),
 ('${id(32)}','${game}','participant',null,'Региональные отделения: 90','{"party_id":"${party}"}',null);
 create policy game_assets_news_visibility on storage.objects for select to authenticated using(bucket_id<>'game-assets' or split_part(name,'/',2)<>'news');
 `);
 async function files(user,role='authenticated'){
  await db.exec('begin');
  try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);await db.exec('set local role '+role);return(await db.query('select name from storage.objects order by name')).rows.map(r=>r.name);}
  finally{await db.exec('rollback');}
 }
 const leaked=await files(outsider);assert(leaked.some(x=>x.endsWith('private.pdf')),'Fixture reproduces the old permissive Storage policy');
 const sql=fs.readFileSync('supabase/migrations/20261016010000_registered_party_program_publication.sql','utf8');
 await db.exec(sql);
 const teacherFiles=await files(teacher);assert.equal(teacherFiles.length,5);assert(!teacherFiles.some(x=>x.includes(otherGame)));
 const ownerFiles=await files(owner);assert(ownerFiles.some(x=>x.endsWith('program-v1.pdf')));assert(ownerFiles.some(x=>x.endsWith('program-v2.pdf')));assert(ownerFiles.some(x=>x.endsWith('signature-private.png')));assert(!ownerFiles.some(x=>x.endsWith('private.pdf')));
 const memberFiles=await files(member);assert(memberFiles.some(x=>x.endsWith('program-v2.pdf')));assert(!memberFiles.some(x=>x.endsWith('program-v1.pdf')));assert(memberFiles.some(x=>x.endsWith('private.pdf')));assert(!memberFiles.some(x=>x.endsWith('signature-private.png')));
 const outsideFiles=await files(outsider);assert.equal(outsideFiles.length,1);assert(outsideFiles[0].includes(otherGame));
 assert.deepEqual(await files(null,'anon'),[]);
 const news=(await db.query('select id,body,context from political_posts order by id')).rows;
 assert(!news[0].body.includes('Региональные отделения:'));assert(news[0].body.includes('Программа партии опубликована'));assert.deepEqual(news[0].context.party_document_ids,[id(22)]);
 assert.equal(news[1].body,'Региональные отделения: 90');assert.equal(news[2].body,'Региональные отделения: 90');
 console.log('PASS isolated PostgreSQL: teacher, own party, other party, foreign game and anonymous Storage access.');
 console.log('PASS: accepted latest programme public after certificate; old versions, drafts and unsigned signatures private; only certified automatic news amended.');
 }finally{await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
