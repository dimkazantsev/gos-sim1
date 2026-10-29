/* ГОС.ID, шаг 2/9: изолированный контракт RLS-проекции реестра НПА.
 * Не обращается к рабочей базе и не меняет существующие записи.
 * 40 отдельных ролевых проверок — не нагрузочный тест 40 клиентов. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261029171500_formal_registry_projection_invoker.sql'),'utf8');
const client=fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=uuid(900),foreignGame=uuid(901),publicDoc=uuid(501),publicDoc2=uuid(502),privateDoc=uuid(503),foreignDoc=uuid(504);
assert(sql.includes('security invoker')&&!sql.includes('security definer'),'SECURITY INVOKER required');
assert(sql.includes('private.is_game_member(p_game_id)'),'Membership guard required');
assert(sql.includes('p_document_ids uuid[] default null'),'Partial document filter required');
assert(sql.includes('revoke all on function public.get_formal_registry_projection(uuid, uuid[]) from public, anon'),'Anon execution must be denied');
assert(client.includes("supabase.rpc('get_formal_registry_projection'"),'Client must call projection');
assert(client.includes("p_document_ids:ids??null"),'Partial refresh IDs must reach server');
assert(client.includes("['PGRST202','42883']"),'Only absent RPC may fall back');
assert(client.includes("setFormalHistory(previous=>(ids?"),'History merge contract must remain');
assert(client.includes("if(fd.data?.some(doc=>doc.status_code==='published'"),'Published budget document synchronization must remain');

async function main(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,kind text,primary key(game_id,user_id));");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid())$$;");
  await db.exec("create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid() and m.kind='teacher')$$;");
  await db.exec("create table public.formal_documents(id uuid primary key,game_id uuid,stage_no int,registry_no text,title text,doc_type text,author_id uuid,body_text text,status_code text,source_file_path text,metadata jsonb,created_at timestamptz,updated_at timestamptz);");
  await db.exec("create table public.formal_document_history(id bigserial primary key,document_id uuid,game_id uuid,actor_id uuid,action text,note text,created_at timestamptz);");
  await db.exec("alter table public.formal_documents enable row level security;alter table public.formal_document_history enable row level security;");
  // Reproduce two-table RLS separation including a private-document scenario.
  // Actual production policy is more detailed, checked separately against Supabase.
  await db.exec("create policy docs_read on public.formal_documents for select to authenticated using(private.is_game_member(game_id) and (doc_type<>'justice_response' or private.is_game_teacher(game_id) or author_id=auth.uid()));");
  await db.exec("create policy history_read on public.formal_document_history for select to authenticated using(private.is_game_member(game_id));");
  await db.exec("grant usage on schema public,auth,private to authenticated;grant usage on schema public to anon;");
  await db.exec("grant execute on function auth.uid(),private.is_game_member(uuid),private.is_game_teacher(uuid) to authenticated;");
  await db.exec("grant select on public.formal_documents,public.formal_document_history to authenticated;");
  for(let i=1;i<=42;i++)await db.query("insert into public.game_members values($1,$2,$3)",[game,uuid(i),i===41?'teacher':i===42?'observer':'student']);
  await db.query("insert into public.game_members values($1,$2,'teacher')",[foreignGame,uuid(43)]);
  for(const [id,g,title,type,owner,order] of [
   [publicDoc,game,'Official law','law',uuid(1),1],
   [publicDoc2,game,'Published budget','budget',uuid(2),2],
   [privateDoc,game,'Limited access','justice_response',uuid(1),3],
   [foreignDoc,foreignGame,'Other session law','law',uuid(43),4]
  ]){
   await db.query("insert into public.formal_documents values($1,$2,12,$3,$4,$5,$6,'text','published',null,'{}'::jsonb,'2026-10-01'::timestamptz,'2026-10-01'::timestamptz+$7*interval '1 minute')",[id,g,'REG-'+order,title,type,owner,order]);
   await db.query("insert into public.formal_document_history(document_id,game_id,actor_id,action,note,created_at) values($1,$2,$3,'created','no change','2026-10-01'::timestamptz+$4*interval '1 minute')",[id,g,owner,order]);
  }
  await db.exec(sql);
  async function as(n){
   await db.exec('reset role');
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uuid(n):'']);
   await db.exec('set role authenticated');
  }
  async function get(g=game,ids=null){
   return (await db.query('select public.get_formal_registry_projection($1,$2::uuid[]) snapshot',[g,ids])).rows[0].snapshot;
  }
  await as(41);
  const teacher=await get();
  assert.deepEqual(teacher.documents.map(x=>x.id),[privateDoc,publicDoc2,publicDoc],'Teacher document ordering/visibility preserved');
  assert.equal(teacher.history.length,3,'Teacher sees all in-game history');
  assert.equal(teacher.documents[0].body_text,'text','Document body unchanged');
  const focused=await get(game,[publicDoc2]);
  assert.deepEqual(focused.documents.map(x=>x.id),[publicDoc2],'Only selected document returned');
  assert.deepEqual(focused.history.map(x=>x.document_id),[publicDoc2],'Only selected history returned');
  const empty=await get(game,[]);
  assert.deepEqual(empty.documents,[],'Empty ID array must not become full refresh');
  assert.deepEqual(empty.history,[]);
  await assert.rejects(get(foreignGame),e=>e.code==='42501','Other game denied');
  for(let i=1;i<=40;i++){
   await as(i);
   const view=await get();
   assert.equal(view.documents.length,i===1?3:2,'Original RLS visibility respected for student '+i);
   assert.equal(view.history.length,3,'Independent original history policy respected');
   assert(view.documents.every(x=>x.game_id===game),'No cross-game documents');
  }
  await as(42);
  const observer=await get();
  assert.equal(observer.documents.length,2,'Observer sees only table RLS-visible documents');
  assert.equal(observer.history.length,3,'History RLS unchanged');
  await as(null);
  await assert.rejects(get(),e=>e.code==='42501','No JWT denied');
  await db.exec('reset role');await db.exec('set role anon');
  await assert.rejects(get(),e=>e.code==='42501','Anonymous execution denied');
  console.log('PASS: 40 students, teacher, observer; full/partial/empty; RLS, ordering, body, foreign game and anon (PGlite)');
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
