/* Real components with a synthetic owner game; Clipboard API and HTTP are mocked. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright-core');
const {startTestServer,closeTestBrowser,stopTestServer,cleanTestRoute}=require('./browser-test-runtime.cjs');
const root=path.resolve(__dirname,'..'),route=path.join(root,'app/teacher-code-copy-test-route'),shots=path.join(root,'.design-review/screenshots');
const chrome=[process.env.CHROME_BIN,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
assert(chrome,'A local Chromium browser is required');assert(!fs.existsSync(route),'Do not overwrite an existing route');
const game='00000000-0000-0000-0000-000000000025',url='http://127.0.0.1:3996/teacher-code-copy-test-route';
let server,browser;const logs=[];
async function main(){
 fs.mkdirSync(route,{recursive:true});fs.mkdirSync(shots,{recursive:true});
 fs.writeFileSync(path.join(route,'page.tsx'),"'use client';\nimport TeacherGameSessions from '../../components/game/TeacherGameSessions';\nexport default function Test(){return <main style={{maxWidth:1100,margin:'auto',padding:16}}><TeacherGameSessions/></main>}");
 server=startTestServer(root,3996,{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture'});
 for(const p of [server.stdout,server.stderr])p.on('data',s=>{logs.push(String(s));if(logs.length>30)logs.shift()});
 try{
  for(let i=0;i<60;i++){if(server.exitCode!==null)throw Error(logs.join(''));try{if((await fetch(url,{signal:AbortSignal.timeout(5000)})).ok)break}catch{}if(i===59)throw Error('Test route did not start');await new Promise(r=>setTimeout(r,500))}
  browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[360,780],[844,390]]){
   const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),requests=[],errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{window.__copied=[];window.__copyReject=false;window.__clipboard={writeText:async value=>{if(window.__copyReject)throw Error('Permission denied');window.__copied.push(value)}};Object.defineProperty(navigator,'clipboard',{configurable:true,value:window.__clipboard})});
   await page.route('https://*.supabase.co/**',async r=>{
    const u=new URL(r.request().url());requests.push(u.pathname);
    let data;
    if(u.pathname.endsWith('/list_my_teacher_games'))data={games:[{id:game,title:'Тестовая сохранённая игра',status:'preparing',created_at:'2026-10-25T00:00:00Z',is_owner:true}],is_admin:false};
    else if(u.pathname.endsWith('/teacher_saved_invitation_list'))data=[
     {id:'participant-active',scope:'participant',group_name:null,active:true,created_at:'2026-10-25T00:00:00Z',code:'STD-SAVED-TEST'},
     {id:'teacher-active',scope:'teacher',group_name:null,active:true,created_at:'2026-10-25T00:00:00Z',code:'TCH-DO-NOT-COPY'},
     {id:'guest-active',scope:'guest',group_name:null,active:true,created_at:'2026-10-25T00:00:00Z',code:'GST-DO-NOT-COPY'}
    ];
    else if(u.pathname==='/rest/v1/games')data={game_code:'GOS-SAVED-TEST',title:'Тестовая сохранённая игра'};
    else throw Error('Unexpected request: '+u.pathname);
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   });
   await page.goto(url,{waitUntil:'networkidle'});await page.getByText('GOS-SAVED-TEST',{exact:true}).waitFor();await page.addStyleTag({content:'nextjs-portal{display:none}'});
   await page.getByRole('button',{name:'Создать игру',exact:true}).click();
   const form=page.locator('.gosTeacherCreateForm'),inputs=form.locator('input'),bulk=form.getByRole('button',{name:'Копировать все коды',exact:true});
   const copies=['Копировать код игры','Копировать приглашение преподавателя','Копировать приглашение участника'].map(name=>form.getByRole('button',{name,exact:true}));
   for(const b of copies)assert(await b.isDisabled());assert(await bulk.isDisabled());
   const count=requests.length,last=()=>page.evaluate(()=>window.__copied.at(-1));
   const savedBulk=page.getByRole('button',{name:'Копировать название игры, код и приглашение участника',exact:true});
   assert(await savedBulk.isEnabled(),'Saved-game participant copy is available without opening the creation form');
   await savedBulk.click();
   assert.equal(await last(),'Название игры: Тестовая сохранённая игра\n\nКод игры: GOS-SAVED-TEST\n\nПриглашение участника: STD-SAVED-TEST','Saved-game copy contains exactly the current owner-visible participant access data');
   assert(!(await last()).includes('TCH-')&&!(await last()).includes('GST-'),'Never copy teacher or guest access');
   assert.equal(requests.length,count,'Bulk copy does not fetch or mutate anything');
   const inviteRows=page.locator('.teacherCodeRow');
   assert.equal(await inviteRows.count(),3,'Owner invitation inventory has three fixture rows');
   for(const [scope,expected] of [['guest','GST-DO-NOT-COPY'],['teacher','TCH-DO-NOT-COPY'],['participant','STD-SAVED-TEST']]){
    const row=inviteRows.filter({has:page.locator('code', {hasText:expected})});
    const action=row.locator('.teacherCodeRowActions');
    const icon=action.getByRole('button',{name:'Копировать код: '+({guest:'Приглашение гостя',teacher:'Приглашение дополнительного преподавателя',participant:'Приглашение участника'}[scope]),exact:true});
    assert.equal(await icon.count(),1,'One accessible row copy icon for '+scope);
    assert.equal((await icon.innerText()).trim(),'','Copy is icon-only in inventory '+scope);
    assert.equal(await row.getByRole('button',{name:'Копировать',exact:true}).count(),0,'No full-size copy button remains in inventory');
    const revoke=action.getByRole('button',{name:'Отключить',exact:true});
    const iconBox=await icon.boundingBox(),revokeBox=await revoke.boundingBox();
    assert(iconBox&&revokeBox&&Math.abs(iconBox.y-revokeBox.y)<2&&revokeBox.x-iconBox.x-iconBox.width>=0&&revokeBox.x-iconBox.x-iconBox.width<=12,'Copy icon stays adjacent and aligned with revoke at '+width);
    assert(iconBox.width>=44&&iconBox.height>=44,'Icon copy target is at least 44px square');
    await icon.click();assert.equal(await last(),expected,'Row copy uses the matching invitation only');
   }
   assert.equal(requests.length,count,'Copying invitation rows must not call Supabase');
   await savedBulk.focus();await page.keyboard.press('Enter');
   assert.equal(await last(),'Название игры: Тестовая сохранённая игра\n\nКод игры: GOS-SAVED-TEST\n\nПриглашение участника: STD-SAVED-TEST');
   const generators=[form.getByRole('button',{name:'Сгенерировать код игры',exact:true}),...await form.getByRole('button',{name:'Сгенерировать код',exact:true}).all()];
   assert.equal(generators.length,3);
   for(let i=0;i<3;i++){await generators[i].click();const value=await inputs.nth(i+1).inputValue();assert(value.startsWith(['GOS-','TCH-','STD-'][i]));await copies[i].click();assert.equal(await last(),value)}
   const previous=await inputs.nth(1).inputValue();await generators[0].click();await copies[0].click();assert.notEqual(await last(),previous);assert.equal(await last(),await inputs.nth(1).inputValue());
   await inputs.nth(0).fill('  Республика теста  ');await inputs.nth(1).fill(' gos-demo ');await inputs.nth(2).fill('  TCH-PRIVATE-TEST  ');await inputs.nth(3).fill('  STD-DEMO-TEST  ');
   for(let i=0;i<3;i++){await copies[i].click();assert.equal(await last(),['GOS-DEMO','TCH-PRIVATE-TEST','STD-DEMO-TEST'][i])}
   await bulk.click();assert.equal(await last(),'Название игры: Республика теста\n\nКод игры: GOS-DEMO\n\nПриглашение участника: STD-DEMO-TEST');assert(!(await last()).includes('TCH-'));
   await inputs.nth(2).fill('');assert(await bulk.isEnabled(),'Teacher invitation is not part of the participant message');
   await inputs.nth(0).fill('  ');assert(await bulk.isDisabled());await inputs.nth(0).fill('Республика теста');
   await inputs.nth(3).fill('  ');assert(await copies[2].isDisabled());assert(await bulk.isDisabled());await inputs.nth(3).fill('STD-DEMO-TEST');
   await page.evaluate(()=>window.__copyReject=true);await copies[0].click();await page.getByRole('alert').filter({hasText:'Не удалось скопировать'}).waitFor();
   await page.evaluate(()=>{window.__copyReject=false;Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})});await bulk.click();assert(await page.locator('.gosTeacherSessionsError').isVisible());
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:window.__clipboard}));await bulk.focus();await page.keyboard.press('Enter');assert.equal(await last(),'Название игры: Республика теста\n\nКод игры: GOS-DEMO\n\nПриглашение участника: STD-DEMO-TEST');assert.equal(await page.locator('.gosTeacherSessionsError').count(),0);await inputs.nth(2).fill('TCH-PRIVATE-TEST');
   const roleGroups=page.locator('.teacherCodeActiveRoles');assert.equal(await roleGroups.count(),2,'Exactly two owner code groups');
   assert.equal(await page.locator('.teacherCodeGame').count(),1,'Game code appears only once');
   assert.equal(await page.locator('.teacherCodeEditor,.teacherCodeGrid').count(),0,'No redundant lower editor');
   if(width>760){
    const rects=await roleGroups.first().locator('.teacherCodeActiveRole').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
    assert.equal(rects.length,2);assert(Math.abs(rects[0].width-rects[1].width)<3,'Owner cards occupy two balanced columns');
    const second=await roleGroups.nth(1).locator('.teacherCodeActiveRole').evaluateAll(nodes=>nodes.map(n=>({code:n.querySelector('code').getBoundingClientRect().top,buttons:n.querySelector('.teacherCodeActions').getBoundingClientRect().top})));
    assert(Math.abs(second[0].code-second[1].code)<3&&Math.abs(second[0].buttons-second[1].buttons)<3,'Teacher/guest fields are vertically aligned');
   }
   const gameCard=page.locator('.teacherCodeGame');await gameCard.getByRole('button',{name:'Изменить код',exact:true}).click();
   const extra=page.locator('.teacherCodeAdditional');await extra.locator('summary').click();
   const editors=[gameCard.locator('.teacherCodeInlineEditor'),extra.locator('.teacherCodeAdditionalFields')];
   const newGame=page.getByRole('button',{name:'Копировать новый код игры',exact:true}),newInvite=page.getByRole('button',{name:'Копировать новое приглашение',exact:true});
   assert(await newGame.isDisabled());assert(await newInvite.isDisabled());
   await editors[0].getByRole('button',{name:'Сгенерировать',exact:true}).click();await newGame.click();assert.equal(await last(),await editors[0].locator('input').inputValue());
   await editors[0].locator('input').fill(' gos-edited ');await newGame.click();assert.equal(await last(),'GOS-EDITED');
   for(const [scope,prefix] of [['participant','STD-'],['group','GRP-'],['guest','GST-'],['teacher','TCH-']]){
    await editors[1].locator('select').selectOption(scope);await editors[1].getByRole('button',{name:'Сгенерировать',exact:true}).click();await newInvite.click();assert((await last()).startsWith(prefix));assert.equal(await last(),await editors[1].getByRole('textbox',{name:'Код приглашения'}).inputValue());
    const fields=editors[1].locator('.teacherCodeAdditionalField');
    const controls=await fields.evaluateAll(nodes=>nodes.map(node=>({label:node.querySelector('label').getBoundingClientRect().top,field:node.querySelector('input,select').getBoundingClientRect().top,rect:node.getBoundingClientRect().toJSON()})));
    if(width>760)assert(Math.abs(controls[0].label-controls[1].label)<2&&Math.abs(controls[0].field-controls[1].field)<2,'Select and invitation input must share label and field baselines at '+width);
    else assert(controls[1].rect.top>controls[0].rect.bottom,'On narrow screens the fields stack cleanly at '+width);
    const hint=await fields.first().locator('.teacherAccessExplanation').boundingBox();assert(hint&&hint.y>controls[0].field,'Hint stays beneath its select');
   }
   await editors[1].getByRole('textbox',{name:'Код приглашения'}).fill('  edited-invite  ');await newInvite.click();assert.equal(await last(),'edited-invite');
   assert.equal(requests.length,count,'Copying or generating must never submit, save, rotate or fetch codes');assert.deepEqual(errors,[]);
   const geometry=await form.evaluate(el=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth,footer:el.querySelector('.gosTeacherCreateFormActions').getBoundingClientRect().toJSON(),buttons:[...el.querySelectorAll('button')].map(b=>({name:b.textContent,...b.getBoundingClientRect().toJSON()}))}));
   assert(geometry.scroll<=width+1,'No horizontal overflow at '+width);assert(geometry.buttons.every(b=>b.height>=44),'Touch controls are at least 44px');
   if(width>960){const tops=await form.locator('.gosTeacherCreateCodes input').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert(Math.abs(tops[0]-tops[1])<2,'Invitation inputs align despite the teacher hint')}
   const all=geometry.buttons.find(b=>b.name.includes('Копировать все коды'));if(width>600)assert(Math.abs(all.right-geometry.footer.right)<2,'Combined copy sits on the right');
   await form.screenshot({path:path.join(shots,'teacher-code-copy-'+width+'.png')});
   console.log('PASS '+width+'×'+height+': five draft copy buttons, exact combined text, edits/regeneration, empty/error states, keyboard, no RPC or overflow');await context.close();
  }
 }finally{await closeTestBrowser(browser);await stopTestServer(server);cleanTestRoute(root,route)}
}
main().catch(e=>{console.error(e);console.error(logs.join(''));process.exitCode=1});
