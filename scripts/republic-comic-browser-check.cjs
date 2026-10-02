/* Actual profile entry points and reader: no writes to a real classroom. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),route=path.join(root,'app/republic-comic-test-route'),shots=path.join(root,'.design-review/screenshots');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome is required for comic reader interaction checks');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'.design-review/fixture.json'),'utf8'));
const source=`'use client';
import {useEffect,useState} from 'react';
import ProfileView from '../../components/game/ProfileView';
import RepublicComic from '../../components/game/RepublicComic';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
const initial=${JSON.stringify(fixture)};
export default function Test(){const [gameId,setGameId]=useState(initial.game.id),[first,setFirst]=useState(false),[finished,setFinished]=useState(0);
 useEffect(()=>{document.body.dataset.comicReady='yes'},[]);
 const g={...initial,game:{...initial.game,id:gameId},members:initial.members.map(m=>({...m,game_id:gameId})),me:{...initial.me,game_id:gameId},refresh:async()=>{},setError:()=>{}} as unknown as ReturnTypeRepublic;
 return <main style={{padding:16,maxWidth:1200,margin:'auto'}}><button onClick={()=>setFirst(true)}>Первый вход для проверки</button><button onClick={()=>setGameId('another-classroom')}>Переключить игру для проверки</button><output id="intro-finished">{finished}</output><ProfileView g={g} readOnly/><RepublicComic intro open={first} onClose={()=>{setFirst(false);setFinished(x=>x+1)}}/></main>;
}`;
const url='http://localhost:3994/republic-comic-test-route';let server,browser;const logs=[];
const chapters=[{id:'completed-10',stage_no:10,kind:'completed',title:'Государственные программы',body:'Правительство рассмотрело программу развития образования. Создан один документ, голосование по программе ещё не завершено.\n\nРезультат: документ — 1, завершённых голосований — 0.',snapshot:{documents:1,votes:0},created_at:'2026-10-02'},{id:'preview-11',stage_no:11,kind:'preview',title:'Следующая глава: Заседание Правительства',body:'Подготовьте повестку и рассмотрение программы. Распределите задачи между министрами и проверьте документы перед заседанием.',snapshot:{},created_at:'2026-10-02'}];
async function geometry(page){
 const result=await page.getByRole('dialog').evaluate(panel=>{
  const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
  const header=panel.querySelector('header'),frame=panel.querySelector('.comicFrame'),art=panel.querySelector('.comicFrame .comicArtwork'),story=panel.querySelector('.comicOverlay'),switcher=panel.querySelector('nav');return {kind:frame?.dataset.comicKind,frame:frame?box(frame):null,footer:panel.querySelector('footer')?box(panel.querySelector('footer')):null,width:innerWidth,height:innerHeight,panel:box(panel),scroll:document.documentElement.scrollWidth,controls:[...header.querySelectorAll('button')].map(b=>({button:box(b),icon:box(b.querySelector('svg'))})),title:box(header.querySelector('b')),art:art?box(art):null,story:story?box(story):null,switcherButtons:switcher?[...switcher.querySelectorAll('button')].map(box):[]};
 });
 assert(result.panel.height>=300&&result.panel.bottom<=result.height+2,'Reader must fit the viewport');
 assert(result.scroll<=result.width+2&&result.panel.right<=result.width+2,'No horizontal overflow');
 for(const {button,icon} of result.controls){assert(button.height>=44&&button.width===button.height);assert(Math.abs((button.left+button.right-icon.left-icon.right)/2)<1,'Icon horizontally centred');assert(Math.abs((button.top+button.bottom-icon.top-icon.bottom)/2)<1,'Icon vertically centred');assert(result.title.right<=button.left+2,'Header title must not overlap buttons')}
 if(result.art&&result.story){
  if(result.kind==='prologue'){
   assert.equal(result.switcherButtons.length,0,'The original prologue has no archive toolbar above its scene');
   assert.equal(result.controls.length,3,'Sound, play and close preserve the original three controls');
   assert(Math.abs(result.art.left-result.frame.left)<2&&Math.abs(result.art.right-result.frame.right)<2,'Cinematic illustration fills the entire scene width');
   assert(result.story.left<=result.art.left+2&&result.story.right>=result.art.right-2,'Story is over the scene, never a separate text column');
   assert(result.frame.bottom<=result.footer.top+2,'Footer controls stay outside the illustration and story');
  }else if(result.width<=850)assert(result.story.top>=result.art.bottom+16,'Archive story stays below the illustration on narrow screens');
  else assert(result.story.left>=result.art.right+16,'Archive artwork and text columns must not overlap');
 }
 if(result.switcherButtons.length>1)assert(Math.abs(result.switcherButtons[0].height-result.switcherButtons[1].height)<1,'Intro and archive controls have the same height even when a label wraps');
}
async function main(){
 fs.mkdirSync(route,{recursive:true});fs.mkdirSync(shots,{recursive:true});fs.writeFileSync(path.join(route,'page.tsx'),source);
 server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','-p','3994'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture'}});
 for(const p of [server.stdout,server.stderr])p.on('data',s=>{logs.push(String(s));if(logs.length>30)logs.shift()});
 try{
  for(let i=0;i<60;i++){if(server.exitCode!==null)throw Error(logs.join(''));try{if((await fetch(url,{signal:AbortSignal.timeout(5000)})).ok)break}catch{}if(i===59)throw Error('Comic fixture failed to start');await new Promise(r=>setTimeout(r,800))}
  browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const {width,height} of [{width:320,height:640},{width:390,height:844},{width:768,height:1000},{width:1440,height:900},{width:1024,height:600}]){
   const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],calls=[];let unavailable=false,longChapter=false;
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://*.supabase.co/**',async route=>{
    const address=new URL(route.request().url());let response=[];
    if(address.pathname.includes('/republic_comic_chapters')){calls.push(address.searchParams.get('game_id'));if(unavailable){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Network request failed'})});return}response=address.searchParams.get('game_id')==='eq.another-classroom'?[]:chapters.map(c=>longChapter&&c.id==='completed-10'?{...c,body:c.body+'\n\nПодробный протокол главы. '+('Участники проверили бюджетные назначения, сроки исполнения, источники финансирования и порядок парламентского контроля. Обоснования и приложения сохранены в реестре документов.\n\n').repeat(14)}:c)}
    if(address.pathname.includes('/get_member_public_stats'))response=[{posts:0,votes_cast:0,documents_created:0,activity_entries:0,events_decided:0}];
    if(address.pathname.includes('/get_achievement_catalog_counts'))response={open:60,hidden:40};
    if(address.pathname.includes('/is_my_platform_admin'))response=false;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
   });
   await page.goto(url);await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.waitForFunction(()=>document.body.dataset.comicReady==='yes');
   const profile=page.locator('.profileHeroControls');assert.equal(await profile.getByRole('button',{name:'Вводный комикс',exact:true}).count(),1);assert.equal(await profile.getByRole('button',{name:'Архив комиксов',exact:true}).count(),1);
   await profile.getByRole('button',{name:'Вводный комикс',exact:true}).click();await page.locator('.comicOverlay h2').filter({hasText:'Республика после бури'}).waitFor();
   assert.equal(await page.locator('.comicFrame').count(),1);const art=await page.locator('.comicFrame .comicArtwork').boundingBox();assert(art.height>145&&art.width>250,'Cinematic artwork must have real dimensions');await geometry(page);
   await page.locator('.comicFrame img').evaluate(async img=>{await img.decode();if(!img.naturalWidth)throw Error('Prologue image did not load')});
   const resolution=await page.locator('.comicFrame img').evaluate(img=>({chosen:Number(img.currentSrc.match(/-(\d+)\.webp/)?.[1]),needed:Math.min(1920,Math.max(img.clientWidth,img.clientHeight*16/9)*devicePixelRatio)}));
   assert(resolution.chosen>=resolution.needed-2,'Portrait backdrop has enough source pixels for its height, not just its width: '+JSON.stringify(resolution));
   assert.equal(await page.locator('.comicOverlay h2 br').count(),1,'The opening title keeps the two-line composition from the reference');
   assert.equal(await page.locator('.comicFooterLabel span').textContent(),'01 / 04');
   assert.equal(await page.locator('.comicFrame img').getAttribute('data-comic-art'),'storm');
   if(width===390){
    await page.getByRole('button',{name:'Включить звук комикса',exact:true}).click();await page.getByRole('button',{name:'Выключить звук комикса',exact:true}).waitFor();await page.getByRole('button',{name:'Выключить звук комикса',exact:true}).click();
    await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'Продолжить показ',exact:true}).click();
    assert.equal(await page.locator('.comicFrame img').evaluate(img=>getComputedStyle(img).animationPlayState),'running');
    await page.getByRole('button',{name:'Остановить автоматическое воспроизведение',exact:true}).click();
    assert.equal(await page.locator('.comicFrame img').evaluate(img=>getComputedStyle(img).animationPlayState),'paused');await page.emulateMedia({reducedMotion:'reduce'});
   }
   assert.equal(await page.locator('.comicDialog .comicSoundButton span').count(),0,'Icon-only sound must not leak a text label');
   await page.screenshot({path:path.join(shots,'republic-comic-intro-'+width+'.png')});
   for(const [index,title] of ['Казна почти пуста','Люди требуют ответа','Теперь решаете вы'].entries()){
    await page.getByRole('button',{name:'Следующая сцена',exact:true}).click();await page.locator('.comicOverlay h2').filter({hasText:title}).waitFor();
    await page.locator('.comicFrame img').evaluate(img=>img.decode());
    assert.equal(await page.locator('.comicFrame img').getAttribute('data-comic-art'),['treasury','citizens','renewal'][index]);
    if(width===1440)await page.screenshot({path:path.join(shots,'republic-comic-scene-'+(index+2)+'-'+width+'.png')});
   }
   await page.getByRole('button',{name:'Завершить просмотр',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#intro-finished').textContent(),'0','Manual replay does not alter first-login progress');
   await profile.getByRole('button',{name:'Архив комиксов',exact:true}).click();await page.getByRole('button',{name:/Итоги · Этап 10/}).waitFor();assert.equal(await page.getByRole('button',{name:/Пролог · 4 сцены/}).count(),1,'Archive keeps the original four-scene introduction');await geometry(page);await page.screenshot({path:path.join(shots,'republic-comic-library-'+width+'.png')});
   await page.getByRole('button',{name:/Итоги · Этап 10/}).click();await page.locator('.comicOverlay h2').filter({hasText:'Государственные программы'}).waitFor();assert((await page.locator('.comicOverlay p').textContent()).includes('документ — 1'));await geometry(page);await page.screenshot({path:path.join(shots,'republic-comic-chapter-'+width+'.png')});
   if(width===1024){
    longChapter=true;const refreshed=page.waitForResponse(r=>r.url().includes('/republic_comic_chapters'));await page.getByRole('dialog').getByRole('button',{name:'Открыть архив комиксов',exact:true}).click();await refreshed;
    await page.getByRole('button',{name:/Итоги · Этап 10/}).click();await page.locator('.comicOverlay p').filter({hasText:'Подробный протокол главы'}).waitFor();
    const initial=await page.locator('.comicFrame').evaluate(frame=>{frame.scrollTop=0;return {top:frame.getBoundingClientRect().top,storyTop:frame.querySelector('.comicOverlay').getBoundingClientRect().top,overflow:frame.scrollHeight-frame.clientHeight}});
    assert(initial.overflow>300,'Fixture contains a genuinely long chapter');assert(initial.storyTop>=initial.top+10,'Long chapter starts in the reachable scroll area');
    await page.screenshot({path:path.join(shots,'republic-comic-long-chapter-start-'+width+'.png')});await page.locator('.comicOverlay strong').scrollIntoViewIfNeeded();
    const end=await page.locator('.comicFrame').evaluate(frame=>({bottom:frame.getBoundingClientRect().bottom,stampBottom:frame.querySelector('.comicOverlay strong').getBoundingClientRect().bottom,scroll:frame.scrollTop}));
    assert(end.scroll>0&&end.stampBottom<=end.bottom+2,'Last paragraph and completion label remain reachable');console.log('PASS long chapter: beginning, full text and final label are reachable in a 600px window');
   }
   await page.getByRole('button',{name:'Следующая глава',exact:true}).click();await page.locator('.comicOverlay h2').filter({hasText:'Заседание Правительства'}).waitFor();await page.getByRole('button',{name:'Вернуться в архив',exact:true}).click();await page.getByRole('button',{name:/Пролог · 4 сцены/}).click();await page.locator('.comicOverlay h2').filter({hasText:'Республика после бури'}).waitFor();
   await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),'Архив комиксов','Focus returns to the profile entry');
   await profile.getByRole('button',{name:'Вводный комикс',exact:true}).click();await page.locator('.comicOverlay h2').filter({hasText:'Республика после бури'}).waitFor();await page.getByRole('button',{name:'Закрыть комикс',exact:true}).click();
   if(width===390){
    unavailable=true;await profile.getByRole('button',{name:'Архив комиксов',exact:true}).click();await page.getByRole('status').filter({hasText:'Не удалось загрузить главы'}).waitFor();await page.getByRole('button',{name:/Пролог · 4 сцены/}).click();await page.locator('.comicOverlay h2').filter({hasText:'Республика после бури'}).waitFor();await page.getByRole('button',{name:'Закрыть комикс',exact:true}).click();unavailable=false;
    await page.getByRole('button',{name:'Переключить игру для проверки',exact:true}).click();await profile.getByRole('button',{name:'Архив комиксов',exact:true}).click();await page.getByText('Этапы пока не завершены.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:/Итоги · Этап 10/}).count(),0,'Another classroom cannot inherit old chapters');assert(calls.includes('eq.another-classroom'));await page.getByRole('button',{name:'Закрыть комикс',exact:true}).click();
   }
   await page.getByRole('button',{name:'Первый вход для проверки',exact:true}).click();assert(await page.getByRole('button',{name:'Завершить пролог после просмотра',exact:true}).isDisabled());assert.equal(await page.getByRole('button',{name:'Архив комиксов',exact:true}).count(),1,'Automatic prologue has no archive navigation');await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1,'Required introduction stays open before its final scene');
   for(let i=0;i<3;i++)await page.getByRole('button',{name:'Следующая сцена',exact:true}).click();await page.getByRole('button',{name:'Завершить пролог после просмотра',exact:true}).click();assert.equal(await page.locator('#intro-finished').textContent(),'1');
   assert.deepEqual(errors,[],'No runtime errors at '+width+'px');console.log('PASS '+width+'×'+height+': reference composition, four distinct loaded cinematic images, sound/play, archive/chapter/return, centred 44px controls, first-login gating');await context.close();
  }
 }finally{await browser?.close();server?.kill('SIGTERM');fs.rmSync(route,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);console.error(logs.join(''));process.exitCode=1});
