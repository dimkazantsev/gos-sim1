'use strict';
/** Fast, fully local PostgreSQL contract. No Supabase calls, no cloud tests, no private story scripts. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const one=fs.readFileSync('supabase/migrations/20261104151000_story_automation_teacher_control.sql','utf8');
 const two=fs.readFileSync('supabase/migrations/20261104152000_story_automation_stage_events.sql','utf8');
 const panel=fs.readFileSync('components/game/TeacherStoryBranchesPanel.tsx','utf8');
 const campaign=fs.readFileSync('components/game/TeacherStoryCampaign.tsx','utf8');
 for(const source of [panel,campaign]){
  assert(!source.includes('setInterval(')&&!source.includes('.channel('),'No new poll/subscription');
 }
 assert(campaign.includes('set_story_automation_teacher'),'Teacher has automatic mode switch');
 assert(campaign.includes('edit_story_published_episode_teacher'),'Published episodes are correctable');
 assert(panel.includes('edit_story_branch_text_teacher'),'Published branch copy is correctable');
 assert(two.includes('AFTER UPDATE OF status ON public.game_stages'),'Only stage events publish');
 assert(two.includes("ON CONFLICT(game_id,source_key)"),'Idempotency is guaranteed by source key');
 const db=new PGlite();
 try{
  await db.exec(String.raw\`
   create schema private; create schema auth;
   create role anon; create role authenticated;
   create function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;
   create function private.is_game_teacher(uuid) returns boolean language sql stable as $$ select true $$;
   create function private.story_supplement_evidence_exists(uuid,text,uuid)
    returns boolean language sql stable as $$ select false $$;
   create function public.get_story_episode_preview_teacher(uuid,integer)
    returns jsonb language sql stable as $$ select '{}'::jsonb $$;
   create table public.games(id uuid primary key,owner_id uuid,current_round integer);
   create table public.game_stages(game_id uuid,stage_no integer,status text,primary key(game_id,stage_no));
   create table public.electoral_calculator_results(game_id uuid,published boolean);
   create table public.political_posts(
    id uuid primary key default gen_random_uuid(),game_id uuid,author_id uuid,
    process_type text,actor_key text,actor_label text,title text,body text,tags text[],
    source_key text,context jsonb,status text,impact_plan jsonb,effects_applied boolean,
    updated_at timestamptz default now(),unique(game_id,source_key));
   create table private.story_campaigns(
    game_id uuid primary key,enabled boolean not null default false,current_episode integer not null default 0,
    revision integer not null default 1,prepared_by uuid not null,
    updated_at timestamptz default now());
   create table private.story_episode_drafts(
    episode_no integer primary key,stage_no integer,draft jsonb not null);
   create table private.story_episode_releases(
    game_id uuid not null,episode_no integer not null,
    draft_title text,draft_body text,approved_by uuid,approved_at timestamptz,
    published_by uuid,published_at timestamptz,published_post_id uuid,
    primary key(game_id,episode_no));
   create table private.story_branch_rules(
    branch_no smallint primary key,first_episode smallint,last_episode smallint,title text,
    when_recorded text,when_absent text,evidence_description text,
    recorded_body text,neutral_body text);
   create table private.story_branch_reviews(
    game_id uuid not null,branch_no smallint not null,outcome text not null,
    evidence_kind text,evidence_id uuid,teacher_note text not null default '',
    reviewed_by uuid not null,reviewed_at timestamptz not null default now(),
    published_at timestamptz,published_post_id uuid,primary key(game_id,branch_no));
  \`);
  await db.exec(one);
  await db.exec(two);
  const game='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner='11111111-1111-4111-8111-111111111111';
  const title='Проверка информационного сообщения';
  const body='Известные сведения официально проверены, но пока не подтверждают выделение государственных средств на мероприятие.';
  await db.query('insert into public.games(id,owner_id,current_round) values($1,$2,4)',[game,owner]);
  await db.query('insert into public.game_stages(game_id,stage_no,status) values($1,4,$2)',[game,'locked']);
  await db.query('insert into public.electoral_calculator_results(game_id,published) values($1,true)',[game]);
  await db.query('insert into private.story_campaigns(game_id,prepared_by) values($1,$2)',[game,owner]);
  for(let episode=1;episode<=3;episode++){
   await db.query('insert into private.story_episode_drafts(episode_no,stage_no,draft) values($1,4,$2::jsonb)',
    [episode,JSON.stringify({title,body})]);
  }
  await db.query('insert into private.story_branch_rules(branch_no,first_episode,last_episode,title,when_recorded,when_absent,evidence_description,recorded_body,neutral_body) values(1,3,3,$1,$2,$2,$2,$2,$2)',
   [title,body]);
  await db.query("update public.game_stages set status='open' where game_id=$1 and stage_no=4",[game]);
  let r=await db.query('select current_episode,auto_mode,enabled,automation_error from private.story_campaigns where game_id=$1',[game]);
  assert.equal(r.rows[0].current_episode,1,JSON.stringify(r.rows));
  assert.equal(r.rows[0].automation_error,null);
  await db.query("update public.game_stages set status='completed' where game_id=$1 and stage_no=4",[game]);
  r=await db.query('select current_episode,automation_error from private.story_campaigns where game_id=$1',[game]);
  assert.equal(r.rows[0].current_episode,3,JSON.stringify(r.rows));
  assert.equal(r.rows[0].automation_error,null);
  r=await db.query('select count(*)::integer as n from public.political_posts where game_id=$1',[game]);
  assert.equal(r.rows[0].n,4,'Three episodes and one neutral branch');
  r=await db.query('select outcome,automatic_review,published_at is not null published from private.story_branch_reviews where game_id=$1',[game]);
  assert.deepEqual(r.rows,[{outcome:'neutral',automatic_review:true,published:true}]);
  await db.query("update public.game_stages set status='completed' where game_id=$1 and stage_no=4",[game]);
  r=await db.query('select count(*)::integer n from public.political_posts where game_id=$1',[game]);
  assert.equal(r.rows[0].n,4,'No duplicate news after repeated update');
  const edit=await db.query('select public.edit_story_branch_text_teacher($1,1::smallint,$2,$3)::jsonb as result',[game,title+' уточнено',body+' Это исправленный текст.']);
  assert.equal(edit.rows[0].result.published,true);
  r=await db.query("select title from public.political_posts where game_id=$1 and source_key='story_branch:01'",[game]);
  assert.equal(r.rows[0].title,title+' уточнено');
  console.log('PASS: SQL compiles, one story post on opening, two on closing, neutral branch, no duplicates, teacher edit');
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
