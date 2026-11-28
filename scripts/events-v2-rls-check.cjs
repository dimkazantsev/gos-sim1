'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const id=n=>'26000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();try{
 for(const p of ['scripts/events-v2-individual-fixture.sql','supabase/changes/events_v2_individual_transfer_candidate.sql','supabase/changes/events_v2_collective_candidate.sql','scripts/events-v2-rls-fixture.sql','supabase/changes/events_v2_security_candidate.sql'])await db.exec(fs.readFileSync(p,'utf8'));
 await db.exec('SET check_function_bodies=on');
 const g=id(1),foreign=id(2),c=id(3),closed=id(4),otherCase=id(5),teacher=id(10),guest=id(11),sender=id(12),receiver=id(13),unassigned=id(14),blocked=id(15),archived=id(16),outsider=id(17),inv=id(18);
 const q=(s,a=[])=>db.query(s,a),rows=async(s,a=[])=>(await q(s,a)).rows;
 for(const [game,u,k,arch] of [[g,teacher,'teacher',null],[g,guest,'observer',null],[g,sender,'student',null],[g,receiver,'student',null],[g,unassigned,'student',null],[g,blocked,'student',null],[g,archived,'student',new Date().toISOString()],[foreign,outsider,'student',null]])await q('INSERT INTO game_members VALUES($1,$2,$3,$4,$5)',[game,u,k,arch,'Участник']);
 await q('INSERT INTO game_member_access_blocks VALUES($1,$2)',[g,blocked]);
 const plan={rules_version:2,best_option_key:'option_1',competence:{portfolio_keys:['economic'],committee_before_9:true},options:[{key:'option_1',trust:1,lawful:true,description:'SECRET_FEEDBACK',legal_basis:'Закон',authorized_roles:['депутат']},{key:'option_2',trust:0,lawful:true}]};
 for(const [k,game] of [[c,g],[closed,g],[otherCase,foreign]])await q("INSERT INTO event_cases(id,game_id,audience,status,effect_plan,decision_options,title,comic_scene) VALUES($1,$2,'single','ready',$3::jsonb,'[\"А\",\"Б\"]','Кейс','{\"event_rules_version\":2}')",[k,game,JSON.stringify(plan)]);
 for(const [k,game,u] of [[c,g,receiver],[closed,g,receiver],[closed,g,blocked],[closed,g,archived],[otherCase,foreign,outsider]])await q("INSERT INTO event_assignments(case_id,game_id,recipient_id,stage_no) VALUES($1,$2,$3,7)",[k,game,u]);
 await q("INSERT INTO event_collaboration_invites(id,case_id,game_id,inviter_id,recipient_id,status,transfer_stage_no) VALUES($1,$2,$3,$4,$5,'accepted',7)",[inv,c,g,sender,receiver]);
 await q("INSERT INTO event_case_outcomes(case_id,game_id,winner) VALUES($1,$2,'option_1')",[closed,g]);
 await q("INSERT INTO event_authority_evidence(decision_id,case_id,game_id,actor_id,stage_no,authority_ok,lawful,best_option,score_share) VALUES($1,$2,$3,$4,7,true,true,true,1)",[id(20),closed,g,receiver]);
 async function as(u,role='authenticated'){await db.exec('RESET ROLE');await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[u||'']);await db.exec('SET ROLE '+role)}
 const project=async(game=g)=>(await rows('SELECT public.get_event_workspace_feed_bootstrap($1,true) AS v',[game]))[0].v;
 const details=async(game=g,keys=[c,closed])=>(await rows('SELECT public.list_visible_event_cases($1,$2) AS v',[game,keys]))[0].v;
 const denied=e=>e.code==='42501'||/недоступ|доступ|access/i.test(e.message);
 for(const u of [receiver,sender,unassigned,guest]){
  await as(u);const snap=await project();assert.equal(snap.ready_case_count,null);
  assert.ok(!JSON.stringify(snap).includes('best_option_key'));
  const all=await details();assert.equal(all.find(x=>x.id===c).effect_plan,null);
  assert.equal(all.find(x=>x.id===closed).effect_plan.best_option_key,'option_1');
  await assert.rejects(()=>rows('SELECT effect_plan FROM public.event_cases'),denied);
  await assert.rejects(()=>rows('SELECT public.get_event_decision_feedback($1)',[c]),denied);
  assert.deepEqual(await details(foreign,[otherCase]),[]);await assert.rejects(()=>project(foreign),denied);
  if(u===sender)assert.equal(snap.invitations.length,1);
  if(u===unassigned)assert.equal(snap.assignments.length,0);
 }
 await as(teacher);assert.equal((await project()).ready_case_count,2);assert.equal((await details()).find(x=>x.id===c).effect_plan.best_option_key,'option_1');
 for(const u of [blocked,archived,outsider]){
  await as(u);await assert.rejects(project,denied);assert.deepEqual(await details(),[]);
  for(const tab of ['event_assignments','event_decisions','event_case_outcomes','event_collaboration_invites','event_authority_evidence','event_cases'])assert.equal((await rows('SELECT count(*)::int n FROM public.'+tab+' WHERE game_id=$1',[g]))[0].n,0,tab);
  await assert.rejects(()=>rows('SELECT public.get_event_decision_feedback($1)',[closed]),denied);
  await assert.rejects(()=>rows('SELECT public.invite_event_collaborator($1,$2)',[closed,receiver]),denied);
  await assert.rejects(()=>rows('SELECT public.send_event_discussion($1,$2)',[closed,'Тест']),denied);
  await assert.rejects(()=>rows('SELECT public.cancel_event_invitation($1)',[inv]),denied);
 }
 await as(guest);await assert.rejects(()=>rows('SELECT public.finalize_event_case_round($1,1)',[c]),/Teacher|required|преподавател/i);
 await as(null,'anon');await assert.rejects(project,denied);await assert.rejects(details,denied);
 await db.exec('RESET ROLE');assert.equal((await rows("SELECT has_table_privilege('authenticated','public.event_cases','TRUNCATE') AS ok"))[0].ok,false);
 console.log('PASS V2 actual projection and case-detail functions: teacher, guest, student, transfer sender/receiver, unrelated, blocked/archived, foreign game, anon; answer key hidden until outcome; no direct private column');
 }finally{await db.close()}})().catch(e=>{console.error(e.code??'ERROR',e.message,e.where??'');process.exitCode=1});
