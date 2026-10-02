/* Real React interactions; fictional classrooms, no live game writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),route=path.join(root,'app','roster-interaction-test-route'),shots=path.join(root,'.design-review','screenshots');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome is required for roster and wheel interaction checks');
const source=String.raw`'use client';
import {useEffect,useState} from 'react';
import TeacherView from '../../components/game/TeacherView';
import RepublicLeadership from '../../components/game/RepublicLeadership';
import StyledSelect from '../../components/ui/StyledSelect';
import {currentGameMembers,currentGameProfiles} from '../../components/game/gameRoster';
import type {Member,GameOfficeAssignment} from '../../components/game/types';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
const member=(id:string,name:string,role:string,extra={})=>({game_id:'roster-ui',user_id:id,full_name:name,role_title:role,kind:'student',...extra}) as Member;
const me=member('teacher','Преподаватель игры','Преподаватель',{kind:'teacher'});
const raw=[me,member('president','Анна Миронова','Президент Российской Федерации'),member('chair','Илья Соколов','Председатель Государственной Думы'),member('premier','Мария Александровна Волкова','Министр финансов'),member('other','Чужой участник','Президент',{game_id:'other-game'}),member('old','Старый вход преподавателя','Преподаватель',{kind:'teacher',roster_archived_at:'2026-10-02'})];
const empty={parties:[],partyMandates:[],partyInvitations:[],metrics:[],metricHistory:[],politicalPosts:[],politicalDecisions:[],formalDocuments:[],votes:[],ballots:[],evaluations:[],myEvaluations:[],actions:[],activities:[],presence:[],stages:[],impactRules:[],impactLedger:[],partySupportHistory:[]};
export default function RosterTest(){
 const [selected,setSelected]=useState(me.user_id),[opened,setOpened]=useState('');
 const [offices,setOffices]=useState<GameOfficeAssignment[]>([
  {id:'p',game_id:'roster-ui',user_id:'president',role_title:'Президент Российской Федерации',status:'active',created_at:'2026-10-02'},
  {id:'g',game_id:'roster-ui',user_id:'chair',role_title:'Председатель Государственной Думы',status:'active',created_at:'2026-10-02'},
  {id:'m',game_id:'roster-ui',user_id:'premier',role_title:'Председатель Правительства Российской Федерации',status:'pending',created_at:'2026-10-02'}
 ]);
 useEffect(()=>{document.body.dataset.rosterReady='yes'},[]);
 const members=currentGameMembers(raw,'roster-ui');
 const g={...empty,game:{id:'roster-ui',title:'Учебная республика',current_round:1,turn_open:false,settings:{}},me,members,profiles:currentGameProfiles([],members,'roster-ui'),officeAssignments:offices,teacher:true,names:Object.fromEntries(members.map(m=>[m.user_id,m.full_name])),currentStage:{stage_no:1,title:'Начало игры'},secondsLeft:0,setTurn:()=>{},refresh:async()=>{},setError:()=>{}} as unknown as ReturnTypeRepublic;
 return <main style={{padding:'16px',maxWidth:'1480px',margin:'auto'}}>
  <TeacherView g={g} onOpenProcesses={()=>{}} onOpenStages={()=>{}}/>
  <section style={{marginTop:20}} className="profilePublicStrip"><StyledSelect label="Открыть профиль игрока" value={selected} options={members.map(m=>({value:m.user_id,label:m.full_name}))} onChange={setSelected}/><output id="selected-member">{selected}</output></section>
  <section className="republicCard" style={{maxWidth:600,margin:'24px auto'}}><RepublicLeadership g={g} onOpenProfile={setOpened}/><output id="opened-member">{opened}</output></section>
  <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button type="button" onClick={()=>setOffices(rows=>rows.map(o=>o.id==='m'?{...o,status:'active'}:o))}>Утвердить Председателя Правительства</button><button type="button" onClick={()=>setOffices(rows=>rows.map(o=>o.id==='p'?{...o,status:'ended'}:o))}>Снять Президента</button></div>
  <div style={{height:800}}/>
 </main>;
}
`;
let server,browser;const logs=[];const url='http://localhost:3997/roster-interaction-test-route';
async function main(){
 fs.mkdirSync(route,{recursive:true});fs.mkdirSync(shots,{recursive:true});fs.writeFileSync(path.join(route,'page.tsx'),source);
 server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','-p','3997'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture'}});
 for(const pipe of [server.stdout,server.stderr])pipe.on('data',s=>{logs.push(String(s));if(logs.length>30)logs.shift()});
 try{
  for(let n=0;n<50;n++){
   if(server.exitCode!==null)throw Error('Preview server exited: '+logs.join(''));
   try{if((await fetch(url,{signal:AbortSignal.timeout(5000)})).ok)break}catch{}
   if(n===49)throw Error('Preview unavailable: '+logs.join(''));
   await new Promise(r=>setTimeout(r,800));
  }
  browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await page.goto(url);await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.waitForFunction(()=>document.body.dataset.rosterReady==='yes');
  assert.equal(await page.locator('.republicOfficeCard').count(),3);
  assert.equal(await page.locator('[data-office="president"]').getByRole('button',{name:'Открыть профиль: Анна Миронова',exact:true}).count(),1);
  assert.equal(await page.locator('[data-office="gd_chair"]').getByRole('button',{name:'Открыть профиль: Илья Соколов',exact:true}).count(),1);
  assert.equal(await page.locator('[data-office="prime_minister"] .republicOfficeVacant').count(),1);
  await page.locator('.profilePublicStrip .styledSelectTrigger').click();
  assert.equal(await page.getByRole('option').count(),4);
  assert.equal(await page.getByRole('option',{name:/Чужой участник|Старый вход/}).count(),0);
  await page.getByRole('option',{name:'Анна Миронова',exact:true}).click();assert.equal(await page.locator('#selected-member').textContent(),'president');
  await page.getByRole('button',{name:'Утвердить Председателя Правительства',exact:true}).click();
  await page.locator('[data-office="prime_minister"]').getByRole('button',{name:'Открыть профиль: Мария Александровна Волкова',exact:true}).click();assert.equal(await page.locator('#opened-member').textContent(),'premier');
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:1000});
   const geometry=await page.locator('.republicLeadership').evaluate(root=>{
    const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height,width:r.width}};
    return {width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,root:rect(root),rows:[...root.querySelectorAll('button')].map(el=>({row:rect(el),avatar:rect(el.querySelector('.republicLeaderAvatar')),name:rect(el.querySelector('.republicLeaderName'))}))};
   });
   assert(geometry.scroll<=geometry.width+2,'Page overflow: '+JSON.stringify(geometry));
   for(const row of geometry.rows){assert(row.row.height>=44);assert(row.avatar.right<=row.name.left);assert(row.row.right<=geometry.width+2);assert.equal(row.avatar.height,row.avatar.width)}
   const nav=page.locator('.teacherWorkspaceNav');
   await nav.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
   const bounds=await nav.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
   const before=await nav.evaluate(el=>({max:el.scrollWidth-el.clientWidth,y:window.scrollY,left:el.scrollLeft}));
   assert.equal(await nav.getByRole('tab').count(),10);
   if(width===1440)assert(before.max<=2,'Desktop routes should fit in one compact line');
   if(before.max>2){
    await nav.evaluate(el=>el.scrollLeft=0);await page.mouse.wheel(0,180);await page.waitForFunction(()=>document.querySelector('.teacherWorkspaceNav').scrollLeft>0);
    assert.equal(await page.evaluate(()=>window.scrollY),before.y,'Horizontal wheel should retain page position');
    await page.mouse.wheel(0,-180);await page.waitForFunction(()=>document.querySelector('.teacherWorkspaceNav').scrollLeft===0);
    const notCancelled=await nav.evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true,cancelable:true})));assert(notCancelled,'At the beginning wheel must be released to the page');
    await nav.evaluate(el=>el.scrollLeft=el.scrollWidth-el.clientWidth);assert(await nav.getByRole('tab',{name:'Награды',exact:true}).isVisible());
   }
   await page.locator('.republicLeadership').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,'roster-leadership-'+width+'.png')});
   await nav.evaluate(el=>{el.scrollLeft=0;el.scrollIntoView({block:'center'})});await page.screenshot({path:path.join(shots,'roster-tabs-'+width+'.png')});
   console.log('PASS '+width+'px: three holders, round avatars, 44px controls, four classroom profiles, compact tabs and actual mouse wheel');
  }
  await page.getByRole('button',{name:'Снять Президента',exact:true}).click();assert.equal(await page.locator('[data-office="president"] .republicOfficeVacant').count(),1);
  console.log('PASS office approval/revocation refreshes the real leadership panel and profile links work');
 }finally{await browser?.close();server?.kill('SIGTERM');fs.rmSync(route,{recursive:true,force:true})}
}
main().catch(err=>{console.error(err);console.error(logs.join(''));process.exitCode=1});
