'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261023135956_stage12_speaker_order.sql','utf8');
const ui=fs.readFileSync('components/game/Stage12ReadingWorkspace.tsx','utf8');
const order=fs.readFileSync('components/game/Stage12SpeakerOrder.tsx','utf8');
assert(ui.indexOf('<ol className={styles.steps}')<ui.indexOf('{meetingButton}')&&ui.indexOf('{meetingButton}')<ui.indexOf('<section className={styles.billFiling}'),'Meeting disclosure must precede the blue filing action');
assert(ui.includes('const [meetingOpen,setMeetingOpen]=useState(false)'),'Meeting collapsed initially');
assert(order.includes("set_stage12_speaker_order")&&order.includes('move(index,-1)')&&order.includes('move(index,1)'),'Speaker order saved and reordable');
const id=n=>'70000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();try{
  await db.exec(`
  CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA private;
  CREATE TABLE private.actor(uid uuid,teacher boolean,member boolean,active boolean,role text,registered boolean);
  INSERT INTO private.actor VALUES('${id(3)}',false,true,true,'Председатель Государственной Думы',true);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT uid FROM private.actor$$;
  CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT teacher FROM private.actor$$;
  CREATE FUNCTION private.is_game_member(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT member FROM private.actor$$;
  CREATE FUNCTION private.role_is_available(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT active FROM private.actor$$;
  CREATE FUNCTION private.game_role(uuid,uuid) RETURNS text LANGUAGE sql AS $$SELECT role FROM private.actor$$;
  CREATE FUNCTION private.require_duma_stage_open(uuid,integer) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END;$$;
  CREATE FUNCTION private.require_game_meeting_registration(uuid,uuid,integer,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
    IF NOT (SELECT registered FROM private.actor) THEN RAISE EXCEPTION 'Registration required';END IF;END;$$;
  CREATE TABLE public.duma_sessions(id uuid PRIMARY KEY,game_id uuid,stage_no integer,status text);
  CREATE TABLE public.duma_agenda_items(id uuid PRIMARY KEY,session_id uuid,game_id uuid,status text,agenda_no integer,formal_document_id uuid,opened_document_step text);
  CREATE TABLE public.game_office_assignments(game_id uuid,user_id uuid,status text,role_title text);
  CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
  CREATE TABLE public.formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,from_status text,to_status text,note text);
  `);
  await db.exec(sql);
  await db.query("INSERT INTO public.duma_sessions VALUES($1,$2,12,'draft')",[id(10),id(1)]);
  await db.query("INSERT INTO public.duma_agenda_items VALUES($1,$2,$3,'pending',1,$4,'reading1')",[id(11),id(10),id(1),id(12)]);
  await db.query("INSERT INTO public.game_members VALUES($1,$2,'student',NULL),($1,$3,'student',NULL)",[id(1),id(3),id(4)]);
  await db.query("SELECT public.set_stage12_speaker_order($1,$2::uuid[])",[id(11),[id(3),id(4)]]);
  assert.deepEqual((await db.query("SELECT speaker_order::text[] AS ids FROM public.duma_agenda_items WHERE id=$1",[id(11)])).rows[0].ids,[id(3),id(4)]);
  await db.query("SELECT public.set_stage12_speaker_order($1,$2::uuid[])",[id(11),[id(4),id(3)]]);
  assert.deepEqual((await db.query("SELECT speaker_order::text[] AS ids FROM public.duma_agenda_items WHERE id=$1",[id(11)])).rows[0].ids,[id(4),id(3)]);
  await assert.rejects(db.query("SELECT public.set_stage12_speaker_order($1,$2::uuid[])",[id(11),[id(4),id(4)]]),/до 40 разных участников/);
  await assert.rejects(db.query("SELECT public.set_stage12_speaker_order($1,$2::uuid[])",[id(11),[id(9)]]),/посторонний участник/);
  await db.query("UPDATE private.actor SET role='Член Совета Государственной Думы'");
  await assert.rejects(db.query("SELECT public.set_stage12_speaker_order($1,$2::uuid[])",[id(11),[id(4)]]),/председатель ГД/);
  await db.query("UPDATE private.actor SET role='Заместитель Председателя Государственной Думы'");
  await db.query("SELECT public.set_stage12_speaker_order($1,$2::uuid[])",[id(11),[id(4)]]);
  await db.query("UPDATE private.actor SET registered=false");
  await db.query("UPDATE public.duma_sessions SET status='open'");
  await assert.rejects(db.query("SELECT public.set_stage12_speaker_order($1,$2::uuid[])",[id(11),[id(3)]]),/Registration required/);
  await db.query("UPDATE private.actor SET registered=true,teacher=true");
  await db.query("SELECT public.set_stage12_speaker_order($1,$2::uuid[])",[id(11),[id(3)]]);
  await db.query("UPDATE public.duma_sessions SET status='closed'");
  await assert.rejects(db.query("SELECT public.set_stage12_speaker_order($1,$2::uuid[])",[id(11),[id(4)]]),/завершённое заседание/);
  console.log('PASS: automatic collapsed layout, teacher/chair/deputy permissions, council denial, unique active speakers, registration and closed-session guards.');
 }finally{await db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
