/* Isolated SQL experiment. Does not call Supabase or change deployed functions. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const file=fs.readFileSync(path.join(root,'supabase/migrations/20261014043000_live_counters_chat_blitz.sql'),'utf8');
const original=file.slice(file.indexOf('create or replace function public.get_section_updates('),file.indexOf('create or replace function public.mark_section_read('));
assert(original.includes("section_key='dashboard'"),'Benchmark must cover the current eight-section function');
const sections=['documents','votes','events','actions','parties','stages','teacher','dashboard'];
const variables=['d','v','e','a','p','s','t','h'];
const lines=original.match(/ select coalesce\(max\(seen_at\).*?;\r?\n/g)||[];
assert.equal(lines.length,8,'Reproduction requires eight original section marker reads');
const migrationPath=path.join(root,'supabase/migrations/20261028010000_section_updates_single_marker_scan.sql');
assert(fs.existsSync(migrationPath),'The production single-marker migration must exist');
const migration=fs.readFileSync(migrationPath,'utf8');
assert.equal((migration.match(/from section_reads where game_id=p_game_id and user_id=u/gi)||[]).length,1,'The production RPC must scan section_reads once');
assert(sections.every(key=>migration.includes("section_key='"+key+"'")),'All eight badge markers must be retained');
const candidate=migration.replace('public.get_section_updates(','public.get_section_updates_single_reads(');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=id(1000),foreignGame=id(1001),teacher=id(41),observer=id(42);
async function main(){
 const db=new PGlite();
 try{
  await db.exec(`create schema auth;create schema private;
   create table game_members(game_id uuid,user_id uuid,kind text,primary key(game_id,user_id));
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function private.is_game_member(uuid) returns boolean language sql stable as $$select exists(select 1 from game_members where game_id=$1 and user_id=auth.uid())$$;
   create function private.is_game_teacher(uuid) returns boolean language sql stable as $$select exists(select 1 from game_members where game_id=$1 and user_id=auth.uid() and kind='teacher')$$;
   create table section_reads(game_id uuid,user_id uuid,section_key text,seen_at timestamptz,primary key(game_id,user_id,section_key));
   create table formal_documents(id int,game_id uuid,updated_at timestamptz,created_at timestamptz);
   create table game_votes(id int,game_id uuid,opened_at timestamptz);
   create table event_assignments(id int,game_id uuid,recipient_id uuid,created_at timestamptz);
   create table event_collaboration_invites(id int,game_id uuid,recipient_id uuid,status text,created_at timestamptz);
   create table political_posts(id int,game_id uuid,deleted_at timestamptz,created_at timestamptz);
   create table game_parties(id int,game_id uuid,registration_status text,registration_submitted_at timestamptz,created_at timestamptz);
   create table party_invitations(id int,game_id uuid,invited_user_id uuid,status text,created_at timestamptz);
   create table game_stages(id int,game_id uuid,opened_at timestamptz,completed_at timestamptz);
   create table party_documents(id int,game_id uuid,created_at timestamptz,status text);`);
  for(let n=1;n<=42;n++){
   await db.query('insert into game_members values($1,$2,$3)',[game,id(n),n===41?'teacher':n===42?'observer':'student']);
   for(const [i,key] of sections.entries())if((n+i)%5!==0)
    await db.query("insert into section_reads values($1,$2,$3,'2026-10-01'::timestamptz+($4||' days')::interval)",[game,id(n),key,String((n+i)%15)]);
  }
  for(const table of ['formal_documents','political_posts'])
   await db.query(`insert into ${table} select n,$1,${table==='formal_documents'?"'2026-10-01'::timestamptz+n*interval '1 minute',":"null,"}'2026-10-01'::timestamptz+n*interval '1 minute' from generate_series(1,10000)n`,[game]);
  await db.query("insert into game_votes select n,$1,'2026-10-01'::timestamptz+n*interval '10 minutes' from generate_series(1,1000)n",[game]);
  for(const [table,column] of [['event_assignments','recipient_id'],['event_collaboration_invites','recipient_id'],['party_invitations','invited_user_id']]){
   const status=table==='event_assignments'?'':",case when n%3=0 then 'accepted' else 'pending' end";
   await db.query(`insert into ${table} select n,$1,('00000000-0000-4000-8000-'||lpad((1+n%40)::text,12,'0'))::uuid${status},'2026-10-01'::timestamptz+n*interval '1 hour' from generate_series(1,400)n`,[game]);
  }
  await db.query("insert into game_parties select n,$1,case when n%2=0 then 'submitted' else 'registered' end,'2026-10-10'::timestamptz,'2026-10-01'::timestamptz from generate_series(1,10)n",[game]);
  await db.query("insert into game_stages select n,$1,'2026-10-01'::timestamptz+n*interval '1 day',case when n<8 then '2026-10-10'::timestamptz end from generate_series(1,16)n",[game]);
  await db.query("insert into party_documents select n,$1,'2026-10-10'::timestamptz,case when n%2=0 then 'accepted' else 'submitted' end from generate_series(1,100)n",[game]);
  await db.exec(original+candidate);
  async function as(user){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||''])}
  async function read(name){return(await db.query(`select public.${name}($1) value`,[game])).rows[0].value}
  for(let n=1;n<=42;n++){
   await as(id(n));const before=await read('get_section_updates'),after=await read('get_section_updates_single_reads');
   assert.deepEqual(after,before,'Every counter must match for student, teacher and observer '+n);
   if(n<41||n===42)assert.equal(after.teacher,0,'No teacher counter for non-teacher');
  }
  await as(teacher);assert((await read('get_section_updates_single_reads')).teacher>0,'Teacher counter remains populated');
  for(const name of ['get_section_updates','get_section_updates_single_reads']){
   await as(null);await assert.rejects(read(name),e=>e.code==='42501','Anonymous access rejected');
   await as(id(1));await assert.rejects(db.query(`select ${name}($1)`,[foreignGame]),e=>e.code==='42501','Foreign-game access rejected');
  }
  const timing={original:[],candidate:[]};
  // Alternate order to avoid systematically giving one variant a warm-cache advantage.
  for(let round=0;round<6;round++)for(const variant of (round%2?['candidate','original']:['original','candidate'])){
   const begun=performance.now();
   for(let n=1;n<=40;n++){await as(id(n));await read(variant==='original'?'get_section_updates':'get_section_updates_single_reads')}
   timing[variant].push(performance.now()-begun);
  }
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return (sorted[2]+sorted[3])/2};
  const before=median(timing.original),after=median(timing.candidate);
  const report={environment:'isolated PGlite, synthetic rows; not production/Auth/concurrency/SLA',students:40,other_roles:2,documents:10000,posts:10000,marker_reads_per_call:{original:8,candidate:1},checks:['all-42-counter-equivalence','missing-markers','teacher-counter','foreign-game-rejected','anonymous-rejected'],timing_40_sequential_reads_ms:timing,median_ms:{original:before,candidate:after},relative_reduction_percent:Math.round((1-after/before)*1000)/10,recommendation:before-after>=20&&after<=before*.9?'Candidate deserves a separate real-server measurement; do not deploy from this synthetic result alone.':'Do not deploy a SQL micro-optimization from this result; prioritize reducing duplicated callers.'};
  console.log(JSON.stringify(report,null,2));
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
