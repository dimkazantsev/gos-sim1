/* Execute the real publishers in PostgreSQL (PGlite), using schema-only fixtures and synthetic records. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function loadTs(file,requireModule=require){
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {module:mod,exports:mod.exports,require:requireModule});
 return mod.exports;
}
const {publishedStageReport}=loadTs('components/game/publishedStageReport.ts');
for(let stage_no=1;stage_no<=16;stage_no++)assert.equal(publishedStageReport({
 context:{automatic:true,source_table:'game_stages',stage_notice:'closed',stage_no},
 source_key:'stage:x:completed:time'},[],[]),null,'A system close must never turn into an editorial fallback');
const brand=loadTs('components/ui/BrandIdentity.tsx');
const Avatar=loadTs('components/game/PublisherAvatar.tsx',id=>{
 if(id==='@/components/ui/BrandIdentity')return brand;
 if(id==='react/jsx-runtime')return require(id);
 return {};
}).default;
const {renderToStaticMarkup}=require('react-dom/server');
const logo=renderToStaticMarkup(Avatar({actorKey:'system',label:'ГОС.ID'}));
assert.match(logo,/gosIdMark--blue-pink/);assert.match(logo,/>ID</);assert.doesNotMatch(logo,/img|Редакция СМИ/);
const migration=read('supabase/changes/stage_lifecycle_editorial_news.sql');
const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const game=uid(1),other=uid(2),person=uid(3);
async function main(){
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create schema private;create schema auth;create table public.games(id uuid primary key,owner_id uuid);');
  const metadata=JSON.parse(read('scripts/fixtures/stage-comic-schema.json'));
  for(const t of metadata.tables.filter(t=>t.table_name!=='republic_comic_chapters'))
   await db.exec('create table public."'+t.table_name+'"('+t.columns.map(c=>'"'+c.name+'" '+c.type).join(',')+');');
  await db.exec("create table public.chat_channels(id uuid,game_id uuid,name text,kind text);\ncreate table public.electoral_calculator_results(game_id uuid,published boolean);\ncreate table public.ghost_voting_policies(game_id uuid,policy_mode text,status text,created_at timestamp with time zone);\ncreate table public.ghost_voting_rounds(id uuid,game_id uuid,stage_no integer,total_loss integer,status text,created_at timestamp with time zone);\ncreate table public.institution_units(id uuid,game_id uuid,unit_kind text,unit_key text,title text,head_user_id uuid);\ncreate table public.office_candidates(id uuid,election_id uuid,game_id uuid,user_id uuid);\ncreate table public.office_elections(id uuid,game_id uuid,stage_no integer,office_key text,status text,winner_candidate_id uuid);");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;create function private.is_game_member(uuid) returns boolean language sql stable as $$select false$$;");
  await db.exec("alter table political_posts alter column id set default gen_random_uuid();alter table political_posts alter column created_at set default now();alter table political_posts alter column updated_at set default now();create unique index post_source_unique on political_posts(game_id,source_key) where source_key is not null;");
  await db.exec(read('supabase/changes/20261002_stage_comic_archive.sql'));
  await db.exec(read('supabase/migrations/20261013045928_stage_result_comics.sql'));
  await db.exec(read('supabase/migrations/20261015060000_verified_editorial_automatic_news.sql'));
  async function insert(table,row){const keys=Object.keys(row);return db.query('insert into '+table+'('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>row[k]));}
  async function rows(sql,values=[]){return (await db.query(sql,values)).rows;}
  async function report(no){return (await rows("select * from political_posts where game_id=$1 and context->>'news_kind'='stage_result' and context->>'stage_no'=$2 and source_key like 'stage-result:%' order by created_at desc limit 1",[game,String(no)]))[0];}
  await insert('games',{id:game,owner_id:person});await insert('games',{id:other,owner_id:person});
  for(const g of [game,other])for(let no=1;no<=16;no++)await insert('game_stages',{id:uid((g===game?100:200)+no),game_id:g,stage_no:no,title:'Название этапа '+no,status:'locked',summary:'НЕ ПУБЛИКОВАТЬ ЗАДАНИЕ',created_at:'2026-10-01'});
  const historic={game_id:game,author_id:person,actor_key:'media',actor_label:'Республиканский обозреватель',process_type:'information',
   internal_ref_id:uid(103),context:{automatic:true,source_table:'game_stages',stage_no:3,stage_title:'Название этапа 3'},body:'Историческое содержание',created_at:'2026-10-01'};
  await insert('political_posts',{...historic,id:uid(800),title:'Открыт этап 3',source_key:'stage:'+uid(103)+':open:old'});
  await insert('political_posts',{...historic,id:uid(801),title:'Исторические итоги',source_key:'stage:'+uid(103)+':completed:old'});
  await insert('political_posts',{...historic,id:uid(802),title:'Удалено',source_key:'stage:'+uid(103)+':open:deleted',deleted_at:'2026-10-02'});
  await db.exec(migration);await db.exec(migration);
  const old=await rows('select * from political_posts where id in ($1,$2,$3)',[uid(800),uid(801),uid(802)]);
  assert.equal(old.find(x=>x.id===uid(800)).actor_key,'system');
  assert.equal(old.find(x=>x.id===uid(801)).body,historic.body,'Past facts must not be reconstructed from current records');
  assert.equal(old.find(x=>x.id===uid(802)).actor_key,'media','Do not revive or edit deleted posts');
  assert.equal((await rows("select * from political_posts where source_key=$1",['stage-notice:'+uid(801)])).length,1,'Idempotent historical close notice');
  for(const name of ['gos_verified_stage_news(uuid,integer)','publish_stage_process_news()','gos_editorial_automatic_post()','capture_completed_stage_comic()']){
   const r=await rows("select has_function_privilege('authenticated',$1,'EXECUTE') as allowed",['private.'+name]);assert.equal(r[0].allowed,false,name);
  }
  await insert('game_members',{game_id:game,user_id:person,full_name:'Публичный руководитель',kind:'student',role_title:'Председатель Правительства Российской Федерации'});
  await insert('game_members',{game_id:other,user_id:uid(4),full_name:'СЕКРЕТ ЧУЖОЙ ИГРЫ',kind:'student'});
  await insert('game_parties',{id:uid(10),game_id:game,name:'Открытая партия',registration_status:'registered',leader_user_id:person,mandates:120,regions:15,ghost_loss_current:30});
  await insert('game_parties',{id:uid(11),game_id:other,name:'СЕКРЕТ ЧУЖОЙ ИГРЫ',registration_status:'registered'});
  await insert('game_parties',{id:uid(12),game_id:game,name:'СЕКРЕТ НЕЗАРЕГИСТРИРОВАННОЙ ПАРТИИ',registration_status:'draft'});
  await insert('parliamentary_election_rules',{game_id:game,system_type:'proportional',allocation_method:'dhondt',status:'adopted'});
  await insert('parliamentary_election_rules',{game_id:other,system_type:'majoritarian',status:'adopted'});
  await insert('electoral_calculator_results',{game_id:game,published:true});
  await insert('regional_election_rules',{game_id:game,method:'agreement',status:'allocated'});
  await insert('ghost_voting_policies',{game_id:game,policy_mode:'justified',status:'adopted'});
  await insert('ghost_voting_rounds',{id:uid(20),game_id:game,stage_no:5,total_loss:30,status:'drawn',created_at:'2026-10-16'});
  await insert('presidential_candidates',{id:uid(30),game_id:game,user_id:person,party_id:uid(10),display_name:'Официальный кандидат',registration_status:'registered',cec_submitted_at:'2026-10-16'});
  await insert('presidential_candidates',{id:uid(31),game_id:game,display_name:'СЕКРЕТ ЛИЧНОГО ЧЕРНОВИКА',registration_status:'registered'});
  await insert('presidential_election_settings',{game_id:game,status:'finished',result:{winner_id:uid(30),score:62.5}});
  await insert('game_office_assignments',{game_id:game,user_id:person,role_title:'Председатель Правительства Российской Федерации',status:'active'});
  await insert('game_office_assignments',{game_id:game,user_id:person,role_title:'Министр экономики',status:'active'});
  await insert('government_structures',{game_id:game,status:'approved',social_title:'Министерство социальной политики',economic_title:'Министерство экономики'});
  await insert('state_programs',{id:uid(40),game_id:game,title:'Программа на согласовании',status:'minister_review',responsible_ministry:'Министерство экономики'});
  await insert('state_programs',{id:uid(41),game_id:game,title:'Принятая программа',status:'adopted',signed_at:'2026-10-16'});
  await insert('state_programs',{id:uid(42),game_id:game,title:'СЕКРЕТ ЧЕРНОВОЙ ПРОГРАММЫ',status:'draft'});
  await insert('municipal_projects',{game_id:game,stage_no:14,problem_title:'Обновление парка',location_text:'Центральный район',status:'adopted'});
  await insert('municipal_projects',{game_id:game,stage_no:14,problem_title:'СЕКРЕТ ЧЕРНОВОГО ПРОЕКТА',status:'draft'});
  await insert('game_crises',{id:uid(50),game_id:game,stage_no:15,description:'Стабилизация энергоснабжения',status:'resolved'});
  await insert('game_crises',{id:uid(51),game_id:game,stage_no:15,description:'Незавершённая ситуация',status:'active'});
  for(let no=1;no<=16;no++)await insert('formal_documents',{id:uid(300+no),game_id:game,stage_no:no,title:'Оформленный акт '+no,status_code:'signed',status_label:'Подписан'});
  await insert('budget_scenarios',{id:uid(60),game_id:game,title:'Подтверждённый бюджет',budget_year:2027,revenue:3.5,expenditure:3,balance:0.5,status:'final',formal_document_id:uid(313)});
  await insert('budget_scenarios',{id:uid(61),game_id:game,title:'СЕКРЕТ БЮДЖЕТНОГО ЧЕРНОВИКА',status:'draft'});
  await insert('institution_units',{id:uid(70),game_id:game,unit_kind:'committee',unit_key:'economy',title:'Комитет по экономике',head_user_id:person});
  await insert('office_elections',{id:uid(71),game_id:game,stage_no:4,office_key:'gd_chair',status:'finished',winner_candidate_id:uid(72)});
  await insert('office_candidates',{id:uid(72),game_id:game,election_id:uid(71),user_id:person});
  const expected={1:'Открытая партия',2:'метод Д’Ондта',3:'соглашение партий',4:'Комитет по экономике',5:'30',6:'Официальный кандидат',7:'62.5%',8:'Министерство социальной политики',9:'Министр экономики',10:'Программа на согласовании',11:'Принятая программа',12:'Оформленный акт 12',13:'3,5 трлн ₽',14:'Обновление парка',15:'Подтверждённое урегулирование: 1',16:'завершено этапов: 16 из 16'};
  for(let no=1;no<=16;no++){
   await db.query("update game_stages set status='open',opened_at=clock_timestamp() where game_id=$1 and stage_no=$2",[game,no]);
   const opened=await rows("select * from political_posts where game_id=$1 and context->>'stage_no'=$2 and context->>'stage_notice'='opened'",[game,String(no)]);
   assert.equal(opened.filter(x=>x.actor_key==='media').length,0,'Opened stage must not be media');
   assert(opened.some(x=>x.actor_key==='system'&&x.actor_label==='ГОС.ID'));
   await db.query("update game_stages set status='completed',completed_at=clock_timestamp() where game_id=$1 and stage_no=$2",[game,no]);
   const closed=await rows("select * from political_posts where game_id=$1 and source_key like $2 and context->>'stage_notice'='closed'", [game,'stage:'+uid(100+no)+':completed:%']);
   assert.equal(closed.length,1);assert.equal(closed[0].actor_key,'system','Comic capture must preserve the system publisher');
   assert.equal(closed[0].context.editorial_verified,false);
   const news=await report(no);assert(news,'News for stage '+no);assert.equal(news.actor_key,'media');assert.equal(news.process_type,'news');
   assert.equal(news.context.editorial_verified,true);assert(news.context.stage_snapshot,'Comic/news snapshot link');
   assert(news.body.includes(expected[no]),'Confirmed stage '+no+' result: '+news.body);
   assert(news.body.split('\n\n').length>=3,'Complete prose for stage '+no);assert(!news.body.includes('СЕКРЕТ'));assert(!news.body.includes('НЕ ПУБЛИКОВАТЬ'));
   if(no===4){assert(!news.body.includes('оформлены пять комитетов'));assert(!news.body.includes('Комитет по экономике — Публичный руководитель'),'Committee chair needs its own finished election');}
   console.log('PASS PostgreSQL stage '+no+': system lifecycle, confirmed result, isolation and comic link');
  }
  const before=await report(2);
  await db.query("update game_stages set status='completed' where game_id=$1 and stage_no=2",[game]);
  assert.equal((await rows("select * from political_posts where source_key like $1",['stage-result:'+uid(102)+':%'])).length,1,'No duplicate for unchanged status');
  await db.query("update game_stages set status='open',opened_at=clock_timestamp() where game_id=$1 and stage_no=2",[game]);
  await db.query("update game_stages set status='completed',completed_at=clock_timestamp() where game_id=$1 and stage_no=2",[game]);
  assert.equal((await rows("select * from political_posts where source_key like $1",['stage-result:'+uid(102)+':%'])).length,2,'A reopened cycle gets one new report');
  assert.equal((await rows("select body from political_posts where id=$1",[before.id]))[0].body,before.body,'Past report is immutable');
  await insert('political_posts',{game_id:game,author_id:person,actor_key:'participant',actor_label:'Участник',title:'Личный текст',body:'Без изменений',context:{}});
  assert.equal((await rows("select body from political_posts where title='Личный текст'"))[0].body,'Без изменений');
  assert((await rows('select * from republic_comic_chapters where game_id=$1',[game])).length>=11,'Completion comics remain connected');
  console.log('PASS: PostgreSQL lifecycle and detailed news for all 16 stages; historical repair, idempotency, reopening, comic integration, official-result gates, cross-game privacy and private function grants.');
 }finally{await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1});

