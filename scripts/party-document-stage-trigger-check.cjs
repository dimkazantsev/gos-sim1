/* Real shared stage trigger, document RLS/version guard and invitation RPCs in
   isolated PostgreSQL. --before reproduces the deployed composite-type failure. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migrations=path.join(__dirname,'../supabase/migrations');
const read=name=>fs.readFileSync(path.join(migrations,name),'utf8');
function definition(sql,name){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const match=sql.match(new RegExp('create or replace function '+escaped+'\\s*\\([\\s\\S]*?\\bas\\s+(\\$[a-z_0-9]*\\$)[\\s\\S]*?\\1\\s*;','i'));
 assert(match,'Production function exists: '+name);return match[0];
}
function policy(sql,name){const match=sql.match(new RegExp('create policy '+name+'\\b[\\s\\S]*?;','i'));assert(match,'Production policy exists: '+name);return match[0]}
const fixFiles=fs.readdirSync(migrations).filter(n=>n.endsWith('_party_document_stage_trigger_composite_scope.sql'));
const before=process.argv.includes('--before');
const baseline=fs.readdirSync(migrations).filter(n=>n.endsWith('.sql')&&!fixFiles.includes(n)).sort().reverse().find(n=>/create or replace function private\.guard_stage_submission\(/i.test(read(n)));
assert(baseline,'Latest existing shared stage guard found');
if(!before)assert.equal(fixFiles.length,1,'Exactly one corrective migration is required');
const guard=definition(read(before?baseline:fixFiles[0]),'private.guard_stage_submission');
const consent=read('20261014072000_stage_one_party_consent_and_gate.sql');
const versions=read('20261015211500_party_registration_versions_and_privacy.sql');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [game,party,otherParty,owner,teacher,other,archived,observer,target]=[1,2,3,4,5,6,7,8,9].map(id);
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create schema auth;create schema private;create role authenticated;create role anon;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table games(id uuid primary key,status text,turn_open boolean,turn_ends_at timestamptz);
   create table game_members(game_id uuid,user_id uuid,kind text,team text,roster_archived_at timestamptz,party_joined_at timestamptz);
   create table game_stages(game_id uuid,stage_no integer,status text,deadline timestamptz);
   create table game_parties(id uuid primary key,game_id uuid,name text,registration_status text,leader_user_id uuid);
   create table party_documents(id uuid primary key default gen_random_uuid(),game_id uuid,party_id uuid,doc_kind text,title text,storage_path text,file_name text,mime_type text,file_size bigint,uploaded_by uuid,status text,note text,created_at timestamptz default now(),version_no integer);
   create table party_invitations(id uuid primary key default gen_random_uuid(),game_id uuid,party_id uuid,invited_user_id uuid,invited_by uuid,status text default 'pending',created_at timestamptz default now(),responded_at timestamptz);
   create table formal_documents(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no integer,doc_type text,subject_key text,metadata jsonb,title text);
   create table chat_channels(id uuid,game_id uuid,kind text,name text);
   create table channel_members(channel_id uuid,user_id uuid);
   create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from game_members where game_id=g and user_id=auth.uid() and kind='teacher' and roster_archived_at is null)$$;
   create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from game_members where game_id=g and user_id=auth.uid() and roster_archived_at is null)$$;
   create function private.has_open_duma_mandate_vote(uuid) returns boolean language sql as $$select false$$;
   create function private.rebalance_party_mandates(uuid) returns void language sql as $$select$$;
   create function private.can_remediate_stage_final_document(uuid,integer,uuid,text,text,jsonb) returns boolean language sql as $$select false$$;
   create function private.stage4_legal_act_can_finalize(public.formal_documents,public.formal_documents,uuid) returns boolean language sql as $$select coalesce(($2.metadata->>'test_allow_legal')::boolean,false)$$;
   create function private.can_reapprove_returned_gd_minutes(public.formal_documents,public.formal_documents,uuid) returns boolean language sql as $$select coalesce(($2.metadata->>'test_allow_minutes')::boolean,false)$$;
   insert into games values('${game}','running',true,null);
   insert into game_stages values('${game}',1,'open',null),('${game}',4,'completed',null);
   insert into game_parties values('${party}','${game}','Партия А','draft','${owner}'),('${otherParty}','${game}','Партия Б','draft','${other}');
   insert into game_members values('${game}','${owner}','student','Партия А',null,null),('${game}','${teacher}','teacher',null,null,null),('${game}','${other}','student','Партия Б',null,null),('${game}','${archived}','student','Партия А',now(),null),('${game}','${observer}','observer','Партия А',null,null),('${game}','${target}','student',null,null,null);
   alter table party_documents enable row level security;alter table party_invitations enable row level security;alter table formal_documents enable row level security;
   grant usage on schema public,private,auth to authenticated;
   grant select on games,game_members,game_stages,game_parties,formal_documents,party_documents,party_invitations to authenticated;
   grant insert on party_documents,formal_documents to authenticated;grant update on formal_documents to authenticated;
   create policy formal_fixture_access on formal_documents for all to authenticated using(private.is_game_member(game_id)) with check(private.is_game_member(game_id));`);
  for(const name of ['private.stage_one_party_active','private.enforce_party_dossier_stage','public.invite_to_party','public.respond_party_invitation'])await db.exec(definition(consent,name));
  for(const name of ['private.party_document_version_guard','private.latest_party_document_version'])await db.exec(definition(versions,name));
  for(const name of ['party_documents_insert','party_documents_read'])await db.exec(policy(versions,name));
  await db.exec(policy(read('016_party_invitations_mandates_and_ghost_voting.sql'),'party_invitations_read'));
  await db.exec(guard);
  await db.exec(`create trigger enforce_party_dossier_stage before insert on party_documents for each row execute function private.enforce_party_dossier_stage();
   create trigger guard_party_documents_stage before insert or delete on party_documents for each row execute function private.guard_stage_submission();
   create trigger party_documents_version_guard before insert or update on party_documents for each row execute function private.party_document_version_guard();
   create trigger guard_party_invitations_stage before insert or update of status on party_invitations for each row execute function private.guard_stage_submission();
   create trigger guard_formal_documents_stage before insert or update on formal_documents for each row execute function private.guard_stage_submission();`);
  async function asUser(uid,sql,args=[]){
   await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);await db.exec('set local role authenticated');const result=await db.query(sql,args);await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
  }
  const document=(uid=owner,p=party)=>asUser(uid,"insert into party_documents(game_id,party_id,doc_kind,title,storage_path,file_name,uploaded_by,status) values($1,$2,'program','Программа','already-uploaded.pdf','program.pdf',$3,'submitted') returning id,version_no",[game,p,uid]);
  const denied=promise=>assert.rejects(promise,error=>error.code==='42501');
  const first=(await document()).rows[0];assert(first.id);assert.equal(first.version_no,1);
  await db.query('update game_parties set leader_user_id=null where id=$1',[party]);
  assert.equal((await document()).rows[0].version_no,2,'Documents remain available during chair election');
  assert.equal((await document(teacher)).rows[0].version_no,3,'Teacher upload returns registered document metadata');
  for(const who of [other,archived,observer,id(99)])await denied(document(who));
  await denied(document(owner,otherParty));
  assert.equal((await asUser(other,'select * from party_documents')).rows.length,0,'Other parties cannot read private submissions');
  const invitation=(await asUser(owner,'select public.invite_to_party($1,$2) id',[party,target])).rows[0].id;
  assert(invitation,'Actual invitation RPC inserts with the party_invitations composite');
  await asUser(target,'select public.respond_party_invitation($1,true)',[invitation]);
  assert.equal((await db.query('select status from party_invitations where id=$1',[invitation])).rows[0].status,'accepted');
  const formal=(await asUser(owner,"insert into formal_documents(game_id,stage_no,doc_type,subject_key,metadata,title) values($1,1,'other','gd','{}','Открытый этап') returning id",[game])).rows[0].id;
  assert.equal((await asUser(owner,"update formal_documents set title='Обновлено' where id=$1 returning id",[formal])).rows.length,1);
  for(const state of ["status='completed',deadline=null","status='open',deadline=now()-interval '1 second'"]){
   await db.exec('update game_stages set '+state+' where stage_no=1');
   await denied(document());
   await denied(asUser(owner,"update formal_documents set title='Запрещено' where id=$1",[formal]));
  }
  await db.exec("update game_stages set status='open',deadline=null where stage_no=1");
  await db.exec('update games set turn_open=false');await denied(document());await db.exec('update games set turn_open=true');
  await db.query('update game_members set roster_archived_at=now() where user_id=$1',[owner]);
  assert.equal((await asUser(owner,"update formal_documents set title='Архив' where id=$1 returning id",[formal])).rows.length,0,'RLS hides formal documents from archived members');
  await db.query('update game_members set roster_archived_at=null where user_id=$1',[owner]);
  const closed=id(40);
  await db.query("insert into formal_documents values($1,$2,4,'other','gd','{}','Закрытый этап')",[closed,game]);
  for(const flag of ['test_allow_legal','test_allow_minutes']){
   assert.equal((await asUser(owner,'update formal_documents set metadata=$1::jsonb where id=$2 returning id',[JSON.stringify({[flag]:true}),closed])).rows.length,1,'Preserve formal-only exception '+flag);
  }
  await denied(asUser(owner,"update formal_documents set metadata='{}' where id=$1",[closed]));
  await denied(asUser(owner,"insert into formal_documents(game_id,stage_no,doc_type,metadata) values($1,4,'other','{\"test_allow_legal\":true}')",[game]));
  await db.query("update game_parties set registration_status='registered' where id=$1",[party]);
  await denied(document());await denied(document(teacher));
  assert.equal((await db.query('select count(*)::int n from party_documents')).rows[0].n,3,'Rejected writes create no phantom document versions');
  console.log('PASS: authenticated student/teacher document INSERT+RETURNING before chair, real RLS/versioning, invitation INSERT+UPDATE RPCs, open-stage formal writes, closed/expired/paused/member guards, both typed formal-update exceptions, registered-party lock.');
 }finally{await db.close()}
})().catch(error=>{console.error(error.code||'',error.stack||error.message);process.exitCode=1});
