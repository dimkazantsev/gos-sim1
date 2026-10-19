const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const original=fs.readFileSync('scripts/fixtures/stage7-cec-protocol-source-20261020.sql','utf8');
const migration=fs.readFileSync('supabase/migrations/20261020072000_stage7_cec_publish_after_finalization.sql','utf8');
const panel=fs.readFileSync('components/game/PresidentialCecPublicationPanel.tsx','utf8');
const css=fs.readFileSync('app/stage7-election.css','utf8');
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
assert(original.includes('Публикация итогов возможна только после 20:00 третьего дня выборов'));
assert(migration.includes("IF v_s.status<>''finished''"));
assert(migration.includes("PERFORM pg_advisory_xact_lock(hashtextextended(v_source,0))"));
assert(panel.includes('cecProtocolActions'));
assert(panel.includes('cecProtocolPreview'));
assert(panel.includes('cecProtocolError'));
assert(!panel.includes('g.setError(userError(r.error))'));
assert(css.includes('.stage7Election .cecProtocolActions{display:grid;grid-template-columns:repeat(2'));
assert(css.includes('.stage7Election .cecProtocolNotice,.stage7Election .cecProtocolError{position:static'));
assert(css.includes('@media(max-width:620px){.stage7Election .cecProtocolPanel>.stage7Grid,.stage7Election .cecProtocolActions{grid-template-columns:1fr'));

(async()=>{
 const db=new PGlite();
 try{
 await db.exec(`
 CREATE SCHEMA auth;CREATE SCHEMA private;
 CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
 CREATE TABLE public.presidential_election_settings(game_id uuid PRIMARY KEY,status text,result jsonb,system_type text,threshold_pct numeric,jury_size integer,poll_enabled boolean);
 CREATE TABLE public.presidential_election_schedule(game_id uuid PRIMARY KEY,voting_day date);
 CREATE TABLE public.presidential_candidates(id uuid PRIMARY KEY,game_id uuid,user_id uuid,display_name text,registration_status text,archived_at timestamptz);
 CREATE TABLE public.presidential_inauguration(game_id uuid PRIMARY KEY,scheduled_at timestamptz,venue text);
 CREATE TABLE public.game_office_assignments(game_id uuid,user_id uuid,status text,role_title text);
 CREATE TABLE public.political_posts(id uuid PRIMARY KEY,game_id uuid,author_id uuid,process_type text,actor_key text,actor_label text,title text,body text,tags text[],internal_view text,status text,source_key text UNIQUE,context jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
 CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.game_members gm WHERE gm.game_id=g AND gm.user_id=auth.uid() AND gm.kind='teacher' AND gm.roster_archived_at IS NULL) $fn$;
 CREATE FUNCTION private.require_active_presidential_teacher(g uuid) RETURNS void LANGUAGE plpgsql AS $fn$
 BEGIN IF NOT private.is_game_teacher(g) THEN RAISE EXCEPTION 'Преподаватель не уполномочен';END IF;END $fn$;
 CREATE FUNCTION private.office_family(role_title text) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
 SELECT CASE WHEN role_title='Президент Российской Федерации' THEN 'president' ELSE NULL END $fn$;
 `);
 await db.exec(original);
 await db.exec(migration);
 const publish=async game=>db.query("SELECT public.publish_presidential_cec_protocol($1,78,45,false,null) AS post",[game]);
 const identity=async who=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[who]);
 async function seed(game,candidate,user,status='finished',withDate=true){
  const result=JSON.stringify({winner_id:candidate,round:1,status,calculation:{poll_enabled:false,rows:[{name:'Избранный кандидат',program_pct:65,campaign_pct:70,game_pct:60,result_pct:65}]}});
  await db.query("INSERT INTO public.game_members VALUES($1,$2,'student',NULL)",[game,user]);
  await db.query("INSERT INTO public.presidential_candidates VALUES($1,$2,$3,'Избранный кандидат','registered',NULL)",[candidate,game,user]);
  await db.query("INSERT INTO public.presidential_election_settings VALUES($1,$2,$3,'relative',50,8,false)",[game,status,result]);
  if(withDate)await db.query("INSERT INTO public.presidential_election_schedule VALUES($1,current_date + interval '10 days')",[game]);
 }
 const g=id(1),candidate=id(2),winner=id(3),teacher=id(4);
 await seed(g,candidate,winner);
 await db.query("INSERT INTO public.game_members VALUES($1,$2,'teacher',NULL)",[g,teacher]);
 await identity(teacher);
 const first=(await publish(g)).rows[0].post;
 assert.ok(first,'early publishing should produce a real post UUID');
 const second=(await publish(g)).rows[0].post;
 assert.equal(first,second,'repeat must return same published post');
 const posts=(await db.query("SELECT body,context,actor_key FROM public.political_posts WHERE game_id=$1",[g])).rows;
 assert.equal(posts.length,1);
 assert.equal(posts[0].actor_key,'cec');
 assert.match(posts[0].body,/Игровой рейтинг \(процент, установленный преподавателем от 0 до 100\)/);
 assert.doesNotMatch(posts[0].body,/баллы кандидата \/ сумма баллов/);
 assert.equal(posts[0].context.winner_id,candidate);
 const missing=id(11),missingC=id(12),missingU=id(13);
 await seed(missing,missingC,missingU,'round1');
 await db.query("INSERT INTO public.game_members VALUES($1,$2,'teacher',NULL)",[missing,teacher]);
 await assert.rejects(()=>publish(missing),/Результаты ещё не утверждены ЦИК/);
 const unregistered=id(21),unc=id(22),unu=id(23);
 await seed(unregistered,unc,unu);
 await db.query("INSERT INTO public.game_members VALUES($1,$2,'teacher',NULL)",[unregistered,teacher]);
 await db.query("UPDATE public.presidential_candidates SET registration_status='withdrawn' WHERE id=$1",[unc]);
 await assert.rejects(()=>publish(unregistered),/действующий зарегистрированный кандидат/);
 const unscheduled=id(31),usc=id(32),usu=id(33);
 await seed(unscheduled,usc,usu,'finished',false);
 await db.query("INSERT INTO public.game_members VALUES($1,$2,'teacher',NULL)",[unscheduled,teacher]);
 await assert.rejects(()=>publish(unscheduled),/Выборы не назначены/);
 const conflict=id(41),cc=id(42),cu=id(43);
 await seed(conflict,cc,cu);
 await db.query("INSERT INTO public.game_members VALUES($1,$2,'teacher',NULL)",[conflict,teacher]);
 await db.query("INSERT INTO public.game_office_assignments VALUES($1,$2,'active','Президент Российской Федерации')",[conflict,id(44)]);
 await assert.rejects(()=>publish(conflict),/Должность Президента уже занята/);
 for(let n=0;n<40;n++){
  const student=id(100+n);await db.query("INSERT INTO public.game_members VALUES($1,$2,'student',NULL)",[g,student]);await identity(student);
  await assert.rejects(()=>publish(g),/Преподаватель не уполномочен/);
 }
 await identity(teacher);
 await db.query("UPDATE public.game_members SET roster_archived_at=now() WHERE game_id=$1 AND user_id=$2",[g,teacher]);
 await assert.rejects(()=>publish(g),/Преподаватель не уполномочен/);
 console.log('PASS: ранняя публикация, единый протокол с процентами, идемпотентность, 40 студентов, архивный преподаватель, статусы, дата, кандидат, конфликт назначений, адаптивная панель.');
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
