'use strict';
// #491 Browser smoke for real current Next.js entry, not a full 16-stage E2E.
// All Supabase routes are intercepted and return deterministic mock data.
// 100 independent browser contexts in groups of 10; NOT 100 simultaneous users.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {performance}=require('node:perf_hooks');
const {chromium}=require('playwright-core');
const ORIGIN='http://127.0.0.1:4180';
const API='http://127.0.0.1:54321';
const TOTAL=100,PARALLEL=2,WIDTHS=[360,390,768,1024,1440];
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
assert.equal(process.env.GOS_BROWSER_ENTRY_QA,'MOCK-ONLY','Only the explicitly isolated QA environment may execute');
assert(chrome,'Chrome/Chromium is required');
function uuid(n){return 'abcdef01-2345-4678-9abc-'+String(n).padStart(12,'0')}
function token(n){
 const encode=s=>Buffer.from(JSON.stringify(s)).toString('base64url');
 return encode({alg:'HS256',typ:'JWT'})+'.'+encode({
  sub:uuid(n),role:'authenticated',aud:'authenticated',
  exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),
  is_anonymous:true
 })+'.isolated-qa-signature';
}
const headers={'access-control-allow-origin':'*',
 'access-control-allow-headers':'apikey, authorization, x-client-info, content-type, prefer, x-supabase-api-version',
 'access-control-allow-methods':'GET,POST,OPTIONS,PATCH,HEAD',
 'content-type':'application/json; charset=utf-8'};
function pcts(numbers){const sorted=[...numbers].sort((a,b)=>a-b);
 const at=p=>Math.round(sorted[Math.ceil(numbers.length*p)-1]);
 return {p50_ms:at(.5),p95_ms:at(.95),p99_ms:at(.99)};}
