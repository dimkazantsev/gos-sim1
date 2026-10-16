/* Execute the real document actions/loaders with delayed Storage, then the
   production SQL guards/RLS in isolated PostgreSQL. No production writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const tree=ts.createSourceFile('hook.ts',source,ts.ScriptTarget.Latest,true);
const wanted=new Set(['acceptPartyDocuments','loadPartyDocuments','uploadPartyDocument','reviewPartyDocument']);
const pieces=[];function visit(n){if(ts.isFunctionDeclaration(n)&&wanted.has(n.name?.text))pieces.push(n.getText(tree));ts.forEachChild(n,visit)}visit(tree);
assert.equal(pieces.length,4);
const code=ts.transpileModule(pieces.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const tick=()=>new Promise(r=>setImmediate(r));
function gate(){let resolve;return{promise:new Promise(r=>resolve=r),resolve}}
async function prompt(p){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Review metadata is blocked by Storage')),1500))])}finally{clearTimeout(timer)}}
async function actions(){
 const backend={docs:[{id:'v1',game_id:'game-a',party_id:'party-a',doc_kind:'program',title:'Программа',storage_path:'v1.pdf',version_no:1,status:'submitted',note:null}],writes:0};
 function client(teacher){
  let rows=[],version=0;const signing=gate(),errors=[],api={};
  const env={api,console,Promise,Map,crypto:require('node:crypto').webcrypto,teacher,gameId:'game-a',game:{id:'game-a'},me:{user_id:teacher?'teacher':'owner'},parties:[{id:'party-a',game_id:'game-a'}],
   setError:e=>errors.push(String(e)),setPartyDocuments:fn=>{rows=typeof fn==='function'?fn(rows):fn},
   readCurrent:t=>t.version===version,requireSuccessful:rs=>{const e=rs.find(r=>r.error)?.error;if(e)throw e},
   readSafely:async(_,fn)=>fn({version:++version}),notifyGameDataRefresh:()=>{},kickTelegramDispatch:async()=>{},
   supabase:{storage:{from:()=>({upload:async()=>({error:null}),createSignedUrl:async path=>{await signing.promise;return{data:{signedUrl:'https://files.invalid/'+path}}}})},from:()=>{
    const q={eqs:{},select(){return this},order(){return this},eq(k,v){this.eqs[k]=v;return this},in(k,v){this.allowed={k,v};return this},update(v){this.updateValue=v;return this},insert(v){this.insertValue=v;return this},single(){this.singleRow=true;return this},maybeSingle(){this.singleRow=true;return this},then(resolve,reject){try{
     let data=structuredClone(backend.docs.filter(d=>Object.entries(this.eqs).every(([k,v])=>d[k]===v)));
     if(this.updateValue){assert(teacher,'student cannot review');const row=data.find(d=>!this.allowed||this.allowed.v.includes(d[this.allowed.k]));data=row?Object.assign(backend.docs.find(d=>d.id===row.id),this.updateValue):null;if(data)backend.writes++;}
     if(this.insertValue){const v=this.insertValue,n=1+Math.max(0,...backend.docs.filter(d=>d.party_id===v.party_id&&d.doc_kind===v.doc_kind).map(d=>d.version_no));data={...v,id:'v'+n,version_no:n,note:null};backend.docs.push(data);backend.writes++;}
     resolve({data:structuredClone(data),error:null});
    }catch(e){reject(e)}}};return q;
   }}
  };
  vm.runInNewContext(code+'\nObject.assign(api,{loadPartyDocuments,uploadPartyDocument,reviewPartyDocument});',env);
  return{...api,get rows(){return rows},errors,release:()=>signing.resolve()};
 }
 const teacher=client(true),student=client(false);
 await prompt(teacher.loadPartyDocuments());await prompt(student.loadPartyDocuments());
 assert.equal(await prompt(teacher.reviewPartyDocument('v1','revision','Добавьте источники финансирования.')),true);
 await prompt(student.loadPartyDocuments());
 assert.equal(student.rows[0].status,'revision');assert.equal(student.rows[0].note,'Добавьте источники финансирования.');
 assert.equal(student.rows[0].url,null,'Status and remarks arrive before file links');
 assert.equal(await prompt(student.uploadPartyDocument('party-a','program','Программа',{name:'programme-v2.pdf',size:64,type:'application/pdf'})),true);
 assert.equal(student.rows.length,2);assert.equal(student.rows.find(d=>d.id==='v2').status,'submitted');
 await prompt(teacher.loadPartyDocuments());assert.equal(teacher.rows.find(d=>d.id==='v2').version_no,2);
 assert.equal(await teacher.reviewPartyDocument('v1','accepted'),false,'An already returned attempt cannot be reviewed again');
 assert(teacher.errors.some(e=>e.includes('уже рассмотрен')));
 assert.equal(await prompt(teacher.reviewPartyDocument('v2','accepted')),true);
 await prompt(student.loadPartyDocuments());
 assert.equal(student.rows.find(d=>d.id==='v2').status,'accepted');assert.equal(student.rows.find(d=>d.id==='v2').note,null);
 assert.equal(student.rows.find(d=>d.id==='v1').note,'Добавьте источники финансирования.','Historical remarks are retained');
 const before=backend.writes;assert.equal(await student.reviewPartyDocument('v2','revision','Замечание'),false);assert.equal(backend.writes,before);
 teacher.release();student.release();await tick();await tick();
 assert(student.rows.every(d=>d.url?.startsWith('https://files.invalid/')));
 assert.equal(student.rows.find(d=>d.id==='v2').status,'accepted','Late URL signing cannot restore an obsolete review');
 console.log('PASS actual hook actions: teacher return + note → student sees it before Storage → V2 upload → teacher accepts → student updates; old remarks retained.');
}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function sqlGuards(){
 const db=new PGlite(),[game,party,teacher,owner,other]=[1,2,3,4,5].map(id);
 try{
 await db.exec(`create schema private;create schema auth;create role authenticated;create role anon;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table game_parties(id uuid primary key,game_id uuid,name text,registration_status text);
 create table game_members(game_id uuid,user_id uuid,team text,kind text,roster_archived_at timestamptz);
 create table party_documents(id uuid primary key default gen_random_uuid(),game_id uuid,party_id uuid,doc_kind text,title text,storage_path text,file_name text,mime_type text,file_size bigint,uploaded_by uuid,status text,note text,created_at timestamptz default now());
 create table formal_documents(id uuid default gen_random_uuid(),game_id uuid,doc_type text,metadata jsonb);
 create table chat_channels(id uuid primary key,game_id uuid,kind text,name text);
 create table chat_messages(game_id uuid,channel_id uuid,author_id uuid,kind text,text text);
 create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from game_members where game_id=g and user_id=auth.uid() and kind='teacher')$$;
 create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from game_members where game_id=g and user_id=auth.uid() and roster_archived_at is null)$$;
 insert into game_parties values('${party}','${game}','Партия А','draft');
 insert into game_members values('${game}','${teacher}',null,'teacher',null),('${game}','${owner}','Партия А','student',null),('${game}','${other}','Партия Б','student',null);
 insert into chat_channels values('${id(6)}','${game}','team','Фракция · Партия А');
 `);
 const migration=fs.readFileSync('supabase/migrations/20261015211500_party_registration_versions_and_privacy.sql','utf8');
 await db.exec(migration.slice(0,migration.indexOf('-- Supabase Storage policies')));
 await db.exec(`alter table party_documents enable row level security;
 create policy party_documents_update on party_documents for update to authenticated using(private.is_game_teacher(game_id)) with check(private.is_game_teacher(game_id));
 grant usage on schema public,private,auth to authenticated;grant select on game_parties,game_members,formal_documents to authenticated;grant select,insert,update,delete on party_documents to authenticated;`);
 async function asUser(uid,query,args=[]){await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);await db.exec('set local role authenticated');const r=await db.query(query,args);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e}}
 const add=async kind=>(await asUser(owner,"insert into party_documents(game_id,party_id,doc_kind,title,storage_path,file_name,uploaded_by,status) values($1,$2,$3,$3,$3||'.pdf',$3||'.pdf',$4,'submitted') returning id,version_no",[game,party,kind,owner])).rows[0];
 const v1=await add('program');assert.equal(v1.version_no,1);
 await assert.rejects(asUser(teacher,"update party_documents set status='revision',note='' where id=$1",[v1.id]),/основание доработки/);
 await asUser(teacher,"update party_documents set status='revision',note='Добавьте источники финансирования.' where id=$1",[v1.id]);
 assert.equal((await asUser(owner,'select note from party_documents where id=$1',[v1.id])).rows[0].note,'Добавьте источники финансирования.');
 assert.equal((await asUser(other,'select * from party_documents')).rows.length,0,'Other parties cannot read returned drafts or remarks');
 assert.equal((await asUser(owner,"update party_documents set status='accepted' where id=$1 returning id",[v1.id])).rows.length,0,'Student cannot approve their own document');
 const v2=await add('program'),v3=await add('program');assert.equal(v2.version_no,2);assert.equal(v3.version_no,3);
 await assert.rejects(asUser(teacher,"update party_documents set status='accepted' where id=$1",[v2.id]),/последнюю версию/);
 await asUser(teacher,"update party_documents set status='accepted' where id=$1",[v3.id]);
 await assert.rejects(asUser(teacher,"update party_documents set title='Переписанная история' where id=$1",[v1.id]),/История попыток неизменяема/);
 await assert.rejects(db.query("update game_parties set registration_status='registered' where id=$1",[party]),/Последние версии документов не приняты/);
 for(const kind of ['application','charter','fee','symbol','congress_minutes']){const d=await add(kind);await asUser(teacher,"update party_documents set status='accepted' where id=$1",[d.id]);}
 await db.query("update game_parties set registration_status='registered' where id=$1",[party]);
 assert.equal((await asUser(other,'select * from party_documents')).rows.length,0,'Certificate is required before publication');
 await db.query("insert into formal_documents(game_id,doc_type,metadata) values($1,'party_certificate',jsonb_build_object('party_id',$2::text))",[game,party]);
 const visible=(await asUser(other,'select doc_kind,version_no,status from party_documents')).rows;
 assert.equal(visible.length,4);assert.equal(visible.find(d=>d.doc_kind==='program').version_no,3);assert(visible.every(d=>d.status==='accepted'));
 await assert.rejects(add('program'),/row-level security|После регистрации/);
 assert.equal((await asUser(teacher,'delete from party_documents where id=$1 returning id',[v1.id])).rows.length,0);
 const notes=(await db.query("select text from chat_messages where text like '%НА ДОРАБОТКУ.%'" )).rows;assert.equal(notes.length,1);assert(notes[0].text.includes('Добавьте источники финансирования.'));
 console.log('PASS isolated PostgreSQL: required remarks, latest-only review, version history, student/teacher/other-party permissions, one return notice, registration and certificate gates.');
 }finally{await db.close()}
}
(async()=>{await actions();await sqlGuards()})().catch(e=>{console.error(e);process.exitCode=1});
