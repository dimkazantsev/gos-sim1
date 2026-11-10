const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const path='supabase/migrations/20261110164500_regional_party_competent_fair_dispatch.sql';
const migration=fs.readFileSync(path,'utf8');
const uid=n=>'a0000000-0000-0000-0000-'+String(n).padStart(12,'0');

async function run(){
 const db=new PGlite();
 try{
  await db.exec([
   "CREATE SCHEMA private;",
   "CREATE TABLE public.games(id uuid PRIMARY KEY,current_round integer);",
   "CREATE TABLE public.game_stages(game_id uuid,stage_no integer,status text);",
   "CREATE TABLE public.event_auto_settings(game_id uuid PRIMARY KEY,enabled boolean,interval_hours integer,activity_weight numeric,max_daily integer,last_run_at timestamptz,last_dispatched_at timestamptz);",
   "CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,role_title text,team text,roster_archived_at timestamptz);",
   "CREATE TABLE public.game_presence(game_id uuid,user_id uuid,last_seen_at timestamptz);",
   "CREATE TABLE public.game_office_assignments(game_id uuid,user_id uuid,role_title text,status text);",
   "CREATE TABLE public.game_parties(id uuid,game_id uuid,name text);",
   "CREATE TABLE public.event_cases(id uuid PRIMARY KEY,game_id uuid,status text,audience text,allowed_roles text[],seriousness text);",
   "CREATE TABLE public.event_case_routing(game_id uuid,case_id uuid,region_code text,destination text,earliest_stage integer,latest_stage integer,requires_office boolean);",
   "CREATE TABLE public.game_region_party_control(game_id uuid,region_code text,party_id uuid);",
   "CREATE TABLE public.event_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid,game_id uuid,recipient_id uuid,created_by uuid,status text DEFAULT 'pending',created_at timestamptz DEFAULT now());",
   "CREATE TABLE public.event_case_outcomes(case_id uuid);",
   "CREATE FUNCTION private.apply_event_trust(uuid) RETURNS void LANGUAGE plpgsql AS $$begin return;end;$$;",
   "CREATE FUNCTION private.ensure_event_case_routing(uuid) RETURNS integer LANGUAGE sql AS $$select 0$$;"
  ].join('\n'));
  await db.exec(migration);

  const game=uid(1),partyA=uid(2),partyB=uid(3),caseA=uid(4),caseB=uid(5);
  const governorA=uid(10),governorB=uid(11),unqualifiedA=uid(12),unqualifiedB=uid(13);
  await db.query("INSERT INTO public.games VALUES($1,13)",[game]);
  await db.query("INSERT INTO public.game_stages VALUES($1,13,'open')",[game]);
  await db.query("INSERT INTO public.event_auto_settings(game_id,enabled,interval_hours,activity_weight,max_daily) VALUES($1,true,12,1,2)",[game]);
  await db.query("INSERT INTO public.game_parties VALUES($1,$3,'Первая партия'),($2,$3,'Вторая партия')",[partyA,partyB,game]);
  for(const [id,team,role] of [[governorA,'Первая партия','Губернатор'],[unqualifiedA,'Первая партия','Депутат Государственной Думы'],[governorB,'Вторая партия','Губернатор'],[unqualifiedB,'Вторая партия','Председатель партии']])
   await db.query('INSERT INTO public.game_members VALUES($1,$2,$3,$4,$5,NULL)',[game,id,'student',role,team]);
  await db.query("INSERT INTO public.event_cases VALUES($1,$3,'ready','all',ARRAY['губернатор'],'serious'),($2,$3,'ready','all',ARRAY['губернатор'],'serious')",[caseA,caseB,game]);
  await db.query("INSERT INTO public.event_case_routing VALUES($1,$2,'01','regional',4,15,true),($1,$3,'02','regional',4,15,true)",[game,caseA,caseB]);
  await db.query("INSERT INTO public.game_region_party_control VALUES($1,'01',$2),($1,'02',$3)",[game,partyA,partyB]);

  let first=(await db.query('SELECT private.run_game_autopilot($1) AS value',[game])).rows[0].value;
  assert.equal(first.sent,1,'Only one regional responsible official, not all party members');
  let assignments=(await db.query('SELECT case_id,recipient_id FROM public.event_assignments WHERE game_id=$1',[game])).rows;
  assert.equal(assignments.length,1);
  assert([governorA,governorB].includes(assignments[0].recipient_id),'Deputy or party chair cannot sign as governor');
  const chosen=assignments[0].recipient_id===governorA?partyA:partyB;
  const other=chosen===partyA?partyB:partyA;
  let settings=(await db.query('SELECT last_regional_party_id FROM public.event_auto_settings WHERE game_id=$1',[game])).rows[0];
  assert.equal(settings.last_regional_party_id,chosen,'Last controlling party stored in existing settings row');

  // Cron still runs hourly, but its game cooldown prohibits more assignments
  // until a whole-game interval has passed. No extra queries or cron jobs.
  await db.query("UPDATE public.event_auto_settings SET last_run_at=now()-interval '2 hours' WHERE game_id=$1",[game]);
  const tooSoon=(await db.query('SELECT private.run_game_autopilot($1) AS value',[game])).rows[0].value;
  assert.equal(tooSoon.reason,'game_cooldown');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.event_assignments WHERE game_id=$1',[game])).rows[0].n,1);

  await db.query("UPDATE public.event_auto_settings SET last_run_at=now()-interval '2 hours',last_dispatched_at=now()-interval '13 hours' WHERE game_id=$1",[game]);
  const second=(await db.query('SELECT private.run_game_autopilot($1) AS value',[game])).rows[0].value;
  assert.equal(second.sent,1,'Second case dispatched after 12-hour cooldown');
  const after=(await db.query('SELECT last_regional_party_id FROM public.event_auto_settings WHERE game_id=$1',[game])).rows[0];
  assert.equal(after.last_regional_party_id,other,'Prefer the other party when eligible');
  assignments=(await db.query('SELECT case_id,recipient_id FROM public.event_assignments WHERE game_id=$1',[game])).rows;
  assert.equal(assignments.length,2);
  assert.equal(new Set(assignments.map(a=>a.case_id)).size,2,'No repeated official case');
  assert(!assignments.some(a=>[unqualifiedA,unqualifiedB].includes(a.recipient_id)),'Party membership alone never grants legal authority');

  // The current real-game state: student deputies and party leaders exist but
  // no player has a regional competent office. Nothing should be auto-signed.
  const game2=uid(100),case2=uid(101),party2=uid(102),deputy2=uid(103);
  await db.query('INSERT INTO public.games VALUES($1,6)',[game2]);
  await db.query("INSERT INTO public.game_stages VALUES($1,6,'open')",[game2]);
  await db.query("INSERT INTO public.event_auto_settings(game_id,enabled,interval_hours,activity_weight,max_daily) VALUES($1,true,12,1,2)",[game2]);
  await db.query("INSERT INTO public.game_parties VALUES($1,$2,'Третья партия')",[party2,game2]);
  await db.query("INSERT INTO public.game_members VALUES($1,$2,'student','Депутат Государственной Думы','Третья партия',NULL)",[game2,deputy2]);
  await db.query("INSERT INTO public.event_cases VALUES($1,$2,'ready','all',ARRAY['губернатор'],'serious')",[case2,game2]);
  await db.query("INSERT INTO public.event_case_routing VALUES($1,$2,'03','regional',4,15,true)",[game2,case2]);
  await db.query("INSERT INTO public.game_region_party_control VALUES($1,'03',$2)",[game2,party2]);
  const noGov=(await db.query('SELECT private.run_game_autopilot($1) AS value',[game2])).rows[0].value;
  assert.equal(noGov.sent,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.event_assignments WHERE game_id=$1',[game2])).rows[0].n,0);
  console.log('PASS: party routing, one-per-game cooldown, legal regional office, party rotation, no unqualified decisions, no extra cron.');
 }finally{await db.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
