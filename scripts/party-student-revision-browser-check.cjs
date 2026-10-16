/* Actual student/teacher components, shared fictional documents and full app CSS.
   Persistence/permission guards are tested separately against actual hook code + SQL. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright-core');
const {startTestServer,stopTestServer,closeTestBrowser,cleanTestRoute}=require('./browser-test-runtime.cjs');
const root=path.resolve(__dirname,'..'),route=path.join(root,'app','party-review-test-route'),shots=path.join(root,'.design-review/screenshots');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser',chromium.executablePath()].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chromium required for party student/teacher review');
const source=String.raw`'use client';
import {useState} from 'react';
import PartiesView from '../../components/game/PartiesView';
import TeacherPartyDossiers from '../../components/game/TeacherPartyDossiers';
import fixture from '../../.design-review/fixture.json';
import type {PartyDocument} from '../../components/game/types';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
const kinds=['application','charter','program','fee','symbol','congress_minutes'] as const;
const baseParty={...fixture.parties[0],registration_status:'submitted',name:'Новая перспектива'};
const owner=fixture.members.find(m=>m.user_id===baseParty.leader_user_id)!;
const noop=()=>{};
export default function PartyTest(){
 const [docs,setDocs]=useState<PartyDocument[]>(()=>kinds.map(kind=>({id:kind+'-v1',game_id:fixture.game.id,party_id:baseParty.id,doc_kind:kind,title:kind==='program'?'Программа развития':'Документ партии',storage_path:kind+'-v1.txt',file_name:kind+'-v1.txt',mime_type:'text/plain',file_size:50,uploaded_by:owner.user_id,version_no:1,status:kind==='program'?'submitted':'accepted',note:null,created_at:'2026-10-16T10:00:00Z',url:'data:text/plain,document'})));
 const [open,setOpen]=useState(true),[registered,setRegistered]=useState(false),[fail,setFail]=useState(false),[uploads,setUploads]=useState(0);
 const party={...baseParty,registration_status:registered?'registered':'submitted'};
 const game={...fixture.game,current_round:1,turn_open:open,turn_ends_at:null};
 const shared={...fixture,game,parties:[party],partyDocuments:docs,stages:fixture.stages.map(s=>({...s,deadline:null,status:s.stage_no===1?(open?'open':'completed'):'locked'})),formalDocuments:registered?[{id:'certificate',game_id:game.id,doc_type:'party_certificate',registry_no:'МЮ-ТЕСТ',title:'Свидетельство',metadata:{party_id:party.id},created_at:'2026-10-16T10:00:00Z'}]:[],
  reviewPartyDocument:async(id:string,status:'accepted'|'revision',note?:string)=>{setDocs(rows=>rows.map(d=>d.id===id?{...d,status,note:note?.trim()||null}:d));return true},
  uploadPartyDocument:async(partyId:string,kind:PartyDocument['doc_kind'],title:string,file:File)=>{
   setUploads(n=>n+1);if(fail){setFail(false);return false}
   setDocs(rows=>{const version=1+Math.max(0,...rows.filter(d=>d.doc_kind===kind).map(d=>d.version_no||1));return [...rows,{id:kind+'-v'+version,game_id:game.id,party_id:partyId,doc_kind:kind,title,storage_path:file.name,file_name:file.name,mime_type:file.type,file_size:file.size,uploaded_by:owner.user_id,version_no:version,status:'submitted',note:null,created_at:new Date().toISOString(),url:'data:text/plain,updated-document'}]});return true
  }};
 function scope(teacher:boolean){return new Proxy({...shared,teacher,me:teacher?fixture.me:owner},{get:(t,k)=>k in t?t[k as keyof typeof t]:noop}) as unknown as ReturnTypeRepublic}
 return <div style={{maxWidth:1200,margin:'0 auto',padding:16}}>
  <div><button id="stage-toggle" onClick={()=>setOpen(v=>!v)}>Изменить доступность этапа</button><button id="fail-upload" onClick={()=>setFail(true)}>Сбой следующей загрузки</button><button id="registered" onClick={()=>setRegistered(true)}>Показать зарегистрированную партию</button><output id="upload-count">{uploads}</output></div>
  <section data-cabinet="student"><PartiesView g={scope(false)}/></section>
  <section data-cabinet="teacher"><TeacherPartyDossiers g={scope(true)}/></section>
 </div>;
}`;
let browser,server;const logs=[],address='http://127.0.0.1:4007/party-review-test-route';
async function ready(){for(let n=0;n<60;n++){if(server.exitCode!==null)throw Error(logs.join(''));try{const r=await fetch(address);if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,500))}throw Error(logs.join(''))}
(async()=>{
 try{
  if(!fs.existsSync(path.join(root,'.design-review/fixture.json')))execFileSync(process.execPath,['scripts/design-preview.cjs'],{cwd:root,stdio:'pipe'});
  fs.mkdirSync(route,{recursive:true});fs.mkdirSync(shots,{recursive:true});fs.writeFileSync(path.join(route,'page.tsx'),source);
  server=startTestServer(root,4007,{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'placeholder'});
  for(const p of [server.stdout,server.stderr])p.on('data',c=>{logs.push(String(c));if(logs.length>30)logs.shift()});await ready();
  browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [320,390,900,1600]){
   const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://*.supabase.co/**',r=>r.fulfill({json:[]}));await page.goto(address);
   await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
   const student=page.locator('[data-cabinet=student]'),teacher=page.locator('[data-cabinet=teacher]');
   const studentProgram=student.locator('.partyRegistrationDoc').filter({has:page.getByText('Программа',{exact:true})});
   const teacherProgram=()=>teacher.locator('.partyDossierDocRow').filter({has:page.getByText('Программа',{exact:true})});
   await teacherProgram().getByRole('button',{name:'На доработку',exact:true}).click();
   assert(await teacherProgram().getByRole('button',{name:'Подтвердить доработку'}).isDisabled());
   const remark='Укажите источники финансирования и порядок внутреннего контроля партии.';
   await teacherProgram().locator('textarea').fill(remark);
   await teacherProgram().getByRole('button',{name:'Подтвердить доработку'}).click();
   await page.waitForFunction(()=>document.querySelector('[data-cabinet=student] .partyRegistrationRevisionNote')?.textContent?.includes('источники финансирования'));
   assert.equal(await student.locator('.partyRegistrationDoc.isRevision').count(),1);
   assert(await student.locator('.civicPartyPackage').getAttribute('open')!==null,'Returned document opens its own dossier');
   assert((await studentProgram.textContent()).includes('В1'));
   const upload=()=>studentProgram.getByRole('button',{name:'Загрузить Программа · версия В2',exact:true});
   assert(await upload().isEnabled(),'The fictional first stage is open without an expired demo deadline');
   if([390,1600].includes(width))await studentProgram.screenshot({path:path.join(shots,'party-student-returned-'+width+'.png')});
   await page.locator('#stage-toggle').click();assert(await upload().isDisabled(),'Closed stage cannot start a file upload');
   await studentProgram.locator('input[type=file]').setInputFiles({name:'closed.txt',mimeType:'text/plain',buffer:Buffer.from('closed')});
   assert.equal(await page.locator('#upload-count').textContent(),'0');await page.locator('#stage-toggle').click();
   async function send(){const chosen=page.waitForEvent('filechooser');await upload().click();await(await chosen).setFiles({name:'programme-v2.txt',mimeType:'text/plain',buffer:Buffer.from('Исправленная программа')})}
   await page.locator('#fail-upload').click();await send();
   await studentProgram.locator('.isError').waitFor();assert((await studentProgram.textContent()).includes(remark),'A failed upload preserves the return note');
   assert(await upload().isEnabled(),'Retry remains available');await send();
   await page.waitForFunction(()=>document.querySelector('[data-cabinet=student] .partyRegistrationDocHistory')!==null);
   assert.equal(await student.locator('.partyRegistrationDoc.isRevision').count(),0);
   const latest=teacherProgram().filter({has:page.getByText('В2',{exact:true})});
   await latest.getByRole('button',{name:'Принять',exact:true}).click();
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-cabinet=student] .partyRegistrationDocStatus')].some(e=>e.textContent==='В2 · Принято'));
   await studentProgram.locator('.partyRegistrationDocHistory>summary').click();
   assert((await studentProgram.locator('.partyRegistrationDocHistory').textContent()).includes(remark));
   assert.equal(await student.locator('.civicPublicDocument').count(),0,'No public files before certificate');
   await page.locator('#registered').click();await student.locator('.civicPublicDocument').first().waitFor();
   assert.equal(await student.locator('.civicPublicDocument').count(),4);
   const publicProgram=student.locator('.civicPublicDocument').first();
   assert((await publicProgram.getAttribute('class')).includes('civicPartyProgram'));assert((await publicProgram.textContent()).includes('В2'));
   assert.equal(await student.locator('.partyRegistrationDocActions button').count(),0,'Registered package is locked');
   const geometry=await student.evaluate(el=>({viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,cards:[...el.querySelectorAll('.civicPublicDocument')].map(c=>{const r=c.getBoundingClientRect(),style=getComputedStyle(c);return {left:r.left,right:r.right,display:style.display,decoration:style.textDecorationLine,border:style.borderTopWidth}})}));
   assert(geometry.scroll<=geometry.viewport+2,'Student cabinet overflows at '+width+': '+JSON.stringify(geometry));
   for(const c of geometry.cards){assert(c.left>=0&&c.right<=width+1);assert.equal(c.display,'grid');assert.equal(c.decoration,'none');assert.equal(c.border,'1px')}
   if([390,1600].includes(width))await student.screenshot({path:path.join(shots,'party-student-'+width+'.png')});
   assert.deepEqual(errors,[]);await page.close();console.log('PASS '+width+'px: teacher note, student revision, closed-stage guard, failed upload retry, V2, re-approval, history and styled public cards');
  }
 }catch(e){console.error(logs.join(''));throw e}
 finally{await closeTestBrowser(browser);await stopTestServer(server);cleanTestRoute(root,route)}
})().catch(e=>{console.error(e);process.exitCode=1});
