import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {applyPortableAction} from '../public/portable/engine.mjs';

const fixture = () => ({format:'GOS-SIMS',schema:2,game:{id:'test-game',owner_id:'teacher',game_code:'TEST',title:'Проверка'},tables:{
 game_members:[{user_id:'teacher',kind:'teacher',full_name:'Тестовый Преподаватель'},
  {user_id:'student-a',kind:'student',full_name:'Участник Первый'},
  {user_id:'student-b',kind:'student',full_name:'Участник Второй'}],
 state_metrics:[{id:'trust',metric_key:'public_trust',label:'Доверие',value:99,min_value:0,max_value:100}],
 event_cases:[{id:'event-a',audience:'group',status:'ready',title:'Открыть Больницу',situation:'Учебный Сценарий',decision_options:['Открыть','Отложить','Закрыть'],effect_plan:{options:[{trust:2},{trust:0},{trust:-2}]},comic_scene:{scene_id:'scene-01'}},
  {id:'event-b',status:'ready',title:'Не Назначено',decision_options:['Да','Нет']}],
 event_assignments:[],event_decisions:[],event_case_outcomes:[],political_posts:[],game_profiles:[],game_stages:[]}});

const teacher={id:'teacher',kind:'teacher'},student={id:'student-a',kind:'student'},guest={kind:'observer'};
const state=fixture();
assert.throws(()=>applyPortableAction(state,guest,'metric',{id:'trust',value:1}));
assert.throws(()=>applyPortableAction(state,student,'assign',{case_id:'event-a',recipient_id:student.id}));
assert.throws(()=>applyPortableAction(state,teacher,'unknown',{}));
assert.throws(()=>applyPortableAction(state,teacher,'assign',{case_id:'event-a',recipient_id:student.id}));
assert.equal(state.tables.event_assignments.length,0);
applyPortableAction(state,teacher,'assign',{case_id:'event-a',recipient_ids:['student-a','student-b']});
const assignment=state.tables.event_assignments[0];
for(const index of [-1,3,'length','0',0.5])assert.throws(()=>applyPortableAction(state,student,'vote',{assignment_id:assignment.id,index}));
applyPortableAction(state,student,'vote',{assignment_id:assignment.id,index:0});
assert.equal(state.tables.event_case_outcomes.length,0);
assert.throws(()=>applyPortableAction(state,teacher,'assign',{case_id:'event-a',recipient_ids:['student-a','student-b']}));
applyPortableAction(state,{id:'student-b',kind:'student'},'vote',{assignment_id:state.tables.event_assignments[1].id,index:0});
assert.equal(state.tables.state_metrics[0].value,100);
assert.equal(state.tables.event_case_outcomes[0].trust_delta,1);
assert.equal(state.tables.event_trust_ledger[0].delta,1);
assert.equal(state.tables.state_metric_history[0].delta,1);
assert.equal(state.tables.political_posts[0].comic_scene.scene_id,'scene-01');
assert.throws(()=>applyPortableAction(state,student,'vote',{assignment_id:assignment.id,index:2}));
assert.throws(()=>applyPortableAction(state,teacher,'assign',{case_id:'event-a',recipient_id:'student-b'}));
assert.equal(state.tables.political_posts.length,1);

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gos-portable-check-'));
const port=18160+Math.floor(Math.random()*600);
let server;
try{
 for(const name of ['engine.mjs','server.mjs'])await fs.copyFile(new URL('../public/portable/'+name,import.meta.url),path.join(dir,name));
 await fs.writeFile(path.join(dir,'game.json'),JSON.stringify(fixture()));
 await fs.writeFile(path.join(dir,'index.html'),'<script id="session-data" type="application/json">{"private":"secret-marker"}</script>');
 const start=async()=>{
  server=spawn(process.execPath,[path.join(dir,'server.mjs')],{env:{...process.env,PORT:String(port),GOS_HOST:'127.0.0.1',GOS_TEACHER_CODE:'test-teacher',GOS_STUDENT_CODE:'test-student'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.stdout.once('data',resolve);server.stderr.once('data',data=>reject(Error(String(data))))});
 };
 const stop=async()=>{await new Promise(resolve=>{server.once('exit',resolve);server.kill()})};
 const request=async(endpoint,data,cookie)=>{
  const res=await fetch('http://127.0.0.1:'+port+'/api/'+endpoint,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:data?JSON.stringify(data):undefined});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 };
 await start();
 const publicState=await request('state');
 assert.equal(publicState.data.state.tables.event_cases.length,0,'Guest cannot read unassigned bank');
 const html=await (await fetch('http://127.0.0.1:'+port+'/')).text();
 assert(!html.includes('secret-marker'),'Server strips embedded teacher snapshot');
 assert.equal((await request('action',{action:'metric',id:'trust',value:0})).status,403);
 assert.equal((await request('export')).status,403);
 assert.equal((await request('login',{kind:'teacher',password:'wrong'})).status,403);
 const teacherLogin=await request('login',{kind:'teacher',password:'test-teacher'});
 const a=await request('login',{kind:'student',password:'test-student',name:'Участник Первый'});
 const b=await request('login',{kind:'student',password:'test-student',name:'Участник Второй'});
 assert.equal((await request('action',{action:'assign',case_id:'event-a',recipient_id:'student-a'},a.cookie)).status,400);
 assert.equal((await request('action',{action:'assign',case_id:'event-a',recipient_ids:['student-a','student-b']},teacherLogin.cookie)).status,200);
 const assigned=(await request('state',null,teacherLogin.cookie)).data.state.tables.event_assignments;
 assert.equal((await request('action',{action:'vote',assignment_id:assigned[0].id,index:0},b.cookie)).status,400,'Cannot vote for another student');
 const votes=await Promise.all(assigned.map(row=>request('action',{action:'vote',assignment_id:row.id,index:0},row.recipient_id==='student-a'?a.cookie:b.cookie)));
 assert(votes.every(res=>res.status===200));
 const result=(await request('export',null,teacherLogin.cookie)).data;
 assert.equal(result.tables.event_decisions.length,2);
 assert.equal(result.tables.event_case_outcomes.length,1);
 assert.equal(result.tables.political_posts.length,1);
 assert.equal(result.tables.state_metrics[0].value,100);
 assert.equal(result.tables.event_case_outcomes[0].trust_delta,1);
 assert.equal((await request('action',{action:'vote',assignment_id:assigned[0].id,index:0},a.cookie)).status,400);
 await stop();await start();
 const reopened=await request('login',{kind:'teacher',password:'test-teacher'});
 assert.equal(reopened.data.state.tables.event_decisions.length,2,'Votes survive server restart');
 assert.equal(reopened.data.state.tables.state_metrics[0].value,100);
 const persisted=JSON.parse(await fs.readFile(path.join(dir,'progress.json'),'utf8'));
 assert.equal(persisted.tables.event_case_outcomes[0].trust_delta,1);
 console.log('PASS: Roles, Private Bank, Shared Voting, Single Outcome, Clamped Rating, Media Scene, Restart Persistence.');
}finally{
 if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill()});
 await fs.rm(dir,{recursive:true,force:true});
}
