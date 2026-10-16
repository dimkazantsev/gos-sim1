/* Real INSERT/UPDATE Storage policies under RLS in isolated PostgreSQL.
   --before replays the production policies that rejected the reported JPG. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [game,foreignGame,party,otherParty,teacher,owner,outsider,archived,observer]=[1,2,3,4,5,6,7,8,9].map(id);
const read=p=>fs.readFileSync(p,'utf8');
function policy(sql,verb,name){const match=sql.match(new RegExp(verb+' policy '+name+'\\b[\\s\\S]*?;','i'));assert(match,'Policy exists: '+name);return match[0]}
async function main(){
 const db=new PGlite();
 try{
  await db.exec(`create schema auth;create schema private;create schema storage;create role authenticated;create role anon;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table game_parties(id uuid primary key,game_id uuid,name text,registration_status text);
   create table game_members(game_id uuid,user_id uuid,kind text,team text,roster_archived_at timestamptz);
   create table party_documents(party_id uuid,game_id uuid,storage_path text,status text,doc_kind text,version_no int);
   create table formal_documents(game_id uuid,doc_type text,metadata jsonb);
   create table formal_document_signatures(game_id uuid,signature_path text);
   create table storage.objects(bucket_id text,name text primary key,metadata jsonb default '{}');
   alter table storage.objects enable row level security;
   grant usage on schema public,private,auth,storage to authenticated,anon;
   grant select on all tables in schema public,storage to authenticated,anon;
   grant insert,update on storage.objects to authenticated,anon;
   create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from game_members where game_id=g and user_id=auth.uid() and roster_archived_at is null)$$;
   create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from game_members where game_id=g and user_id=auth.uid() and kind='teacher' and roster_archived_at is null)$$;
   create function private.is_game_observer(g uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from game_members where game_id=g and user_id=auth.uid() and kind='observer')$$;
   create function private.latest_party_document_version(p uuid,k text) returns int language sql stable security definer set search_path=public,pg_temp as $$select max(version_no) from party_documents where party_id=p and doc_kind=k$$;
   insert into game_parties values('${party}','${game}','Новая перспектива','submitted'),('${otherParty}','${game}','Другая партия','submitted');
   insert into game_members values('${game}','${teacher}','teacher',null,null),('${game}','${owner}','student','Новая перспектива',null),('${foreignGame}','${outsider}','student','Иная партия',null),('${game}','${archived}','student','Новая перспектива',now()),('${game}','${observer}','observer','Новая перспектива',null);
  `);
  await db.exec(policy(read('supabase/migrations/20261016010000_registered_party_program_publication.sql'),'create','game_assets_read'));
  await db.exec(policy(read('supabase/migrations/20261015211500_party_registration_versions_and_privacy.sql'),'create','game_assets_party_insert'));
  await db.exec(policy(read('supabase/migrations/020_fix_game_asset_media_uploads.sql'),'create','game_assets_party_update'));
  await db.exec(policy(read('supabase/migrations/20261008121613_project_security_stability.sql'),'alter','game_assets_party_update'));
  if(!process.argv.includes('--before')){
   const migration=fs.readdirSync('supabase/migrations').find(p=>p.endsWith('_party_asset_upload_path_scope.sql'));
   if(migration)await db.exec(read('supabase/migrations/'+migration));
  }
  async function asUser(uid,query,args=[],role='authenticated'){
   await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid||'']);await db.exec('set local role '+role);const r=await db.query(query,args);await db.exec('commit');return r}catch(e){await db.exec('rollback');throw e}
  }
  const doc=(p,file)=>game+'/parties/'+p+'/docs/'+file;
  const insert=(uid,name,role)=>asUser(uid,"insert into storage.objects(bucket_id,name) values('game-assets',$1) returning name",[name],role);
  const first=doc(party,'application-v1.jpg');
  assert.equal((await insert(owner,first)).rows[0].name,first,'Student can upload the first JPG to their own party');
  await insert(owner,doc(party,'application-v2.pdf'));
  await insert(teacher,doc(party,'teacher-file.docx'));
  await assert.rejects(insert(owner,doc(otherParty,'foreign.pdf')),/row-level security/);
  for(const uid of [outsider,archived,observer])await assert.rejects(insert(uid,doc(party,uid+'.pdf')),/row-level security/);
  await assert.rejects(insert(null,doc(party,'anonymous.pdf'),'anon'),/row-level security/);
  await assert.rejects(insert(owner,foreignGame+'/parties/'+party+'/docs/cross-game.pdf'),/row-level security/);
  const logo=game+'/parties/'+party+'/logo.png';await insert(owner,logo);
  assert.equal((await asUser(owner,"update storage.objects set metadata='{\"version\":2}' where name=$1 returning name",[logo])).rows.length,1,'Logo upsert checks the actual Storage path');
  await assert.rejects(asUser(owner,'update storage.objects set name=$1 where name=$2',[game+'/parties/'+otherParty+'/logo.png',logo]),/row-level security/);
  await db.query("update game_parties set registration_status='registered' where id=$1",[party]);
  for(const uid of [owner,teacher])await assert.rejects(insert(uid,doc(party,'after-registration-'+uid+'.pdf')),/row-level security/);
  assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,4,'Rejected uploads leave no metadata');
  console.log('PASS actual Storage INSERT/UPDATE RLS: own-party JPG/PDF/DOCX, next version, teacher, logo upsert; other party/game, archived, observer, anonymous and registered-party uploads denied.');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
