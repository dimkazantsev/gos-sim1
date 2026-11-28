'use strict';
// All five release candidates in one disposable database. No production URL,
// no real legal approval, no real participant identifiers.
const assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const {payload,assertReleaseReady}=require('./events-v2-catalog-integration-check.cjs');
const id=n=>'27000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [game,next,teacher,sender,expert,third,blocked,archived,guest]=[1,2,3,4,5,6,7,8,9].map(id);
const synthetic=payload.map((c,i)=>({...c,case_key:'fixture-'+i,title:'Тест '+i,category:'Экономика',situation:'Условие синтетической ситуации',source_url:null,source_note:null,verified:true,editorial_status:'approved',legal_status:'verified_current',activation_allowed:true,competence_allowed:true,effect_plan:{rules_version:2,...(c.audience==='single'?{best_option_key:'option_1',competence:{portfolio_keys:['economic'],committee_before_9:c.effect_plan.competence.committee_before_9}}:{}),options:c.decision_options.map((_,j)=>({key:'option_'+(j+1),lawful:true,trust:j===0?1:0,public_interest:j===0?'beneficial':'neutral',authorized_roles:['депутат'],description:'Учебное последствие',...(c.audience!=='single'&&j===0?{metric_effects:{elite_support:-1}}:{})}))},decision_options:c.decision_options.map((_,j)=>'Вариант '+(j+1))}));
(async()=>{const db=new PGlite();try{
 const q=(s,a=[])=>db.query(s,a),rows=async(s,a=[])=>(await q(s,a)).rows,one=async(s,a=[])=>(await rows(s,a))[0];
 const read=p=>fs.readFileSync(p,'utf8'),candidate=n=>read('supabase/changes/events_v2_'+n+'_candidate.sql');
 await db.exec(read('scripts/events-v2-individual-fixture.sql'));
 await db.exec(read('scripts/events-v2-dispatch-fixture.sql'));
 await db.exec("ALTER TABLE public.event_cases ADD COLUMN created_at timestamptz DEFAULT now();");
 const install=async()=>{
  for(const n of ['individual_transfer','collective','dispatch_seed'])await db.exec(candidate(n));
  await db.exec(read('scripts/events-v2-rls-fixture.sql').replace("ALTER TABLE public.event_cases ADD COLUMN allowed_roles text[] DEFAULT '{}',ADD COLUMN created_at timestamptz DEFAULT now();",""));
  for(const n of ['security','catalog'])await db.exec(candidate(n));
 };
 await db.exec("CREATE TABLE private.event_content_revisions(revision text,event_case_id uuid,snapshot jsonb,PRIMARY KEY(revision,event_case_id));");
 await q("INSERT INTO games(id,owner_id,current_round) VALUES($1,$2,7),($3,$2,7)",[game,teacher,next]);
 for(const [u,k,a] of [[teacher,'teacher',null],[sender,'student',null],[expert,'student',null],[third,'student',null],[blocked,'student',null],[archived,'student',new Date().toISOString()],[guest,'observer',null]])await q("INSERT INTO game_members(game_id,user_id,kind,roster_archived_at,role_title) VALUES($1,$2,$3,$4,'Депутат')",[game,u,k,a]);
 await q("INSERT INTO game_member_access_blocks VALUES($1,$2)",[game,blocked]);
 await q("INSERT INTO game_stages(game_id,stage_no,status,deadline) VALUES($1,7,'open',now()+interval '1 day'),($1,9,'open',now()+interval '1 day')",[game]);
 await q("INSERT INTO state_metrics(game_id,metric_key,value,min_value,max_value) VALUES($1,'lawfulness',50,0,100),($1,'elite_support',50,0,100)",[game]);
 await q("INSERT INTO institution_units VALUES($1,$2,'committee','economic',$3)",[id(20),game,expert]);
 await q("INSERT INTO institution_assignments VALUES($1,$2,'committee',$3,'head')",[game,id(20),expert]);
 await q("INSERT INTO party_member_mandates VALUES($1,$2,1)",[game,expert]);
 const s=synthetic.find(c=>c.audience==='single'&&c.effect_plan.competence.committee_before_9),a=synthetic.find(c=>c.audience==='all'),legacy=synthetic.find(c=>c.audience==='single'&&c!==s);
 await q("INSERT INTO private.authored_event_catalog SELECT x->>'case_key',jsonb_build_object('title',x->>'title','category',x->>'category','audience',x->>'audience','effect_plan',jsonb_build_object('options','[]'::jsonb),'comic_scene',jsonb_build_object('scene_id','art'),'allowed_roles','[]'::jsonb,'seriousness','light','situation','Старый тест','decision_options',x->'decision_options') FROM jsonb_array_elements($1::jsonb) x",[JSON.stringify(synthetic)]);
 const [sc,ac,lc]=[id(100),id(101),id(102)];
 for(const [cid,c] of [[sc,s],[ac,a],[lc,legacy]])await q("INSERT INTO event_cases(id,game_id,case_key,title,audience,category,status,effect_plan,decision_options,comic_scene) VALUES($1,$2,$3,$4,$5,$6,'ready','{}',$7::jsonb,'{\"scene_id\":\"art\"}')",[cid,game,c.case_key,c.title,c.audience,c.category,JSON.stringify(c.decision_options)]);
 await q("INSERT INTO event_case_routing(game_id,case_id,earliest_stage,latest_stage,destination) VALUES($1,$2,4,15,'individual'),($1,$3,4,15,'federal_collective')",[game,sc,ac]);
 await q("INSERT INTO event_assignments(case_id,game_id,recipient_id,stage_no,status) VALUES($1,$2,$3,7,'resolved')",[lc,game,sender]);
 await q("INSERT INTO event_case_outcomes(case_id,game_id,winner) VALUES($1,$2,'option_1')",[lc,game]);
 const history=await one("SELECT to_jsonb(c) c FROM event_cases c WHERE id=$1",[lc]);
 // First transaction intentionally fails with the actual blocked source.
 await db.exec('BEGIN');
 await install();
 const apply=(p)=>q("SELECT private.events_v2_apply_catalog_candidate($1::jsonb,'{}'::uuid[]) AS result",[JSON.stringify(p)]);
 assert.throws(()=>assertReleaseReady(payload),/release blocked/);
 await assert.rejects(()=>apply(payload),/release blocked/);
 await db.exec('ROLLBACK');
 assert.equal((await one("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='event_decisions' AND column_name='vote_round'")).n,0);
 // A deliberately fictional, legally irrelevant dataset tests the positive path.
 await db.exec('BEGIN');
 await install();
 assert.deepEqual((await apply(synthetic)).rows[0].result,{catalogue:330,updated_instances:2});
 await db.exec("DROP FUNCTION private.events_v2_apply_catalog_candidate(jsonb,uuid[]); COMMIT; SET check_function_bodies=on;");
 // Production already has these trigger attachments; explicitly reproduce them here.
 await db.exec("CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON event_assignments FOR EACH ROW EXECUTE FUNCTION private.guard_event_assignment(); CREATE TRIGGER snapshot BEFORE INSERT ON event_decisions FOR EACH ROW EXECUTE FUNCTION private.snapshot_event_office(); CREATE TRIGGER authority AFTER INSERT ON event_case_outcomes FOR EACH ROW EXECUTE FUNCTION private.record_event_authority();");
 assert.deepEqual(await one("SELECT to_jsonb(c) c FROM event_cases c WHERE id=$1",[lc]),history);
 assert.equal((await one("SELECT private.seed_authored_event_bank($1) n",[next])).n,330);
 assert.equal((await one("SELECT count(*)::int n FROM event_cases WHERE game_id=$1 AND verified AND effect_plan->>'rules_version'='2' AND comic_scene->>'event_rules_version'='2'",[next])).n,330);
 async function as(u){await db.exec('RESET ROLE');await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[u]);await db.exec('SET ROLE authenticated')}
 if(process.argv.includes('--browser')){await require('./events-v2-interactive-check.cjs')({db,q,rows,one,as,game,teacher,sender,expert,third,guest,sc,ac});return;}
 await as(teacher);
 const assign=(c,ids,stage=7)=>one('SELECT public.assign_event_case_at_stage($1,$2,$3) n',[c,ids,stage]);
 assert.equal((await assign(sc,[sender])).n,1);
 assert.equal((await assign(ac,[sender,expert,third])).n,3);
 assert.equal((await assign(ac,[third,expert,sender])).n,0);
 await assert.rejects(()=>assign(ac,[third,expert,sender],9),/зафиксирован/);
 await as(sender);
 assert.equal((await one('SELECT public.list_visible_event_cases($1,$2) v',[game,[sc]])).v[0].effect_plan,null);
 await q('SELECT public.invite_event_collaborator($1,$2)',[sc,expert]);
 const invitation=(await one("SELECT id FROM event_collaboration_invites WHERE case_id=$1",[sc])).id;
 await as(expert);await q('SELECT public.respond_event_invitation($1,true)',[invitation]);
 const sa=await one("SELECT id,recipient_id,stage_no FROM event_assignments WHERE case_id=$1",[sc]);assert.equal(sa.recipient_id,expert);assert.equal(sa.stage_no,7);
 await q('SELECT public.submit_event_decision($1,$2,NULL)',[sa.id,'option_1']);
 assert.equal((await one("SELECT winner FROM event_case_outcomes WHERE case_id=$1",[sc])).winner,'option_1');
 assert.equal(Number((await one("SELECT score_share FROM event_authority_evidence WHERE case_id=$1",[sc])).score_share),.5);
 for(const [u,k] of [[sender,'option_1'],[expert,'option_2'],[third,'option_3']]){await as(u);const x=await one('SELECT id FROM event_assignments WHERE case_id=$1 AND recipient_id=$2',[ac,u]);await q('SELECT public.submit_event_decision($1,$2,NULL)',[x.id,k]);}
 assert.equal((await one('SELECT count(*)::int n FROM event_case_outcomes WHERE case_id=$1',[ac])).n,0);
 for(const [u,k] of [[sender,'option_1'],[expert,'option_1'],[third,'option_2']]){await as(u);const x=await one('SELECT id FROM event_assignments WHERE case_id=$1 AND recipient_id=$2',[ac,u]);await q('SELECT public.submit_event_decision($1,$2,NULL)',[x.id,'round2:'+k]);}
 assert.equal((await one('SELECT winner FROM event_case_outcomes WHERE case_id=$1',[ac])).winner,'option_1');
 await as(guest);await assert.rejects(()=>q('SELECT public.finalize_event_case_round($1,2)',[ac]),/преподавател/i);
 await as(blocked);await assert.rejects(()=>q('SELECT public.get_event_workspace_feed_bootstrap($1,false)',[game]),/доступ/i);
 await db.exec('RESET ROLE');
 assert.equal((await one("SELECT count(*)::int n FROM event_decisions WHERE case_id=$1",[ac])).n,6);
 assert.equal((await one("SELECT count(*)::int n FROM event_authority_evidence WHERE case_id=$1",[ac])).n,0);
 assert.equal(Number((await one("SELECT value FROM state_metrics WHERE game_id=$1 AND metric_key='elite_support'",[game])).value),49);
 assert.equal((await one("SELECT count(*)::int n FROM private.event_content_revisions")).n,2);
 assert.equal((await one("SELECT to_regprocedure('private.events_v2_apply_catalog_candidate(jsonb,uuid[])') IS NULL gone")).gone,true);
 // Regional group/all cases: same approved version, synthetic separate region.
 const rg=id(401),ra=id(402),party=id(403),otherParty=id(404);
 await q("INSERT INTO game_parties VALUES($1,$2,'А'),($3,$2,'Б')",[party,game,otherParty]);
 await q("INSERT INTO game_region_party_control VALUES($1,'99',$2,now())",[game,party]);
 await q("UPDATE game_members SET team=CASE WHEN user_id=$2 THEN 'Б' ELSE 'А' END WHERE game_id=$1",[game,third]);
 const cp={rules_version:2,options:[{key:'option_1',lawful:true,trust:1},{key:'option_2',lawful:true,trust:0}]};
 for(const [cid,aud,dest] of [[rg,'group','regional_joint'],[ra,'all','regional']]){
  await q("INSERT INTO event_cases(id,game_id,case_key,title,audience,status,effect_plan,decision_options,comic_scene) VALUES($1,$2,$3,'Регион', $4,'ready',$5::jsonb,'[\"А\",\"Б\"]','{\"event_rules_version\":2,\"region_code\":\"99\"}')",[cid,game,'region-'+aud,aud,JSON.stringify(cp)]);
  await q("INSERT INTO event_case_routing(game_id,case_id,earliest_stage,latest_stage,destination,region_code) VALUES($1,$2,4,15,$3,'99')",[game,cid,dest]);
 }
 await as(teacher);
 await assert.rejects(()=>assign(rg,[sender,third]),/контролирующей партии/);
 await assert.rejects(()=>assign(ra,[sender]),/контролирующей партии/);
 assert.equal((await assign(rg,[sender,expert])).n,2);
 assert.equal((await assign(ra,[sender,expert])).n,2);
 await db.exec('RESET ROLE');
 assert.deepEqual((await rows('SELECT recipient_id FROM event_assignments WHERE case_id=$1 ORDER BY recipient_id',[ra])).map(x=>x.recipient_id),[sender,expert]);
 await db.exec('GRANT INSERT,UPDATE,DELETE ON event_assignments TO authenticated');
 await as(teacher);
 await assert.rejects(()=>q("INSERT INTO event_assignments(case_id,game_id,recipient_id,stage_no) VALUES($1,$2,$3,7)",[ra,game,third]),/row-level security|policy/i);
 assert.equal((await q("DELETE FROM event_assignments WHERE case_id=$1",[ra])).affectedRows,0);
 await db.exec('RESET ROLE');
 console.log('PASS regional manual electorate, foreign party rejection, entire party, immutable direct client rows');
 console.log('PASS five candidates in a single transaction: actual blocked payload rollback, fictional 330 catalogue, two changed instances, protected legacy, verified seed, authenticated transfer and two-round vote, role isolation, temporary helper removed');
 }finally{await db.close()}})().catch(e=>{console.error(e.code??'ERROR',e.message,e.where??'');process.exitCode=1});
