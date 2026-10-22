'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261022110644_stage12_duma_rpc_active_window_guard.sql','utf8');
const ui=fs.readFileSync('components/game/LegislativeSessionLab.tsx','utf8');
const workspace=fs.readFileSync('components/game/GovernanceStageWorkspace.tsx','utf8');
const game='10000000-0000-0000-0000-000000000001';
const names=['create_duma_session','add_duma_agenda_item','open_duma_session','close_duma_session','set_duma_agenda_item_status'];
assert.equal((sql.match(/end;\$function\$;/g)||[]).length,5,'All restored RPC definitions must be terminated by semicolons');
for(const name of names){
 const pos=sql.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');
 assert(pos>=0,name+' RPC preserved');
 const next=sql.indexOf('CREATE OR REPLACE FUNCTION public.',pos+10);
 const block=sql.slice(pos,next<0?undefined:next);
 assert(block.includes('perform private.require_duma_stage_open('),name+' checks active stage on the server');
 assert(block.includes('private.can_manage_duma_session('),name+' keeps authorized chair/teacher check');
}
assert(sql.includes("d.status_code in ('rejected','published')"),'Rejected or published document cannot re-enter new agenda');
assert(ui.includes(".eq('stage_no',12)"),'Stage 12 excludes historical Stage 6 session listings');
assert(ui.includes(".in('session_id',sessionIds)"),'Agenda reads only Stage 12 session IDs');
assert(ui.includes("v.stage_no===12"),'Vote links are stage-scoped');
assert(ui.includes('!readOnly&&'),'Read-only viewer has no chairman controls');
assert(workspace.includes('<LegislativeSessionLab g={g} readOnly={viewer}'),'Student guest view passes read-only flag');
const helper=sql.match(/CREATE OR REPLACE FUNCTION private\.require_duma_stage_open[\s\S]*?\$duma_stage\$;/)?.[0];
assert(helper,'SQL helper must exist');
(async()=>{
 const db=new PGlite();
 try {
  await db.exec(`
   CREATE SCHEMA private;
   CREATE TABLE public.games(id uuid PRIMARY KEY,status text,turn_open boolean,turn_ends_at timestamptz);
   CREATE TABLE public.game_stages(game_id uuid,stage_no integer,status text,deadline timestamptz);
   CREATE TABLE private.teacher_flag(value boolean);
   INSERT INTO private.teacher_flag VALUES(false);
   CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT value FROM private.teacher_flag LIMIT 1$$;
  `);
  await db.exec(helper);
  const run=()=>db.query('SELECT private.require_duma_stage_open($1,12)',[game]);
  await db.query("INSERT INTO public.games VALUES($1,'running',true,now()+interval '2 hour')",[game]);
  await db.query("INSERT INTO public.game_stages VALUES($1,12,'locked',now()+interval '2 hour')",[game]);
  await assert.rejects(run(),/Этап 12/,'Locked stage must deny student');
  await db.query("UPDATE public.game_stages SET status='open' WHERE stage_no=12");
  await run();
  await db.query("UPDATE public.game_stages SET deadline=now()-interval '1 minute' WHERE stage_no=12");
  await assert.rejects(run(),/Этап 12/,'Expired stage must deny student');
  await db.query("UPDATE public.game_stages SET deadline=now()+interval '2 hour' WHERE stage_no=12");
  await db.query("UPDATE public.games SET turn_open=false");
  await assert.rejects(run(),/Этап 12/,'Paused turn denies student');
  await db.query("UPDATE private.teacher_flag SET value=true");
  await run();
  console.log('PASS: Stage 12 RPC gate denies locked/expired/paused state, accepts open stage, preserves teacher override and all five procedure checks.');
 }finally{await db.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
