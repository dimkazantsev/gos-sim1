/* Verify that queued Blitz cards cannot reveal questions via either RPC.
   Uses isolated PostgreSQL; never writes to production or starts live attempts. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261017183000_blitz_archive_pending_question_privacy.sql','utf8');
const ui=fs.readFileSync('components/game/Blitz.tsx','utf8');
const original=fs.readFileSync('supabase/migrations/20261014170000_blitz_inbox_atomic_open.sql','utf8');
assert(ui.includes('Блиц-вопрос № {index+1}'),'Queued question has a neutral label');
assert(!ui.includes('>{r.question||"Вопрос ожидает загрузки"}</button>'),'No pending question rendering');
assert(ui.includes("answered&&r.topic?"),'Topic cannot be used to prepare');
assert(ui.includes("rpc('blitz_open_selected'"),'Question only retrieved when student chooses to start');
assert(original.includes('started_at=clock_timestamp()')&&original.includes("interval '20 seconds'"),'Atomic opening and 20-second timer remain');
(async()=>{
 const db=new PGlite();
 const game='10000000-0000-0000-0000-000000000001';
 const student='10000000-0000-0000-0000-000000000002';
 const teacher='10000000-0000-0000-0000-000000000003';
 const stranger='10000000-0000-0000-0000-000000000004';
 const assignment='10000000-0000-0000-0000-000000000005';
 const question='Что устанавливает Конституция Российской Федерации?';
 const topic='Основы конституционного строя';
 const options=JSON.stringify(['Правило А','Правило Б']);
 const setUser=async id=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])};
 const archive=async state=> (await db.query("select public.blitz_archive_filtered($1,$2,$3,0,30) AS cards",[game,student,state])).rows[0].cards;
 const legacy=async()=> (await db.query("select public.blitz_archive($1,$2,0,50) AS cards",[game,student])).rows[0].cards;
 try{
  await db.exec("create role anon;create role authenticated;create schema auth;"+
   "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
   "create table game_members(game_id uuid,user_id uuid,kind text);"+
   "create table blitz_questions(id bigint,question text,topic text,options jsonb,correct_index integer,explanation text,legal_act text,article text,source_url text);"+
   "create table blitz_assignments(id uuid,game_id uuid,user_id uuid,question_id bigint,stage_no integer,available_at timestamptz,started_at timestamptz,answered_at timestamptz,chosen_index integer,is_correct boolean);");
  await db.exec(migration);
  for(const [id,kind] of [[student,'student'],[teacher,'teacher']])
   await db.query('insert into game_members values($1,$2,$3)',[game,id,kind]);
  await db.query('insert into blitz_questions values(1,$1,$2,$3,0,$4,$5,$6,$7)',
   [question,topic,options,'Подробное объяснение','Конституция Российской Федерации','Статья 1','https://example.invalid/law']);
  await db.query('insert into blitz_assignments(id,game_id,user_id,question_id,stage_no,available_at) values($1,$2,$3,1,4,now())',
   [assignment,game,student]);
  await setUser(student);
  const pending=(await archive('pending'))[0],legacyPending=(await legacy())[0];
  assert.equal(pending.id,assignment);
  for(const [source,card] of [['filtered',pending],['legacy',legacyPending]]){
   for(const key of ['question','topic','options','correct_index','explanation','legal_act','article','source_url']){
    assert.equal(card[key],null,'Leak from '+source+': '+key);
   }
  }
  for(let i=0;i<40;i++)assert.equal((await archive('pending'))[0].question,null,'Concurrent-style repeated poll '+i);
  const before=(await db.query('select started_at,answered_at from blitz_assignments where id=$1',[assignment])).rows[0];
  assert.equal(before.started_at,null,'Opening archive must never start the timer');
  assert.equal(before.answered_at,null,'Archive must not submit an answer');
  await setUser(stranger);
  await assert.rejects(()=>archive('pending'),/Forbidden/);
  await setUser(teacher);
  const teacherPending=(await archive('pending'))[0];
  assert.equal(teacherPending.question,question,'Teacher retains question-bank review');
  assert.equal(teacherPending.topic,topic);
  await db.query('update blitz_assignments set started_at=now()-interval \'21 seconds\',answered_at=now(),chosen_index=0,is_correct=true where id=$1',[assignment]);
  await setUser(student);
  const answered=(await archive('answered'))[0],legacyAnswered=(await legacy())[0];
  for(const card of [answered,legacyAnswered]){
   assert.equal(card.question,question,'Revealed in history only after attempt');
   assert.equal(card.topic,topic);
   assert.equal(card.correct_index,0);
   assert.equal(card.explanation,'Подробное объяснение');
  }
  assert.deepEqual(await archive('pending'),[],'Answered attempt leaves pending folder');
  console.log('PASS Blitz privacy: no pending text/topic/options in two RPCs, teacher/answered access, foreign-user guard, 40 polls, no early timer.');
 }finally{await db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