async function main(){
 let authCount=0,joins=0,badJoin=0,offHost=0,errors=[];
 const timings=[],entries=[];
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  async function visit(n,{kind='student',denyJoin=false,teacher=false}={}){
   const width=WIDTHS[n%WIDTHS.length],ctx=await browser.newContext({
    viewport:{width,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
   const calls=[];let page;
   try{
    await ctx.route('**/*',async route=>{
     const req=route.request(),url=new URL(req.url());
     if(url.origin===ORIGIN)return route.continue();
     if(url.origin!==API){offHost++;return route.abort('blockedbyclient');}
     if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
     const path=url.pathname;
     if(path==='/auth/v1/signup'){
      authCount++;calls.push('signup');
      return route.fulfill({status:200,headers,body:JSON.stringify({
       access_token:token(n+1),token_type:'bearer',expires_in:3600,
       refresh_token:'qa-refresh-'+(n+1),
       user:{id:uuid(n+1),aud:'authenticated',role:'authenticated',
        created_at:'2026-10-30T00:00:00Z',updated_at:'2026-10-30T00:00:00Z',
        is_anonymous:true,app_metadata:{provider:'anonymous',providers:['anonymous']},
        user_metadata:{full_name:'Тестовый Участник '+n},identities:[]}
      })});
     }
     if(path==='/auth/v1/user')return route.fulfill({status:200,headers,body:JSON.stringify({
      id:uuid(n+1),aud:'authenticated',role:'authenticated',is_anonymous:true,
      app_metadata:{provider:'anonymous'},user_metadata:{full_name:'Тестовый Участник '+n}
     })});
     if(path==='/rest/v1/rpc/join_game_as_role'){
      const body=JSON.parse(req.postData()||'{}');
      calls.push('join');
      if(denyJoin){badJoin++;return route.fulfill({status:403,headers,
       body:JSON.stringify({code:'42501',message:'Код игры и приглашение не соответствуют выбранной роли'})});}
      assert.equal(body.p_expected_kind,kind==='guest'?'observer':'student');
      assert.equal(body.p_game_code,'QA100');
      assert.equal(body.p_invite_code,kind==='guest'?'GST-LOCAL-100':'STD-LOCAL-100');
      assert.equal(body.p_group_name,kind==='guest'?null:'ГМУ-100');
      joins++;return route.fulfill({status:200,headers,body:JSON.stringify(uuid(555))});
     }
     // Browser may start game data reads after successful navigation.
     if(path.startsWith('/rest/v1/'))return route.fulfill({status:403,headers,
      body:JSON.stringify({code:'42501',message:'QA stops at successful entry navigation'})});
     throw Error('Unexpected Auth request in isolated entry QA: '+path);
    });
    page=await ctx.newPage();
    const start=performance.now();
    await page.goto(ORIGIN+'/',{waitUntil:'domcontentloaded',timeout:30000});
    // DOM can be visible while Next.js dev is still compiling/hydrating;
    // controlled inputs get a value tracker only after React mounts.
    await page.waitForFunction(()=>!!document.querySelector('input[name="fullName"]')?._valueTracker,null,{timeout:30000});
    if(teacher){
     await page.getByRole('button',{name:'Преподаватель',exact:true}).click();
    }else if(kind==='guest'){
     await page.getByRole('button',{name:'Гость',exact:true}).click();
    }
    await page.locator('input[name="fullName"]').fill('Тестовый Участник '+n);
    await page.locator('input[name="gameCode"]').fill('QA100');
    if(kind==='student')await page.locator('input[name="group"]').fill('ГМУ-100');
    await page.locator('#invite-code').fill(teacher?'TCH-LOCAL-100':kind==='guest'?'GST-LOCAL-100':'STD-LOCAL-100');
    const geometry=await page.evaluate(()=>({
     screen:document.documentElement.clientWidth,
     page:document.documentElement.scrollWidth,
     submitVisible:(()=>{const r=document.querySelector('.entrySubmit')?.getBoundingClientRect();
      return !!r&&r.width>0&&r.left>=-1&&r.right<=window.innerWidth+1})()
    }));
    assert(geometry.page<=geometry.screen+2,'Horizontal overflow on entry at '+width+'px: '+JSON.stringify(geometry));
    assert(geometry.submitVisible,'Login button clipped at '+width+'px');
    if(n<5&&kind==='student'){
     fs.mkdirSync('.design-review/screenshots',{recursive:true});
     const shot='.design-review/screenshots/qa-entry-'+width+'.png';
     await page.screenshot({path:shot,fullPage:true,animations:'disabled'});
    }
    await page.locator('.entrySubmit').click();
    if(teacher){
     const error=page.getByRole('alert');
     await error.waitFor({timeout:10000});
     assert.match(await error.innerText(),/подтверждённой почте|личный пароль/i);
     assert.deepEqual(calls,[],'A teacher must never enter anonymously or join through invite alone');
    }else if(denyJoin){
     const error=page.getByRole('alert');await error.waitFor({timeout:10000});
     assert.match(await error.innerText(),/Код игры|приглашение/i);
     assert.deepEqual(calls,['signup','join'],'A rejected invite must not navigate');
     assert.equal(new URL(page.url()).pathname,'/');
    }else{
     // Next.js dev may not finish loading the game module while other
     // contexts compile it. Entry acceptance checks the route transition,
     // not the subsequent game bootstrap (which is a separate E2E case).
     await page.waitForURL(url=>url.pathname.includes('/game/'),{
      waitUntil:'commit',timeout:15000
     });
     assert.deepEqual(calls,['signup','join'],'Each browser context must authorize once and join once');
     entries.push({n,width,role:kind});
    }
    timings.push(performance.now()-start);
   }catch(e){errors.push({n,width,kind,teacher,denyJoin,error:String(e?.stack||e).slice(0,600),calls,url:page?.url()||''});}
   finally{await ctx.close();}
  }
  // Bounded fan-out avoids conflating a 100-browser memory stress test
  // with server concurrency. Each request uses an independent context.
  for(let first=0;first<TOTAL;first+=PARALLEL)
   await Promise.all(Array.from({length:PARALLEL},(_,i)=>visit(first+i)));
  await visit(100,{kind:'guest'});
  await visit(101,{teacher:true});
  await visit(102,{denyJoin:true});
  assert.equal(errors.length,0,'Browser failures: '+JSON.stringify(errors.slice(0,5)));
  assert.equal(entries.length,101,'100 student entries and one guest entry');
  assert.equal(authCount,102,'100 students, guest, and one denied student get own anonymous sessions');
  assert.equal(joins,101);
  assert.equal(badJoin,1);
  assert.equal(offHost,0,'No off-host requests permitted');
  console.log(JSON.stringify({status:'PASS',scope:'REAL Next.js entry in Chromium, MOCK Supabase Auth/RPC; 100 separate contexts in 50 waves of 2, not 100 active at once and not real backend or 16-stage browser E2E',studentEntries:100,guestEntries:1,teacherWithoutPasswordDenied:1,badInviteDenied:1,anonymousSessions:authCount,successfulJoins:joins,offHostRequests:offHost,viewports:WIDTHS,latencyMs:pcts(timings),errors:errors.length,productionRequests:0}));
 }finally{await browser.close();}
}
main().catch(e=>{console.error('FAIL browser entry QA',e);process.exitCode=1});
