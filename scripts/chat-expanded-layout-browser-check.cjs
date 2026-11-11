'use strict';
/* Focused CSS/browser test: no Supabase connection, no extra requests. */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const panel=fs.readFileSync('components/game/ChatPanel.tsx','utf8');
const picker=fs.readFileSync('components/game/ChatChannelDropdown.tsx','utf8');
const css=fs.readFileSync('app/profile-chat-responsive.css','utf8');
const responsiveSiteCss=fs.readFileSync('app/design-readability.css','utf8')+fs.readFileSync('app/mobile-nav-polish.css','utf8')+fs.readFileSync('app/teacher-ui-polish.css','utf8');
assert(panel.includes('className="chatHeadIcon chatExpandTrigger"')&&panel.includes('onClick={()=>setExpanded(value=>!value)}'),'The message icon must expand chat');
assert(panel.includes('createPortal(chatView,document.body)'),'Expanded chat must escape the page stacking context');
assert(panel.includes('expanded={expanded}'));
assert(panel.includes('useDialog(overlay||expanded'));
assert(picker.includes('const showOptions=expanded||open'));
assert(!picker.includes('onExpand')&&picker.includes('if(open){setOpen(false);return}'),'Channel picker must not expand the chat');
assert(picker.includes('visibleChatChannels(channels,safeOverview)'));
assert(!css.includes('@import'),'No additional network assets');
assert(panel.includes('className="chatResizeGrip"')&&panel.includes('setPointerCapture(e.pointerId)')&&panel.includes('onLostPointerCapture'),'Chat resize captures pointers and releases on cancel');
assert(panel.includes("e.key==='ArrowUp'?24:-24")&&panel.includes('manualComposerHeight.current!==null'),'Keyboard control and manual height persist during typing');
assert(css.includes('touch-action:none')&&css.includes('max-height:none!important;resize:none'),'Touch-enabled resize escapes old 104px height cap');
assert(css.includes('width:min(calc(100% - 70px),1060px)'),'Expanded long message width grows without unbounded lines');
assert(panel.includes('expanded&&<button type="button" className="chatIconButton"'),'Collapse action reuses existing icon style');
assert(panel.includes("viewport.height-headerHeight")&&!panel.includes("dockHeight"),'Phone chat must not reserve hidden application dock space');
assert(panel.includes('chatPhoneHeadIcon')&&css.includes('.chatTop .chatExpandTrigger,')&&css.includes('display:none!important'),'Phone must not show the expand control');
assert(panel.includes('chatProcessTagMobileButton')&&panel.includes('open={processTagsOpen}'),'Phone # action uses existing process tags');
assert(!panel.includes('className="chatRetentionNotice"'),'Obsolete media banner is removed');
assert(css.includes('.chatRetentionNotice {display:none}'),'Original phone rules remain unchanged');
assert(css.includes('Desktop chat: the same # control'),'Only desktop adds the new tag layout');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
if(!chrome)throw Error('Chrome is required');
const baseline='*{box-sizing:border-box}:root{--gs-ink:#173455;--gs-muted:#728199;--gs-border:#dce5f2;--gs-accent:#2453e6;--gs-surface-soft:#f6f8fd;--gs-shadow-lg:0 8px 25px #17244722}body{margin:0}.simChat{position:fixed;top:78px;right:16px;bottom:16px;width:430px;display:flex;flex-direction:column;background:white;border:1px solid var(--gs-border);border-radius:20px;overflow:hidden}.chatTop{position:relative;min-height:78px;display:flex;align-items:center;gap:12px;padding:17px 18px;border-bottom:1px solid var(--gs-border)}.chatHeadIcon{flex:none;width:40px;height:40px}.chatChannelPicker{position:static;flex:1;min-width:0}.chatChannelTrigger{display:flex;min-height:44px}.chatChannelMenu{position:absolute;top:100%;left:12px;right:12px;max-height:340px;background:white}.chatChannelOptionRow{display:grid;min-height:60px}.chatMessages{display:flex;flex:1;min-height:0;flex-direction:column;width:100%;padding:12px 14px;background:#f6f8fd;overflow:auto}.chatMsg{display:flex;min-width:0;width:100%}.chatMsg.mine{justify-content:flex-end}.chatMessageColumn{max-width:calc(100% - 70px)}.chatBubble{width:max-content;max-width:100%;padding:11px 13px;overflow-wrap:anywhere}.chatCompose{padding:14px;border-top:1px solid var(--gs-border);width:100%;display:grid;grid-template-columns:minmax(0,1fr)}.chatInputRow{display:flex;width:100%}.chatInputRow textarea{flex:1;min-width:0;min-height:58px}.chatComposeActions{display:flex;justify-content:flex-end;gap:8px;width:100%}.chatSendButton{flex:none;margin-left:auto;min-width:42px;min-height:42px}';
const fixtureCss='.chatChannelMenu.chatMenuExpandedOnly{display:none}.simChat.gsChatV2.chatExpanded .chatChannelMenu.chatMenuExpandedOnly{display:grid}';
const markup=['<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>',baseline,css,fixtureCss,'</style></head><body>',
'<aside class="simChat gsChatV2" id="chat"><header class="chatTop"><button type="button" class="chatHeadIcon chatExpandTrigger" id="expand" aria-label="Развернуть чат"></button><span class="chatHeadIcon chatPhoneHeadIcon" id="phoneIcon" aria-hidden="true"></span>',
'<div class="chatHeadText chatChannelPicker chatChannelSidebar" id="channels"><span class="chatEyebrow">Общение</span><b class="chatSidebarHeading">Беседы</b><button class="chatChannelTrigger">Публичная политика</button><div class="chatChannelMenu chatMenuExpandedOnly" id="menu" role="menu"><div class="chatChannelOptionRow"><button>Публичная политика</button></div><div class="chatChannelOptionRow"><button>Вне игры</button></div></div></div>',
'<div class="chatExpandedTitle" id="title"><b>Публичная политика</b><small>Общение</small></div><button aria-label="Закрыть чат">×</button></header>',
'<div class="chatMessages" id="messages"><div class="chatMsg theirs"><div class="chatMessageColumn" id="receivedColumn"><div class="chatBubble" id="longBubble">Длинное сообщение с несколькими абзацами о рассмотрении государственной инициативы, обсуждении предложений участников и оценке документально подтверждённых решений. Государственные органы обсуждают перспективы развития, порядок представления материалов и последствия принятых решений для дальнейшей политической работы. Позиции сторон остаются различными, а опубликованная информация должна быть понятной всем участникам общественной дискуссии без изменения утверждённой процедуры принятия решений и полномочий органов Республики.</div></div></div><div class="chatMsg mine"><div class="chatMessageColumn"><div class="chatBubble">Сообщение для проверки удобной ширины</div></div></div></div>',
'<div class="chatCompose chatComposeCompact" id="compose"><button class="chatResizeGrip" id="resizeGrip" aria-label="Изменить высоту поля сообщения"><span></span></button><details class="chatProcessTags" id="tags"><summary>Сообщение для политического процесса</summary><small>Выберите тег</small><div><button>#вопрос</button></div></details><div class="chatInputRow" id="inputRow"><textarea aria-label="Сообщение"></textarea></div><div class="chatComposeActions" id="actions"><button>Файл</button><button>Микрофон</button><button>Камера</button><button class="chatIconButton chatProcessTagMobileButton" id="tagButton">#</button><button class="chatSendButton iconOnly" id="send">Отправить</button></div></div></aside>',
'<script>document.getElementById("expand").onclick=()=>document.getElementById("chat").classList.toggle("chatExpanded");'+
'const handle=document.getElementById("resizeGrip"),field=document.querySelector("#inputRow textarea");let start=null;'+
'handle.onpointerdown=e=>{start={y:e.clientY,height:field.getBoundingClientRect().height};handle.setPointerCapture(e.pointerId);e.preventDefault()};'+
'handle.onpointermove=e=>{if(!start)return;const chatHeight=document.getElementById("chat").clientHeight;const cap=Math.max(44,Math.min(520,Math.floor(innerHeight*.6),Math.floor(chatHeight*.58),chatHeight-210));field.style.height=Math.max(44,Math.min(cap,start.height+start.y-e.clientY))+"px"};'+
'handle.onpointerup=e=>{start=null;if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId)};'+
'</script></body></html>'].join('');
async function metrics(page){return page.evaluate(()=>{
 const ids=['chat','channels','menu','messages','compose','title','expand','phoneIcon','tagButton','tags','inputRow','actions','send','receivedColumn','longBubble'];
 const r=Object.fromEntries(ids.map(id=>{const e=document.getElementById(id),b=e.getBoundingClientRect();return [id,{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height,display:getComputedStyle(e).display}]}));
 return {r,overflow:document.documentElement.scrollWidth>innerWidth+1};
})}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [1440,900,820,760,390]){
  const page=await browser.newPage({viewport:{width,height:850}});
  await page.setContent(markup);
  const before=await metrics(page);
  if(width>760)await page.click('#expand');
  const after=await metrics(page),r=after.r;
  assert(!after.overflow,'No horizontal overflow at '+width);
  assert(r.chat.left>=-1&&r.chat.right<=width+1,'Window fits width '+width);
  assert(r.chat.top>=-1&&r.chat.bottom<=851,'Window fits height '+width);
  assert(r.messages.height>70,'Message area usable at '+width);
  assert(r.compose.top>=r.messages.bottom-2&&r.compose.bottom<=r.chat.bottom+1,'Composer aligned at '+width);
  if(width>760){
   assert(r.menu.display!=='none','Sidebar visible at '+width);
   if(width>=1440){
    assert(r.receivedColumn.width>790,'Long messages can use more than the former 790px cap at '+width);
    assert(r.longBubble.width>790,'Text bubble grows with its message column at '+width);
    assert(r.longBubble.right<=r.messages.right,'Text stays within message pane at '+width);
   }
   assert(Math.abs(r.compose.left-r.channels.right)<3,'Composer aligns with right-column left edge at '+width);
   assert(r.compose.right<=r.chat.right+1,'Composer stays inside the expanded window at '+width);
   assert(Math.abs(r.inputRow.left-r.compose.left)<26,'Input starts at the left edge of the composer at '+width);
   assert(Math.abs(r.actions.left-r.inputRow.left)<2,'Action buttons align with the input at '+width);
   assert(r.send.right<=r.chat.right-8,'Send button must remain visible at the far right at '+width);
   assert(r.messages.left>=r.channels.right-2,'Messages start after sidebar at '+width);
   assert(r.title.display!=='none','Header label visible at '+width);
   assert(r.expand.display!=='none','Desktop retains approved expansion action at '+width);
   assert(r.phoneIcon.display==='none','Phone-only icon hidden on desktop at '+width);
   assert(r.tagButton.display!=='none','Desktop tag button visible alongside media actions at '+width);
   assert(r.tags.display==='none','Desktop process tags are hidden until requested at '+width);
   await page.evaluate(()=>{document.getElementById('tags').open=true});
   const withTags=await metrics(page);
   assert(withTags.r.tags.display!=='none','Desktop process tags open with # at '+width);
   assert(withTags.r.tags.bottom<=withTags.r.compose.top+1,'Tag popup stays above composer at '+width);
   await page.evaluate(()=>{document.getElementById('tags').open=false});
  }else{
   assert(r.menu.display==='none','Mobile dropdown closed at '+width);
   assert(Math.abs(r.messages.left-r.chat.left)<=2,'Mobile messages full width at '+width);
   assert(r.expand.display==='none','No chat expansion button on phone at '+width);
   assert(r.phoneIcon.display!=='none','Original decorative chat icon remains at '+width);
   assert(r.tagButton.display!=='none','Original phone # action still visible beside media controls at '+width);
   assert(Math.abs(r.compose.bottom-r.chat.bottom)<3,'No blank bottom band under mobile composer at '+width);
   await page.evaluate(()=>{document.getElementById('tags').open=true});
   const tagDisplay=await page.evaluate(()=>getComputedStyle(document.getElementById('tags')).display);
   assert(tagDisplay!=='none','Existing process tags remain available via # at '+width);
  }
  // Pull the upper border up: message history and sending controls stay visible.
  const field=page.locator('#inputRow textarea');
  const originalHeight=await field.evaluate(el=>el.getBoundingClientRect().height);
  const grip=await page.locator('#resizeGrip').boundingBox();
  assert(grip,'Resize grip visible at '+width);
  const gx=grip.x+grip.width/2,gy=grip.y+grip.height/2;
  await page.mouse.move(gx,gy);await page.mouse.down();
  await page.mouse.move(gx,gy-120,{steps:6});await page.mouse.up();
  const grown=await field.evaluate(el=>el.getBoundingClientRect().height);
  const resized=await metrics(page);
  assert(grown>originalHeight+40,'Dragging upward expands the field at '+width+': '+originalHeight+' -> '+grown);
  assert(resized.r.messages.height>30,'Messages stay visible at '+width);
  assert(resized.r.actions.top>=resized.r.inputRow.bottom-1,'Toolbar remains below input at '+width);
  assert(resized.r.actions.bottom<=resized.r.chat.bottom+1,'Send button remains on screen at '+width);
  if(width>760){
   await page.click('#expand');
   const restored=await metrics(page);
   assert(Math.abs(restored.r.chat.width-before.r.chat.width)<2,'Compact width restored at '+width);
  }
  console.log('PASS chat '+width+'px: desktop expansion or phone compact actions and no bottom gap');
  await page.close();
 }
 // Regression: on phones ChatPanel is portaled to body. The legacy sticky
 // application header has z-index:89 and used to cover the channel picker
 // because mobile-nav-polish set the chat to z-index:85.
 for(const width of [320,390,430,760]){
  const page=await browser.newPage({viewport:{width,height:780},isMobile:true,hasTouch:true});
  const phoneFixture='<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
   'body{margin:0}.simWorkspace.chatOpen .simTop{position:sticky;top:0;z-index:89;height:70px;background:#fff}' +
   '.simChat.gsChatV2 .chatMessages{flex:1;min-height:0}.chatChannelPicker{flex:1;min-width:0}' +
   responsiveSiteCss+css+'</style></head><body>'+
   '<div class="simWorkspace chatOpen"><div id="siteHeader" class="simTop">ГОС.ID — навигация</div></div>'+
   '<aside id="game-chat" class="simChat gsChatV2"><header class="chatTop" id="chatHeader">'+
   '<span class="chatHeadIcon chatPhoneHeadIcon">☰</span><div class="chatHeadText chatChannelPicker">'+
   '<span class="chatEyebrow">Общение</span><button class="chatChannelTrigger" id="chooseChannel" type="button">Вне игры</button></div>'+
   '<button id="searchChat" class="chatIconButton" type="button">Поиск</button><button id="closeChat" type="button">×</button></header>'+
   '<div class="chatPinnedWrap" id="chatPins">Закреплено</div><div class="chatMessages" id="chatMessages">Сообщения</div>'+
   '<div class="chatCompose chatComposeCompact" id="chatCompose"><div class="chatInputRow"><textarea></textarea></div></div></aside>'+
   '<script>window.selectedChannel=false;window.closedChat=false;document.getElementById("chooseChannel").onclick=()=>window.selectedChannel=true;document.getElementById("closeChat").onclick=()=>window.closedChat=true;</script>'+
   '</body></html>';
  await page.setContent(phoneFixture);
  // Wait for the existing 230ms mobileChatReveal animation before reading
  // visual geometry; an opening panel intentionally starts offscreen.
  await page.locator('#game-chat').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished))});
  const geometry=await page.evaluate(()=>{
   const panel=document.getElementById('game-chat'),head=document.getElementById('chatHeader'),pins=document.getElementById('chatPins');
   const site=document.getElementById('siteHeader'),button=document.getElementById('chooseChannel');
   const bounds=head.getBoundingClientRect(),b=button.getBoundingClientRect(),pinBounds=pins.getBoundingClientRect();
   const target=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
   return {headerTop:bounds.top,headerHeight:bounds.height,pinsTop:pinBounds.top,headerBottom:bounds.bottom,
    chatZ:Number(getComputedStyle(panel).zIndex),siteZ:Number(getComputedStyle(site).zIndex),
    pickerVisible:target===button||button.contains(target),panelBottom:panel.getBoundingClientRect().bottom,viewport:innerHeight};
  });
  assert(geometry.headerTop>=-1&&geometry.headerTop<3&&geometry.headerHeight>=54,'Channel header must fill top of phone '+width+': '+JSON.stringify(geometry));
  assert(geometry.chatZ>geometry.siteZ&&geometry.pickerVisible,'Chat header must appear above sticky game toolbar at '+width+': '+JSON.stringify(geometry));
  assert(geometry.pinsTop>=geometry.headerBottom-2,'Pinned messages stay below channel header at '+width);
  assert(Math.abs(geometry.panelBottom-geometry.viewport)<3,'Phone chat still fills screen at '+width);
  await page.locator('#chooseChannel').click({timeout:2500});
  assert(await page.evaluate(()=>window.selectedChannel),'Channel switcher is operable at '+width);
  await page.locator('#closeChat').click({timeout:2500});
  assert(await page.evaluate(()=>window.closedChat),'Chat close control is operable at '+width);
  console.log('PASS portaled phone header '+width+'px: above game header; channel and close controls clickable');
  await page.close();
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
