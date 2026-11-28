'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const uid=n=>'22000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [game,other,sender,expert,wrong,archived,outsider,teacher]=[1,2,10,11,12,13,14,15].map(uid);
(async()=>{
 const db=new PGlite();
 try{
 await db.exec(fs.readFileSync('scripts/events-v2-individual-fixture.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/changes/events_v2_individual_transfer_candidate.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/changes/events_v2_collective_candidate.sql','utf8'));
 await db.exec("SET check_function_bodies=on; CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON event_assignments FOR EACH ROW EXECUTE FUNCTION private.guard_event_assignment(); CREATE TRIGGER snapshot BEFORE INSERT ON event_decisions FOR EACH ROW EXECUTE FUNCTION private.snapshot_event_office(); CREATE TRIGGER authority AFTER INSERT ON event_case_outcomes FOR EACH ROW EXECUTE FUNCTION private.record_event_authority();");
 const query=(s,args=[])=>db.query(s,args), rows=async(s,args=[]) =>(await query(s,args)).rows;
 const auth=async u=>query("SELECT set_config('request.jwt.claim.sub',$1,false)",[u]);
 for(const [g,u,k,r,a] of [[game,sender,'student','Министр культуры',null],[game,expert,'student','Министр финансов',null],[game,wrong,'student','Депутат',null],[game,archived,'student','Министр финансов',new Date().toISOString()],[other,outsider,'student','Министр финансов',null],[game,teacher,'teacher','Преподаватель',null]])await query('INSERT INTO game_members VALUES($1,$2,$3,$4,$5)',[g,u,k,a,r]);
 await query("INSERT INTO game_stages(game_id,stage_no,status,deadline) VALUES($1,7,'open',now()+interval '1 day')",[game]);
 await query("INSERT INTO state_metrics(game_id,metric_key,value,min_value,max_value) VALUES($1,'lawfulness',50,0,100)",[game]);
 await query("INSERT INTO institution_units VALUES($1,$2,'committee','economic',$3),($4,$2,'ministry','economic',$3),($5,$2,'committee','social',$6)",[uid(201),game,expert,uid(202),uid(203),wrong]);
 await query("INSERT INTO institution_assignments VALUES($1,$2,'committee',$3,'head'),($1,$4,'ministry',$3,'head'),($1,$5,'committee',$6,'head')",[game,uid(201),expert,uid(202),uid(203),wrong]);
 await query("INSERT INTO party_member_mandates VALUES($1,$2,1),($1,$3,1)",[game,expert,wrong]);
 await query("INSERT INTO government_nominations VALUES($1,9,'ministry_economic','appointed',$2,'Министерство по экономической политике')",[game,expert]);
 await query("INSERT INTO game_office_assignments VALUES($1,$2,'Министерство по экономической политике','active')",[game,expert]);
 const plan={rules_version:2,competence:{portfolio_keys:['economic'],committee_before_9:true},best_option_key:'option_1',options:[{key:'option_1',lawful:true,public_interest:'beneficial',authorized_roles:['министр финансов']},{key:'option_2',lawful:true,public_interest:'neutral',authorized_roles:['министр финансов']}]};
 const create=async(n,u,legacy=false,stage=7,routePlan=plan)=>{const c=uid(n);const p={...routePlan};if(legacy)delete p.rules_version;await query("INSERT INTO event_cases(id,game_id,audience,status,effect_plan,decision_options,title) VALUES($1,$2,'single','ready',$3::jsonb,'[\"Первое\",\"Второе\"]','Кейс')",[c,game,JSON.stringify(p)]);await query("INSERT INTO event_case_routing VALUES($1,$2,4,15,'individual',NULL)",[game,c]);await query('INSERT INTO event_assignments(case_id,game_id,recipient_id,stage_no) VALUES($1,$2,$3,$4)',[c,game,u,stage]);return c;};
 const assign=async c=>(await rows('SELECT id,recipient_id,stage_no,status FROM event_assignments WHERE case_id=$1',[c]));
 const offer=async(c,from,to)=>{await auth(from);await query('SELECT public.invite_event_collaborator($1,$2)',[c,to]);return (await rows('SELECT id FROM event_collaboration_invites WHERE case_id=$1 AND recipient_id=$2',[c,to]))[0].id};
 const respond=async(id,u,accept=true)=>{await auth(u);await query('SELECT public.respond_event_invitation($1,$2)',[id,accept])};
 const score=async u=>Number((await rows("SELECT private.blitz_vsn_components($1,$2,7)->>'cases_right' AS n",[game,u]))[0].n);
 const vote=async(c,u,choice)=>{await auth(u);const a=(await assign(c))[0];await query('INSERT INTO event_decisions(assignment_id,case_id,game_id,actor_id,choice) VALUES($1,$2,$3,$4,$5)',[a.id,c,game,u,choice]);await query('UPDATE event_assignments SET status=$2 WHERE id=$1',[a.id,'resolved']);await query('INSERT INTO event_case_outcomes(case_id,game_id,winner) VALUES($1,$2,$3)',[c,game,choice]);};
 const c=await create(101,sender), original=(await assign(c))[0];
 const entitled=async(c,u)=>(await rows('SELECT private.event_v2_competent($1,$2) AS ok',[c,u]))[0].ok;
 assert.equal(await entitled(c,expert),true);assert.equal(await entitled(c,wrong),false);
 assert.equal(await entitled(c,archived),false);assert.equal(await entitled(c,outsider),false);assert.equal(await entitled(c,teacher),false);
 await query("UPDATE game_members SET role_title='Министр финансов' WHERE user_id=$1",[wrong]);
 assert.equal(await entitled(c,wrong),false,'A misleading primary title does not grant committee authority');
 await query("UPDATE game_members SET role_title='Депутат' WHERE user_id=$1",[wrong]);
 await query('INSERT INTO fixture_suspended VALUES($1,$2)',[game,expert]);assert.equal(await entitled(c,expert),false);
 await query('DELETE FROM fixture_suspended');
 await query('UPDATE party_member_mandates SET effective_mandates=0 WHERE user_id=$1',[expert]);assert.equal(await entitled(c,expert),false);
 await query('UPDATE party_member_mandates SET effective_mandates=1 WHERE user_id=$1',[expert]);
 const later=await create(120,sender,false,9);assert.equal(await entitled(later,expert),true);
 await query("UPDATE game_office_assignments SET status='ended' WHERE user_id=$1",[expert]);assert.equal(await entitled(later,expert),false);
 await query("UPDATE game_office_assignments SET status='active' WHERE user_id=$1",[expert]);
 await assert.rejects(()=>create(121,sender,false,7,{...plan,competence:{portfolio_keys:['economic'],committee_before_9:false}}),/нет компетентного участника/);
 await assert.rejects(()=>query('UPDATE event_assignments SET stage_no=9 WHERE case_id=$1',[c]),/Исходный этап/);
 assert.equal((await rows("SELECT has_function_privilege('authenticated','private.event_v2_competent_at_stage(uuid,uuid,integer)','EXECUTE') AS ok"))[0].ok,false);
 await assert.rejects(()=>offer(c,sender,outsider),/другого участника/);
 await assert.rejects(()=>offer(c,sender,archived),/другого участника/);
 const bad=await offer(c,sender,wrong);await respond(bad,wrong);
 assert.equal((await assign(c))[0].recipient_id,sender);assert.equal(await score(sender),0);
 assert.equal((await rows('SELECT status FROM event_collaboration_invites WHERE id=$1',[bad]))[0].status,'declined');
 const invitation=await offer(c,sender,expert);
 await assert.rejects(()=>offer(c,sender,wrong),/Передача ситуации недоступна/);
 await assert.rejects(()=>respond(invitation,wrong),/Приглашение недоступно/);
 await respond(invitation,expert,false);assert.equal((await assign(c))[0].recipient_id,sender);assert.equal(await score(sender),0);
 const second=await offer(c,sender,expert);await respond(second,expert);
 const after=await assign(c);assert.equal(after.length,1);assert.equal(after[0].id,original.id);assert.equal(after[0].stage_no,7);assert.equal(after[0].recipient_id,expert);
 assert.equal(await score(sender),.5);assert.equal(await score(expert),0);
 await assert.rejects(()=>respond(second,expert),/уже закрыто/);
 await assert.rejects(()=>offer(c,expert,wrong),/Передача ситуации недоступна/);
 await auth(sender);await assert.rejects(()=>query('INSERT INTO event_decisions(assignment_id,case_id,game_id,actor_id,choice) VALUES($1,$2,$3,$4,$5)',[original.id,c,game,sender,'option_1']),/Некорректное назначение/);
 await vote(c,expert,'option_2');assert.equal(await score(sender),.5);assert.equal(await score(expert),0);
 const c2=await create(102,sender);await respond(await offer(c2,sender,expert),expert);await vote(c2,expert,'option_1');assert.equal(await score(sender),1);assert.equal(await score(expert),.5);
 const c3=await create(103,expert);await respond(await offer(c3,expert,sender),sender);assert.equal((await assign(c3))[0].recipient_id,expert);await vote(c3,expert,'option_1');assert.equal(await score(expert),1.5);
 const limitCase=await create(105,sender);await respond(await offer(limitCase,sender,wrong),wrong);await respond(await offer(limitCase,sender,wrong),wrong,false);await assert.rejects(()=>offer(limitCase,sender,expert),/Две ошибочные передачи/);
 const legacy=await create(104,sender,true);await respond(await offer(legacy,sender,expert),expert);assert.equal((await assign(legacy)).length,2,'Legacy invitation is unchanged');
 assert.equal((await rows("SELECT count(*)::int n FROM event_collaboration_invites WHERE transfer_stage_no IS NOT NULL"))[0].n,2);
 assert.equal((await rows("SELECT has_function_privilege('authenticated','private.event_v2_competent(uuid,uuid)','EXECUTE') AS ok"))[0].ok,false);
 await query("INSERT INTO games VALUES($1,$2)",[game,teacher]);await query("INSERT INTO state_metrics(game_id,metric_key,value,min_value,max_value) VALUES($1,'elite_support',50,0,100),($1,'social_tension',50,0,100)",[game]);
 const cc=uid(110);const cp={rules_version:2,options:[{key:'option_1',lawful:true,trust:2,metric_effects:{elite_support:-2,social_tension:-1}},{key:'option_2',lawful:true,trust:-1,metric_effects:{elite_support:2,social_tension:1}},{key:'option_3',lawful:true,trust:0,metric_effects:{}}]};
 await query("INSERT INTO event_cases(id,game_id,audience,status,effect_plan,decision_options,title) VALUES($1,$2,'all','ready',$3::jsonb,'[\"А\",\"Б\",\"В\"]','Дилемма')",[cc,game,JSON.stringify(cp)]);
 for(const u of [sender,expert,wrong])await query("INSERT INTO event_assignments(case_id,game_id,recipient_id,stage_no) VALUES($1,$2,$3,7)",[cc,game,u]);
 const ballot=async(u,key)=>{await auth(u);const a=(await rows('SELECT id FROM event_assignments WHERE case_id=$1 AND recipient_id=$2',[cc,u]))[0];await query('SELECT public.submit_event_decision($1,$2,NULL)',[a.id,key]);};
 const law=Number((await rows("SELECT value FROM state_metrics WHERE game_id=$1 AND metric_key='lawfulness'",[game]))[0].value);
 await ballot(sender,'option_1');await ballot(expert,'option_2');await ballot(wrong,'option_3');
 assert.equal((await rows('SELECT count(*)::int n FROM event_case_outcomes WHERE case_id=$1',[cc]))[0].n,0);
 assert.equal((await rows("SELECT (comic_scene->>'vote_round')::int n FROM event_cases WHERE id=$1",[cc]))[0].n,2);
 assert.equal((await rows("SELECT count(*)::int n FROM event_trust_ledger WHERE action_key=$1",['choice-'+cc]))[0].n,0);
 await assert.rejects(()=>ballot(sender,'option_1'),/второй тур/);
 await ballot(sender,'round2:option_1');await ballot(expert,'round2:option_1');await ballot(wrong,'round2:option_2');
 assert.equal((await rows('SELECT winner FROM event_case_outcomes WHERE case_id=$1',[cc]))[0].winner,'option_1');
 assert.deepEqual((await rows('SELECT collective_metric_effects FROM event_case_outcomes WHERE case_id=$1',[cc]))[0].collective_metric_effects,{elite_support:-2,social_tension:-1});
 assert.equal((await rows('SELECT count(*)::int n FROM event_decisions WHERE case_id=$1',[cc]))[0].n,6);
 assert.equal((await rows('SELECT count(*)::int n FROM event_authority_evidence WHERE case_id=$1',[cc]))[0].n,0);
 assert.equal(Number((await rows("SELECT value FROM state_metrics WHERE game_id=$1 AND metric_key='lawfulness'",[game]))[0].value),law);
 assert.equal(Number((await rows("SELECT value FROM state_metrics WHERE game_id=$1 AND metric_key='elite_support'",[game]))[0].value),48);
 await auth(teacher);await query('SELECT public.finalize_event_case_round($1,2)',[cc]);assert.equal(Number((await rows("SELECT value FROM state_metrics WHERE game_id=$1 AND metric_key='elite_support'",[game]))[0].value),48);
 const makeCollective=async(n,p=cp)=>{const id=uid(n);await query("INSERT INTO event_cases(id,game_id,audience,status,effect_plan,decision_options,title) VALUES($1,$2,'all','ready',$3::jsonb,'[\"А\",\"Б\",\"В\"]','Дилемма')",[id,game,JSON.stringify(p)]);for(const u of [sender,expert,wrong])await query("INSERT INTO event_assignments(case_id,game_id,recipient_id,stage_no) VALUES($1,$2,$3,7)",[id,game,u]);return id;};
 const cast=async(id,u,key)=>{await auth(u);const a=(await rows('SELECT id FROM event_assignments WHERE case_id=$1 AND recipient_id=$2',[id,u]))[0];await query('SELECT public.submit_event_decision($1,$2,NULL)',[a.id,key]);};
 const tie=await makeCollective(111);
 for(const [u,k] of [[sender,'option_1'],[expert,'option_2'],[wrong,'option_3']])await cast(tie,u,k);
 for(const [u,k] of [[sender,'round2:option_1'],[expert,'round2:option_2'],[wrong,'round2:option_3']])await cast(tie,u,k);
 assert.equal((await rows('SELECT winner FROM event_case_outcomes WHERE case_id=$1',[tie]))[0].winner,'tie');
 assert.equal((await rows("SELECT count(*)::int n FROM event_trust_ledger WHERE action_key=$1",['choice-'+tie]))[0].n,0);
 const direct=await makeCollective(112);
 await cast(direct,sender,'option_2');await cast(direct,expert,'option_2');await cast(direct,wrong,'option_1');
 assert.equal((await rows('SELECT winner FROM event_case_outcomes WHERE case_id=$1',[direct]))[0].winner,'option_2');
 assert.equal(Number((await rows("SELECT value FROM state_metrics WHERE game_id=$1 AND metric_key='elite_support'",[game]))[0].value),50);
 const invalid=await makeCollective(113,{...cp,best_option_key:'option_1'});
 await assert.rejects(()=>cast(invalid,sender,'option_1'),/Коллективная разметка недопустима/);
 await assert.rejects(()=>query("SELECT private.event_v2_validate_collective($1::jsonb,$2::jsonb,'{}')",[JSON.stringify({...cp,options:[{...cp.options[0],metric_effects:{lawfulness:-3}},...cp.options.slice(1)]}),JSON.stringify(['А','Б','В'])]),/Недопустимый или двойной эффект/);
 const collectiveCount=async(u,stage=7,g=game)=>Number((await rows("SELECT private.event_v2_collective_participation($1,$2,$3,now()-interval '1 day',now()+interval '1 day') AS n",[g,u,stage]))[0].n);
 for(const u of [sender,expert,wrong])assert.equal(await collectiveCount(u),3,'All participants receive one signal per distinct case, independent of majority and round');
 assert.equal(await collectiveCount(teacher),0);assert.equal(await collectiveCount(sender,8),0);assert.equal(await collectiveCount(sender,7,other),0);
 assert.equal((await rows("SELECT has_function_privilege('authenticated','private.event_v2_collective_participation(uuid,uuid,integer,timestamptz,timestamptz)','EXECUTE') AS ok"))[0].ok,false);
 // Full owner-approved catalogue routing, using synthetic people and a separate
 // fixture game. One set-based assertion query, no production requests.
 const {payload}=require('./events-v2-catalog-integration-check.cjs');
 const routes=payload.filter(x=>x.audience==='single');
 assert.equal(routes.length,141);
 const routeGame=uid(3000), profiles=['social','economic','defence','foreign','internal'];
 const people=profiles.flatMap((p,i)=>['committee','ministry'].map((kind,j)=>({profile:p,kind,user:uid(3100+i*2+j),unit:uid(3200+i*2+j)})));
 const data=routes.map((c,i)=>({id:uid(3300+i),key:c.case_key,plan:c.effect_plan}));
 assert.equal(data.filter(c=>c.plan.competence.committee_before_9).length,20);
 await query("INSERT INTO game_members(game_id,user_id,kind,role_title) SELECT $1,x.user_id,'student','Тест' FROM jsonb_to_recordset($2::jsonb) x(user_id uuid)",[routeGame,JSON.stringify(people.map(p=>({user_id:p.user})))]);
 for(const p of people){
  await query("INSERT INTO institution_units VALUES($1,$2,$3,$4,$5)",[p.unit,routeGame,p.kind,p.profile,p.user]);
  await query("INSERT INTO institution_assignments VALUES($1,$2,$3,$4,'head')",[routeGame,p.unit,p.kind,p.user]);
  if(p.kind==='committee')await query("INSERT INTO party_member_mandates VALUES($1,$2,1)",[routeGame,p.user]);
  else{
   const title='Тестовый профиль '+p.profile;
   await query("INSERT INTO government_nominations VALUES($1,9,$2,'appointed',$3,$4)",[routeGame,'ministry_'+p.profile,p.user,title]);
   await query("INSERT INTO game_office_assignments VALUES($1,$2,$3,'active')",[routeGame,p.user,title]);
  }
 }
 await query("INSERT INTO event_cases(id,game_id,audience,status,effect_plan,decision_options,title,case_key) SELECT x.id,$1,'single','ready',x.plan,'[]'::jsonb,x.key,x.key FROM jsonb_to_recordset($2::jsonb) x(id uuid,key text,plan jsonb)",[routeGame,JSON.stringify(data)]);
 await query("INSERT INTO event_case_routing SELECT $1,c.id,4,15,'individual',NULL FROM event_cases c WHERE c.game_id=$1",[routeGame]);
 const checks=await rows(`WITH people AS (
  SELECT * FROM jsonb_to_recordset($2::jsonb) x(user_id uuid,profile text,kind text)
 ), stages AS (SELECT unnest(ARRAY[3,4,8,9,15,16]) AS stage_no)
 SELECT c.case_key,p.profile,p.kind,s.stage_no,
  private.event_v2_competent_at_stage(c.id,p.user_id,s.stage_no) AS actual,
  ((c.effect_plan->'competence'->'portfolio_keys') ? p.profile AND
    ((p.kind='committee' AND s.stage_no BETWEEN 4 AND 8 AND c.effect_plan->'competence'->'committee_before_9'='true'::jsonb)
     OR (p.kind='ministry' AND s.stage_no BETWEEN 9 AND 15))) AS expected
 FROM event_cases c CROSS JOIN people p CROSS JOIN stages s WHERE c.game_id=$1`,[routeGame,JSON.stringify(people.map(p=>({user_id:p.user,profile:p.profile,kind:p.kind})))]);
 assert.equal(checks.length,141*10*6);
 for(const row of checks)assert.equal(row.actual,row.expected,JSON.stringify(row));
 console.log(JSON.stringify({test:'catalogue competence',cases:routes.length,profiles:profiles.length,comparisons:checks.length,fixtureStageRange:'4–15',result:'PASS'}));
 // 100 distinct simulated identities, actual SQL handler, sequential on one
 // embedded PostgreSQL connection. This is a correctness test, not concurrency.
 const largeGame=uid(900),largeCase=uid(901),largeTeacher=uid(902),voters=Array.from({length:100},(_,i)=>uid(1000+i));
 await query("INSERT INTO games VALUES($1,$2)",[largeGame,largeTeacher]);
 await query("INSERT INTO game_members(game_id,user_id,kind,role_title) VALUES($1,$2,'teacher','Преподаватель')",[largeGame,largeTeacher]);
 await query("INSERT INTO game_members(game_id,user_id,kind,role_title) SELECT $1,unnest($2::uuid[]),'student','Депутат'",[largeGame,voters]);
 await query("INSERT INTO game_stages(game_id,stage_no,status,deadline) VALUES($1,7,'open',now()+interval '1 day')",[largeGame]);
 await query("INSERT INTO state_metrics(game_id,metric_key,value,min_value,max_value) VALUES($1,'lawfulness',50,0,100),($1,'elite_support',50,0,100)",[largeGame]);
 await query("INSERT INTO event_cases(id,game_id,audience,status,effect_plan,decision_options,title) VALUES($1,$2,'all','ready',$3::jsonb,'[\"А\",\"Б\",\"В\"]','Тест 100')",[largeCase,largeGame,JSON.stringify(cp)]);
 await query("INSERT INTO event_assignments(case_id,game_id,recipient_id,stage_no) SELECT $1,$2,unnest($3::uuid[]),7",[largeCase,largeGame,voters]);
 const ids=new Map((await rows('SELECT id,recipient_id FROM event_assignments WHERE case_id=$1',[largeCase])).map(x=>[x.recipient_id,x.id]));
 const started=performance.now();
 for(let round=1;round<=2;round++){
  for(let i=0;i<voters.length;i++){await auth(voters[i]);await query('SELECT public.submit_event_decision($1,$2,NULL)',[ids.get(voters[i]),(round===2?'round2:':'')+(i<(round===1?50:51)?'option_1':'option_2')]);}
  if(round===1){assert.equal((await rows('SELECT count(*)::int n FROM event_case_outcomes WHERE case_id=$1',[largeCase]))[0].n,0);assert.equal((await rows("SELECT comic_scene->>'vote_round' AS r FROM event_cases WHERE id=$1",[largeCase]))[0].r,'2');}
 }
 assert.equal((await rows('SELECT count(*)::int n FROM event_decisions WHERE case_id=$1',[largeCase]))[0].n,200);
 assert.equal((await rows('SELECT winner FROM event_case_outcomes WHERE case_id=$1',[largeCase]))[0].winner,'option_1');
 assert.equal((await rows('SELECT count(*)::int n FROM event_authority_evidence WHERE case_id=$1',[largeCase]))[0].n,0);
 assert.equal(Number((await rows("SELECT value FROM state_metrics WHERE game_id=$1 AND metric_key='lawfulness'",[largeGame]))[0].value),50);
 assert.equal(Number((await rows("SELECT value FROM state_metrics WHERE game_id=$1 AND metric_key='elite_support'",[largeGame]))[0].value),48);
 console.log(JSON.stringify({test:'100 sequential simulated participants',votes:200,elapsedMs:Math.round(performance.now()-started),round1:'50/50',round2:'51/49',result:'PASS'}));
 console.log('PASS collective participation: no duplicate rounds, minority and tie counted equally, stage and game isolated');
 console.log('PASS collective: two rounds, no interim outcome, stale ballot rejected, final effects once, lawfulness unchanged');
 console.log('PASS actual individual transfer SQL: wrong/archived/cross-game, refusal, one assignment, unchanged stage, independent credit, wrong/right answer, no repeat, legacy');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
