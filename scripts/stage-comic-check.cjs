/* Real PostgreSQL execution in PGlite; fixtures contain schema metadata and synthetic records only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {COMIC_STAGES,comicSlides,eligibleComicStages,teacherComicPreviews}=require('../components/game/stageComicModel');
for(const key of ['parties','regions','duma','president','government','programs','laws','budget','municipal','crisis','epilogue'])for(const width of [480,960,1920]){
 const bytes=fs.readFileSync(path.join(root,'public/republic-art/chapters',key+'-'+width+'.webp'));
 assert(bytes.length>2000&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length,'Complete WebP artwork: '+key+' '+width);
}
const metadata=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/stage-comic-schema.json'),'utf8'));
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261013045928_stage_result_comics.sql'),'utf8');
const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0'),game=uid(1),other=uid(2),winner=uid(100);
const teachingDrafts=teacherComicPreviews(game,[]);
assert.equal(teachingDrafts.length,11,'All teacher previews must exist before any stage completes');
for(const draft of teachingDrafts){
 assert.equal(draft.kind,'preview','Teacher previews must never be marked completed');
 assert.equal(draft.snapshot.version,2,'Teacher previews use original chapter layout');
 const slides=comicSlides(draft);
 assert.equal(slides.length,draft.stage_no===16?4:3,'Three slides per stage chapter, four in epilogue');
 assert(slides.every(slide=>slide.body.includes('Предварительный просмотр')&&slide.facts.every(fact=>fact.value==='Ожидает завершения')),'Teacher draft must not pretend to contain completed results');
}
assert.equal(teacherComicPreviews(game,[teachingDrafts[0]]).length,10,'Saved chapters must replace their previews without duplication');
const stageOne={id:'empty-stage-one',stage_no:1,kind:'completed',title:'Итоги',body:'',snapshot:{version:2,counters:{documents:0,finished_documents:0,votes:0,passed_votes:0},parties:[]}};
assert.equal(comicSlides(stageOne).length,2,'Do not show an empty third slide for stage one');
assert.equal(comicSlides({...stageOne,snapshot:{...stageOne.snapshot,counters:{documents:1}}}).length,3,'Keep stage-one registration results when a document exists');
assert.equal(comicSlides({...stageOne,snapshot:{...stageOne.snapshot,parties:[{name:'Партия',status:'revision'}]}}).length,3,'Keep registration results when a party is under review');
const teacherStageSource=fs.readFileSync(path.join(root,'components/game/TeacherStageManager.tsx'),'utf8');
const teacherStageCss=fs.readFileSync(path.join(root,'app/teacher-stage-layout.css'),'utf8');
assert(teacherStageSource.includes('isSingleAction')&&teacherStageCss.includes('.teacherStageFlowActions.isSingleAction>button'),'The Open Stage action must fill the inspector width');


async function main(){
 const db=new PGlite();
 try{
  await db.exec("create role anon;create role authenticated;create schema private;create schema auth;create table games(id uuid primary key);");
  for(const t of metadata.tables.filter(t=>t.table_name!=='republic_comic_chapters')){
   const columns=t.columns.map(c=>'"'+c.name+'" '+c.type).join(',');await db.exec('create table public."'+t.table_name+'"('+columns+');');
  }
  await db.exec(`create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from game_members where game_id=g and user_id=auth.uid() and roster_archived_at is null)$$;
   grant usage on schema public,private,auth to authenticated;grant execute on function auth.uid(),private.is_game_member(uuid) to authenticated;`);
  await db.exec(fs.readFileSync(path.join(root,'supabase/changes/20261002_stage_comic_archive.sql'),'utf8'));
  await db.exec(migration);
  async function insert(table,row){const keys=Object.keys(row);await db.query('insert into '+table+'('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>row[k]));}
  async function complete(no,g=game){await db.query("update game_stages set status='completed',completed_at=now() where game_id=$1 and stage_no=$2",[g,no]);}
  async function chapter(no,g=game){return (await db.query("select * from republic_comic_chapters where game_id=$1 and stage_no=$2 and kind='completed'",[g,no])).rows[0];}
  await insert('games',{id:game});await insert('games',{id:other});
  for(const g of [game,other])for(let no=1;no<=16;no++)await insert('game_stages',{id:uid((g===game?200:400)+no),game_id:g,stage_no:no,title:'Этап '+no,status:'open',summary:'Тестовый этап'});
  for(let n=0;n<30;n++)await insert('game_members',{game_id:game,user_id:uid(100+n),full_name:'Участник '+n,kind:n===29?'teacher':'student',role_title:n===0?'Президент РФ':null,team:n<10?'Тестовая партия':null});
  await insert('game_members',{game_id:other,user_id:uid(500),full_name:'Чужой участник',kind:'student',role_title:'Президент Российской Федерации'});
  await insert('game_parties',{id:uid(600),game_id:game,name:'Тестовая партия',registration_status:'registered',leader_user_id:winner,mandates:200,regions:39,ghost_loss_current:12});
  await insert('game_parties',{id:uid(601),game_id:other,name:'Чужая партия',registration_status:'registered',mandates:450,regions:89,ghost_loss_current:0});
  for(const no of [2,3,4,5,7,11,12,13,14,15])await insert('formal_documents',{id:uid(700+no),game_id:game,stage_no:no,title:'Документ '+no,status_code:no===13?'draft':'published',body_text:'PRIVATE DOCUMENT BODY',created_at:'2026-10-13'});
  await insert('formal_documents',{id:uid(790),game_id:other,stage_no:3,title:'Чужой документ',status_code:'published'});
  await insert('game_votes',{id:uid(800),game_id:game,stage_no:3,title:'Тестовое голосование',status:'closed',result_code:'passed',opened_at:'2026-10-13'});
  await insert('game_ballots',{vote_id:uid(800),voter_id:winner,choice:'yes'});
  await insert('presidential_candidates',{id:uid(900),game_id:game,display_name:'Избранный участник',party_id:uid(600),registration_status:'registered',user_id:winner,program_summary:'PRIVATE DOSSIER'});
  await insert('presidential_election_settings',{game_id:game,status:'round1',system_type:'absolute',result:JSON.stringify({winner_id:uid(900),score:63.75})});
  assert.equal((await db.query('select private.stage_result_comic_snapshot($1,7) s',[game])).rows[0].s.president,null,'Unfinished election cannot declare a winner');
  await db.query("update presidential_election_settings set status='finished' where game_id=$1",[game]);
  await insert('state_programs',{id:uid(950),game_id:game,title:'ГП образования',status:'adopted',total_budget:1000000,signed_at:'2026-10-13'});
  await insert('budget_scenarios',{id:uid(960),game_id:game,title:'Расчёт бюджета',budget_year:2027,status:'draft',revenue:30.5,expenditure:31.25,balance:-.75});
  await insert('budget_transfer_requests',{id:uid(970),game_id:game,status:'granted',amount:500});
  await insert('government_structures',{game_id:game,status:'approved',social_title:'Министерство социальной политики',economic_title:'Министерство экономики',defence_title:'Министерство обороны',foreign_title:'Министерство внешней политики',internal_title:'Министерство внутренних дел'});
  await insert('game_office_assignments',{id:uid(980),game_id:game,user_id:uid(101),role_title:'Председатель Правительства Российской Федерации',status:'active'});
  await insert('game_office_assignments',{id:uid(981),game_id:game,user_id:winner,role_title:'Президент Российской Федерации',status:'ended'});
  await insert('game_crises',{id:uid(990),game_id:game,stage_no:15,description:'Тестовый кризис',status:'resolved'});
  await insert('crisis_responses',{id:uid(991),game_id:game,crisis_id:uid(990),teacher_note:'PRIVATE TEACHER NOTE',action_plan:'PRIVATE RESPONSE'});
  await insert('state_metrics',{id:uid(992),game_id:game,metric_key:'trust',label:'Публичный показатель',value:42,is_public:true});
  await insert('state_metrics',{id:uid(993),game_id:game,metric_key:'secret',label:'SECRET METRIC',value:99,is_public:false});
  await insert('chat_messages',{id:uid(994),game_id:game,kind:'audio',text:'PRIVATE CHAT'});
  await insert('blitz_assignments',{id:uid(995),game_id:game,answered_at:'2026-10-13',chosen_index:3,is_correct:true});
  await insert('game_assigned_tasks',{id:uid(996),game_id:game,status:'confirmed',description:'PRIVATE TASK'});
  await complete(1);const first=await chapter(1);assert.equal(first.snapshot.parties[0].name,'Тестовая партия');assert.equal(first.snapshot.parties[0].leader,'Участник 0');
  await db.query("update game_parties set name='Изменённое название' where game_id=$1",[game]);assert.equal((await chapter(1)).snapshot.parties[0].name,'Тестовая партия','Snapshot is immutable');
  await complete(2);assert.equal(await chapter(2),undefined);assert.equal(await chapter(3),undefined,'No group chapter before stage 3');
  await complete(3);const group=await chapter(3);assert.equal(group.snapshot.counters.documents,2);assert.equal(group.snapshot.counters.passed_votes,1);assert.deepEqual(group.snapshot.stages,[2,3]);
  await complete(5);assert.equal(await chapter(5),undefined,'Both grouped stages must complete');await complete(4);assert.deepEqual((await chapter(5)).snapshot.stages,[4,5],'Reverse completion order works');
  for(const no of [6,7,8,9,10,11,12,13,14,15,16])await complete(no);
  const rows=(await db.query('select * from republic_comic_chapters where game_id=$1 order by stage_no',[game])).rows;
  assert.deepEqual(rows.map(c=>c.stage_no),COMIC_STAGES);assert(rows.every(c=>c.kind==='completed'),'No preview duplicates');
  const p=await chapter(7);assert.equal(p.snapshot.president.name,'Избранный участник');assert.equal(p.snapshot.president.score,63.75);assert(!p.snapshot.offices.some(o=>/^Президент/.test(o.role)),'Ended office stays ended across legacy title aliases');
  assert.equal((await chapter(8)).snapshot.ministries.length,5);assert((await chapter(8)).snapshot.offices.some(o=>o.name==='Участник 1'));
  assert.equal((await chapter(11)).snapshot.counters.adopted_programs,1);assert.equal((await chapter(13)).snapshot.counters.approved_transfers,1);assert.equal((await chapter(13)).snapshot.budgets[0].status,'draft');
  assert.equal((await chapter(15)).snapshot.counters.resolved_crises,1);assert.equal((await chapter(15)).snapshot.metrics_detail.length,1);
  const end=await chapter(16);assert.equal(end.snapshot.counters.participants,30);assert.equal(end.snapshot.counters.ballots,1);assert.equal(end.snapshot.counters.documents,10);assert.equal(end.snapshot.counters.messages,1);assert.equal(end.snapshot.counters.completed_tasks,1);assert.equal(end.snapshot.counters.completed_stages,16);
  for(const c of rows){assert.equal(comicSlides(c).length,c.stage_no===16?4:3);assert(!JSON.stringify(c.snapshot).match(/PRIVATE|SECRET|chosen_index|is_correct|electorate_snapshot/),'No private content in chapter '+c.stage_no)}
  const slides=comicSlides(end);assert(slides.flatMap(s=>s.facts).length>=54);assert(slides.flatMap(s=>s.facts).every(f=>f.value!=='Не зафиксировано'),'Every visible epilogue counter is supplied by SQL');
  fs.mkdirSync(path.join(root,'.design-review'),{recursive:true});fs.writeFileSync(path.join(root,'.design-review/stage-comic-results.json'),JSON.stringify({gameId:game,chapters:rows}));
  assert.equal((await db.query('select count(*)::int n from republic_comic_chapters where game_id=$1',[other])).rows[0].n,0);
  await db.query("update game_stages set status='open' where game_id=$1 and stage_no=7",[game]);await complete(7);assert.deepEqual((await chapter(7)).snapshot,p.snapshot,'Repeated completion keeps the original result');
  // Real RLS and grants with 30 role-scoped readers. PGlite serializes execution; this does not emulate 30 network sessions.
  const started=performance.now();
  for(let n=0;n<30;n++){
   await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(100+n)]);
   assert.equal((await db.query('select count(*)::int n from republic_comic_chapters')).rows[0].n,11);await db.exec('reset role');
  }
  await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(500)]);
  assert.equal((await db.query('select count(*)::int n from republic_comic_chapters')).rows[0].n,0,'Foreign member cannot read chapters');
  await assert.rejects(db.query('select private.stage_result_comic_snapshot($1,16)',[game]),/permission denied/);await db.exec('reset role');
  await db.exec('set role anon');await assert.rejects(db.query('select * from republic_comic_chapters'),/permission denied/);await db.exec('reset role');
  // Apply again with stage 15 already complete in another game: explicit reconstructed source, unchanged existing snapshots.
  await db.query("update game_stages set status='completed' where game_id=$1 and stage_no=15",[other]);
  await db.query('delete from republic_comic_chapters where game_id=$1',[other]);await db.exec(migration);
  assert.equal((await chapter(15,other)).snapshot.source,'reconstructed');assert.deepEqual((await chapter(1)).snapshot,first.snapshot);
  assert.deepEqual(eligibleComicStages([{stage_no:2,status:'completed'},{stage_no:3,status:'open'},{stage_no:5,status:'completed'},{stage_no:15,status:'completed'}]),[15]);
  console.log('PASS PostgreSQL: 11 chapters, grouped and reverse closures, immutable names/results, actual winner/offices/ministries/budget, 4-slide epilogue, private-data exclusion, existing stage 15, idempotency, RLS for 30 identities ('+Math.round(performance.now()-started)+'ms), foreign/anon/internal-function denial');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
