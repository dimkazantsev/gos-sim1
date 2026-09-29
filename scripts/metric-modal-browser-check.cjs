/* Browser-based layout regression for the real GOS//SIMS metric component.
   Uses only generated offline preview and a locally installed Chrome/Chromium. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');

const root=path.resolve(__dirname,'..');
const preview=path.join(root,'.design-review','gos-sim-preview.html');
const shotDir=path.join(root,'.design-review','screenshots');
fs.mkdirSync(shotDir,{recursive:true});
const chrome=[
 process.env.CHROME_BIN,
 '/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser',
 '/opt/google/chrome/chrome'
].find(p=>p&&fs.existsSync(p));
if(!chrome)throw new Error('Chrome/Chromium missing. Set CHROME_BIN for browser layout checks.');
if(!fs.existsSync(preview))throw new Error('Run npm run design:preview first.');

async function main(){
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1560,height:960},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('file://'+preview,{waitUntil:'load'});
  for(const width of [1440,768,390,360]){
   await page.locator('[data-width]').filter({hasText:'По ширине окна'}).count();
   if(width===1440){
    await page.locator('#preview').evaluate(el=>el.style.width='100%');
   }else{
    await page.locator('[data-width="'+width+'px"]').click();
   }
   await page.locator('#screen').selectOption('dashboard');
   const dashboard=page.frameLocator('#preview');
   const chat=dashboard.getByRole('button',{name:'Открыть чат'});
   assert.equal(await chat.count(),1,'Top bar must use Chat, not Connection');
   assert.equal((await chat.locator('span').innerText()).trim(),'Чат','Top bar label is Chat');
   if(width>=1100)assert(await chat.locator('span').isVisible(),'Desktop top bar must show the Chat label');
   else assert.equal(await chat.getAttribute('aria-label'),'Открыть чат','Icon-only mobile Chat remains accessible');
   const bounds=await dashboard.locator('.simWorkspace').evaluate(workspace=>{
    const bar=workspace.querySelector('.simTop');
    const chat=workspace.querySelector('.topChatButton');
    const main=workspace.querySelector('.simMain');
    const card=workspace.querySelector('.overviewHeading .quietButton');
    const w=workspace.getBoundingClientRect();
    const b=bar?.getBoundingClientRect();
    const c=chat?.getBoundingClientRect();
    const m=main?.getBoundingClientRect();
    const q=card?.getBoundingClientRect();
    return {workspaceRight:w.right,barRight:b?.right,chatRight:c?.right,
     mainRight:m?.right,cardRight:q?.right,barScrollWidth:bar?.scrollWidth,
     barClientWidth:bar?.clientWidth};
   });
   assert(bounds.chatRight!==undefined&&bounds.mainRight!==undefined,
    'Dashboard has toolbar and main content');
   assert(Math.abs(bounds.chatRight-bounds.mainRight)<=3,
    'Chat right edge must align with main content at '+width+'px: '+JSON.stringify(bounds));
   assert(bounds.barScrollWidth<=bounds.barClientWidth+3,
    'Toolbar overflows horizontally at '+width+'px: '+JSON.stringify(bounds));
   await page.locator('#preview').screenshot({path:path.join(shotDir,'top-chat-'+width+'.png')});
   console.log('PASS top Chat button alignment, label and no horizontal overflow at '+width+'px');
   for(const chatScreen of ['chat-panel','chat-empty','chat-channels','chat-pins','chat-recording','chat-audio-preview','chat-video-preview']){
    await page.locator('#screen').selectOption(chatScreen);
    const frame=page.frameLocator('#preview');
    const root=frame.locator('.simChat.gsChatV2');
    await root.waitFor();
    const dims=await root.evaluate(el=>{
     const box=el.getBoundingClientRect();
     const h=el.querySelector('.chatTop').getBoundingClientRect();
     const list=el.querySelector('.chatMessages').getBoundingClientRect();
     const compose=el.querySelector('.chatCompose').getBoundingClientRect();
     const textarea=el.querySelector('textarea').getBoundingClientRect();
     const doc=el.ownerDocument.documentElement;
     return {root:{x:box.x,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height},
      header:{top:h.top,bottom:h.bottom},messages:{top:list.top,bottom:list.bottom,height:list.height},
      composer:{top:compose.top,bottom:compose.bottom},
      textarea:{left:textarea.left,right:textarea.right,width:textarea.width},
      overflow:doc.scrollWidth-doc.clientWidth,viewport:doc.clientWidth};
    });
    const gap=3;
    assert(dims.root.width<=dims.viewport+gap,'Chat panel wider than viewport at '+width+'px');
    assert(dims.header.bottom<=dims.messages.top+gap,'Chat header overlaps message list at '+width+'px');
    assert(dims.messages.bottom<=dims.composer.top+gap,'Chat messages overlap composer at '+width+'px');
    assert(dims.messages.height>=100,'Chat message viewport collapsed at '+width+'px');
    assert(dims.root.bottom>=dims.composer.bottom-gap,'Composer escapes chat container at '+width+'px');
    assert(dims.textarea.left>=dims.root.x-gap&&dims.textarea.right<=dims.root.right+gap,'Chat input overflows panel at '+width+'px');
    assert(dims.overflow<=gap,'Chat page horizontally overflows at '+width+'px');
    assert.equal(await frame.locator('.chatChannelTrigger').count(),1,'Exactly one styled channel selector');
    assert.equal(await frame.locator('.simChat select').count(),0,'No native channel dropdown');
    assert.equal(await frame.locator('.chatSendButton.iconOnly svg').count(),1,'Icon-only send button');
    assert.equal(await frame.locator('.chatMediaShortcut').count(),2,'Audio and video recording are directly accessible');
    const composeLayout=await frame.locator('.chatCompose').evaluate(el=>{
     const row=el.querySelector('.chatInputRow').getBoundingClientRect();
     const textarea=el.querySelector('textarea').getBoundingClientRect();
     const send=el.querySelector('.chatSendButton.iconOnly').getBoundingClientRect();
     const mic=el.querySelector('.chatMediaShortcut').getBoundingClientRect();
     const video=el.querySelectorAll('.chatMediaShortcut')[1].getBoundingClientRect();
     const composer=el.getBoundingClientRect();
     return {rowTop:row.top,rowBottom:row.bottom,inputRight:textarea.right,sendLeft:send.left,
      sendRight:send.right,sendBottom:send.bottom,composerRight:composer.right,
      micBottom:mic.bottom,videoBottom:video.bottom,composerBottom:composer.bottom,
      sendWidth:send.width};
    });
    assert(composeLayout.inputRight<=composeLayout.sendLeft+3,'Send must not overlap the editable field');
    assert(composeLayout.sendRight<=composeLayout.composerRight+3,'Send must stay within the composer');
    assert(composeLayout.sendWidth>=40&&composeLayout.sendWidth<=45,'Send must be an accessible compact icon');
    assert(composeLayout.micBottom<=composeLayout.composerBottom+3&&composeLayout.videoBottom<=composeLayout.composerBottom+3,'Media shortcuts stay inside the footer');
    if(chatScreen==='chat-recording')assert.equal(await frame.locator('.chatCaptureStop').count(),1,'Recording has a stop control');
    if(chatScreen==='chat-audio-preview'){
     assert.equal(await frame.locator('.chatCaptureReview audio[controls]').count(),1,'Audio is reviewable before upload');
     assert.equal(await frame.locator('.chatCaptureSend').count(),1,'Audio review can be submitted');
    }
    if(chatScreen==='chat-video-preview'){
     assert.equal(await frame.locator('.chatCaptureReview video[controls]').count(),1,'Video is reviewable before upload');
     assert.equal(await frame.locator('.chatCaptureSend').count(),1,'Video review can be submitted');
    }

    assert((await frame.locator('.chatSendButton.iconOnly').boundingBox())?.width<=45,'Send button stays compact');
    if(chatScreen==='chat-channels'){
     assert.equal(await frame.locator('.chatChannelMenu [role="menuitemradio"]').count(),2,'Styled channel menu lists both channels');
     assert.equal(await frame.locator('.chatChannelMenu [aria-checked="true"]').count(),1,'Selected channel is marked');
    }
    if(chatScreen==='chat-pins'){
     assert.equal(await frame.locator('.chatPinnedItem').count(),3,'File, audio and video remain pinned');
     assert.equal(await frame.locator('.chatPinnedMedia').count(),3,'All pinned media has preview containers');
    }
    const close=frame.locator('.chatTop').getByRole('button',{name:'Закрыть чат'});
    assert.equal(await close.count(),1);
    const closeRect=await close.boundingBox();
    assert(closeRect&&closeRect.width>=40&&closeRect.height>=40,'Accessible chat close target');
    if(chatScreen!=='chat-empty'){
     assert(await frame.locator('.chatMsg.mine').count()>=2,'Own messages on right');
     assert(await frame.locator('.chatMsg.theirs').count()>=2,'Other authors on left');
     assert(await frame.locator('.chatDateSeparator').count()>=2,'Message days separated');
     assert.equal(await frame.locator('.chatMessages .chatDocument').count(),1,'File shown once in conversation; pinned copy is separate');
     assert.equal(await frame.locator('.chatBubble a.chatDocument+p').count(),0,'No duplicated filename after document');
    }else assert.equal(await frame.locator('.chatEmpty').count(),1,'Correct empty state');
    if(width<=768)assert(Math.abs(dims.root.width-dims.viewport)<=2,'Mobile/tablet chat should fill viewport');
    await page.locator('#preview').screenshot({path:path.join(shotDir,chatScreen+'-'+width+'.png')});
    console.log('PASS '+chatScreen+' '+width+'px: structured conversation, correct positioning and no overflow');
   }
   for(const screen of ['metric-modal','metric-modal-full','metric-modal-empty']){
    await page.locator('#screen').selectOption(screen);
    const frame=page.frameLocator('#preview');
    const dialog=frame.locator('.metricModal.redesigned');
    const closeButton=frame.getByRole('button',{name:'Закрыть показатель'});
    assert.equal(await closeButton.count(),1,'Metric dialog has exactly one labelled close button');
    const closeBox=await closeButton.boundingBox();
    assert(closeBox&&closeBox.width>=43&&closeBox.height>=43,'Metric close button has a 44px touch target');
    const cross=closeButton.locator('svg');
    assert.equal(await cross.count(),1,'Metric close control uses vector X icon');
    const crossBox=await cross.boundingBox();
    assert(crossBox&&Math.abs(crossBox.x+crossBox.width/2-closeBox.x-closeBox.width/2)<=1.5,
      'Metric close icon is optically centred horizontally');
    assert(crossBox&&Math.abs(crossBox.y+crossBox.height/2-closeBox.y-closeBox.height/2)<=1.5,
      'Metric close icon is optically centred vertically');

    const content=frame.locator('.metricModalBody');
    const plot=frame.locator('.metricPlotViewport');
    const filters=frame.locator('.metricSeriesControls');
    const journal=frame.locator('.metricHistoryList');
    await dialog.waitFor();
    await plot.locator('svg').waitFor();
    const dims=await dialog.evaluate(el=>{
     const box=el.getBoundingClientRect();
     const header=el.querySelector(':scope>header')?.getBoundingClientRect();
     const body=el.querySelector('.metricModalBody')?.getBoundingClientRect();
     const plot=el.querySelector('.metricPlotViewport')?.getBoundingClientRect();
     const filters=el.querySelector('.metricSeriesControls')?.getBoundingClientRect();
     const journal=el.querySelector('.metricHistoryList')?.getBoundingClientRect();
     const chips=[...el.querySelectorAll('.metricSeriesPrimary,.metricSeriesToggle')].map(x=>x.getBoundingClientRect());
     return {
      dialog:{x:box.x,right:box.right,width:box.width,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth},
      header:{top:header?.top,bottom:header?.bottom},
      body:{top:body?.top,bottom:body?.bottom,clientWidth:el.querySelector('.metricModalBody')?.clientWidth,scrollWidth:el.querySelector('.metricModalBody')?.scrollWidth},
      plot:{top:plot?.top,bottom:plot?.bottom,width:plot?.width,height:plot?.height},
      filters:{top:filters?.top,bottom:filters?.bottom},
      journal:{top:journal?.top,bottom:journal?.bottom},
      chips:chips.map(x=>({left:x.left,right:x.right,width:x.width,top:x.top,bottom:x.bottom})),
     };
    });
    const eps=3;
    assert(dims.plot.height>=204,screen+' '+width+'px: chart height collapsed');
    assert(dims.header.bottom<=dims.body.top+eps,screen+' '+width+'px: header overlaps scroll region');
    assert(dims.plot.bottom<=dims.filters.top+eps,screen+' '+width+'px: controls overlap plot');
    assert(dims.filters.bottom<=dims.journal.top+eps,screen+' '+width+'px: event journal overlaps controls');
    assert(dims.dialog.scrollWidth<=dims.dialog.clientWidth+eps,screen+' '+width+'px: dialog horizontally overflows');
    assert(dims.body.scrollWidth<=dims.body.clientWidth+eps,screen+' '+width+'px: content horizontally overflows');
    for(const chip of dims.chips){
     assert(chip.left>=dims.dialog.x-eps&&chip.right<=dims.dialog.right+eps,
      screen+' '+width+'px: filter chip extends past modal');
     assert(chip.width>=30,screen+' '+width+'px: filter chip collapsed');
    }
    assert.equal(await frame.locator('.metricChartLegend').count(),0,'duplicate chart legend');
    assert.equal(await frame.locator('.metricSeriesPrimary').count(),1,'one fixed primary series');
    assert.equal(await frame.locator('.metricSeriesToggle').count(),10,'all 10 compare options visible');
    const active=await frame.locator('.metricSeriesToggle.active').count();
    const disabled=await frame.locator('.metricSeriesToggle:disabled').count();
    assert.equal(active,screen==='metric-modal'?2:screen==='metric-modal-full'?3:0);
    assert.equal(disabled,screen==='metric-modal-full'?7:0);
    if(screen==='metric-modal-empty'){
     assert.equal(await frame.locator('.metricChartPoint').count(),1,'single point remains visible');
     assert(await frame.getByText('Записи об изменениях пока отсутствуют.').count()>=1);
    }
    await page.locator('#preview').screenshot({path:path.join(shotDir,screen+'-'+width+'.png')});
    const scrollInfo=await content.evaluate(el=>{el.scrollTop=el.scrollHeight;return {range:el.scrollHeight-el.clientHeight,scrolled:el.scrollTop}});
    if(scrollInfo.range>2)assert(scrollInfo.scrolled>2,'metric modal body cannot scroll');
    assert(await journal.isVisible(),'history remains in DOM and can be scrolled to');
    if(width===360||width===390){
     await page.locator('#preview').screenshot({path:path.join(shotDir,screen+'-'+width+'-scrolled.png')});
    }
    console.log('PASS '+screen+' '+width+'px: no overlaps, clipping or missing options');
   }
  }
  // Browser-level verification that actual MediaRecorder emits playable-size
  // audio/video blobs from microphone/camera, independent of authentication.
  const mediaPage=await browser.newPage();
  await mediaPage.goto('file://'+preview,{waitUntil:'load'});
  const recorded=await mediaPage.evaluate(async()=>{
   async function make(kind){
    const stream=await navigator.mediaDevices.getUserMedia(kind==='audio'?{audio:true}:{audio:true,video:true});
    try{
     const candidates=kind==='audio'?['audio/webm;codecs=opus','audio/mp4','audio/webm']:['video/webm;codecs=vp8,opus','video/mp4','video/webm'];
     const mime=candidates.find(t=>MediaRecorder.isTypeSupported(t));
     const recorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);
     const chunks=[];
     const finished=new Promise((resolve,reject)=>{
      recorder.addEventListener('dataavailable',e=>{if(e.data.size)chunks.push(e.data)});
      recorder.addEventListener('error',e=>reject(new Error('Recorder emitted error: '+e.type)));
      recorder.addEventListener('stop',()=>resolve(new Blob(chunks,{type:recorder.mimeType})));
     });
     recorder.start(80);
     await new Promise(resolve=>setTimeout(resolve,550));
     recorder.stop();
     const blob=await finished;
     return {kind,mime:recorder.mimeType,size:blob.size,trackCount:stream.getTracks().length};
    }finally{stream.getTracks().forEach(track=>track.stop())}
   }
   return [await make('audio'),await make('video')];
  });
  for(const result of recorded){
   assert(result.size>0,result.kind+' must record a nonempty media blob');
   assert(result.mime.startsWith(result.kind+'/'),result.kind+' must use a real matching MIME type: '+result.mime);
   assert(result.trackCount>=1,result.kind+' must capture at least one actual fake-device track');
   console.log('PASS real Chromium '+result.kind+' MediaRecorder: '+result.mime+', '+result.size+' bytes');
  }
  await mediaPage.close();
  // The chat panel uses the same close geometry as all modal headers.
  await page.locator('#screen').selectOption('chat');
  const chatClose=page.frameLocator('#preview').locator('.chatTop').getByRole('button',{name:'Закрыть чат'});
  assert.equal(await chatClose.count(),1,'Chat uses the shared close control');
  assert(await chatClose.locator('svg').isVisible(),'Chat close icon remains visible');
  assert.equal(errors.length,0,'Browser runtime exceptions:\n'+errors.join('\n'));
  console.log('PASS no page exceptions; desktop/mobile layouts and native media capture checked, screenshots saved to '+shotDir);
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
