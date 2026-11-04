'use strict';
/* Focused CSS/browser test: no Supabase connection, no extra requests. */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const panel=fs.readFileSync('components/game/ChatPanel.tsx','utf8');
const picker=fs.readFileSync('components/game/ChatChannelDropdown.tsx','utf8');
const css=fs.readFileSync('app/profile-chat-responsive.css','utf8');
assert(panel.includes('onExpand={()=>setExpanded(true)}'),'The existing channel chevron must expand chat');
assert(panel.includes('expanded={expanded}'));
assert(panel.includes('useDialog(overlay||expanded'));
assert(picker.includes('const showOptions=expanded||open'));
assert(picker.includes("if(!expanded&&onExpand&&window.matchMedia('(min-width:761px)').matches){setOpen(false);onExpand();return}"),'Only desktop chevron expands the chat');
assert(panel.includes('chatProcessTagMobileButton'),'The # button reuses existing tag choices');
assert(panel.includes('ref={processTagsRef}')&&panel.includes('open={processTagsOpen}'),'The # button and existing tags share one panel');
assert(css.includes('.chatRetentionNotice{display:none}')&&css.includes('.chatComposeCompact .chatProcessTags[open]{display:block}'),'Mobile hides retention banner and uses compact tag popover');
assert(picker.includes('visibleChatChannels(channels,safeOverview)'));
assert(!css.includes('@import'),'No additional network assets');
assert(panel.includes('expanded&&<button type="button" className="chatIconButton"'),'Collapse action reuses existing icon style');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
if(!chrome)throw Error('Chrome is required');
const baseline='*{box-sizing:border-box}:root{--gs-ink:#173455;--gs-muted:#728199;--gs-border:#dce5f2;--gs-accent:#2453e6;--gs-surface-soft:#f6f8fd;--gs-shadow-lg:0 8px 25px #17244722}body{margin:0}.simChat{position:fixed;top:78px;right:16px;bottom:16px;width:430px;display:flex;flex-direction:column;background:white;border:1px solid var(--gs-border);border-radius:20px;overflow:hidden}.chatTop{position:relative;min-height:78px;display:flex;align-items:center;gap:12px;padding:17px 18px;border-bottom:1px solid var(--gs-border)}.chatHeadIcon{flex:none;width:40px;height:40px}.chatChannelPicker{position:static;flex:1;min-width:0}.chatChannelTrigger{display:flex;min-height:44px}.chatChannelMenu{position:absolute;top:100%;left:12px;right:12px;max-height:340px;background:white}.chatChannelOptionRow{display:grid;min-height:60px}.chatMessages{display:flex;flex:1;min-height:0;flex-direction:column;width:100%;padding:12px 14px;background:#f6f8fd;overflow:auto}.chatMsg{display:flex;min-width:0;width:100%}.chatMsg.mine{justify-content:flex-end}.chatMessageColumn{max-width:calc(100% - 70px)}.chatBubble{padding:11px 13px}.chatCompose{padding:14px;border-top:1px solid var(--gs-border)}.chatInputRow{display:flex}.chatInputRow textarea{flex:1;min-width:0;min-height:58px}.chatComposeActions{display:flex;justify-content:flex-end;gap:8px}';
const fixtureCss='.chatChannelMenu.chatMenuExpandedOnly{display:none}.simChat.gsChatV2.chatExpanded .chatChannelMenu.chatMenuExpandedOnly{display:grid}.chatComposeActions{min-height:42px}.chatInputRow textarea{min-height:48px}.chatRetentionNotice{padding:10px 16px}.chatProcessTags>summary{display:list-item}.chatProcessTagMobileButton{padding:0}';
const markup=['<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>',baseline,css,fixtureCss,'</style></head><body>',
'<aside class="simChat gsChatV2" id="chat"><header class="chatTop"><span class="chatHeadIcon"></span>',
'<div class="chatHeadText chatChannelPicker chatChannelSidebar" id="channels"><span class="chatEyebrow">Общение</span><b class="chatSidebarHeading">Беседы</b><button class="chatChannelTrigger">Публичная политика</button><div class="chatChannelMenu chatMenuExpandedOnly" id="menu" role="menu"><div class="chatChannelOptionRow"><button>Публичная политика</button></div><div class="chatChannelOptionRow"><button>Вне игры</button></div></div></div>',
'<div class="chatExpandedTitle" id="title"><b>Публичная политика</b><small>Общение</small></div><button class="chatSizeToggle" id="expand">Развернуть</button><button aria-label="Закрыть чат">×</button></header>',
'<div class="chatMessages" id="messages"><div class="chatMsg theirs"><div class="chatMessageColumn"><div class="chatBubble">Краткий текст</div></div></div><div class="chatMsg mine"><div class="chatMessageColumn"><div class="chatBubble">Сообщение для проверки удобной ширины</div></div></div></div>',
'<div class="chatRetentionNotice" id="retention">Аудио и видео хранятся 1 час</div>',
'<div class="chatCompose chatComposeCompact" id="compose"><details class="chatProcessTags" id="tags"><summary>Сообщение для политического процесса</summary><small>Выберите тег</small><div><button>#вопрос</button></div></details><div class="chatInputRow"><textarea aria-label="Сообщение"></textarea></div><div class="chatComposeActions"><button>Файл</button><button>Микрофон</button><button>Камера</button><button class="chatIconButton chatProcessTagMobileButton" id="tagButton">#</button><button>Отправить</button></div></div></aside>',
'<script>document.getElementById("expand").onclick=()=>document.getElementById("chat").classList.toggle("chatExpanded");</script></body></html>'].join('');
async function metrics(page){return page.evaluate(()=>{
 const ids=['chat','channels','menu','messages','compose','title','retention','tagButton','tags'];
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
   assert(r.messages.left>=r.channels.right-2,'Messages start after sidebar at '+width);
   assert(r.title.display!=='none','Header label visible at '+width);
   assert(r.retention.display!=='none','Desktop retention notice remains visible');
   assert(r.tagButton.display==='none','Desktop keeps the existing tag text');
  }else{
   assert(r.menu.display==='none','Mobile dropdown closed at '+width);
   assert(Math.abs(r.messages.left-r.chat.left)<=2,'Mobile messages full width at '+width);
   assert(r.retention.display==='none','Mobile retention notice hidden at '+width);
   assert(r.tagButton.display!=='none','Mobile # tag action visible at '+width);
   assert(Math.abs(r.compose.bottom-r.chat.bottom)<2,'No empty band below mobile composer at '+width);
   await page.evaluate(()=>{document.getElementById('tags').open=true});
   const tagPanel=await page.evaluate(()=>getComputedStyle(document.getElementById('tags')).display);
   assert(tagPanel!=='none','The # action exposes existing process tags at '+width);
  }
  if(width>760){
   await page.click('#expand');
   const restored=await metrics(page);
   assert(Math.abs(restored.r.chat.width-before.r.chat.width)<2,'Compact width restored at '+width);
  }
  console.log('PASS chat expanded '+width+'px: columns, messages, composer and collapse');
  await page.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
