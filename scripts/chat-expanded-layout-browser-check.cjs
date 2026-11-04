'use strict';
/* Focused CSS/browser test: no Supabase connection, no extra requests. */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const panel=fs.readFileSync('components/game/ChatPanel.tsx','utf8');
const picker=fs.readFileSync('components/game/ChatChannelDropdown.tsx','utf8');
const css=fs.readFileSync('app/profile-chat-responsive.css','utf8');
assert(panel.includes('className="chatHeadIcon chatExpandTrigger"')&&panel.includes('onClick={()=>setExpanded(value=>!value)}'),'The message icon must expand chat');
assert(panel.includes('createPortal(chatView,document.body)'),'Expanded chat must escape the page stacking context');
assert(panel.includes('expanded={expanded}'));
assert(panel.includes('useDialog(overlay||expanded'));
assert(picker.includes('const showOptions=expanded||open'));
assert(!picker.includes('onExpand')&&picker.includes('if(open){setOpen(false);return}'),'Channel picker must not expand the chat');
assert(picker.includes('visibleChatChannels(channels,safeOverview)'));
assert(!css.includes('@import'),'No additional network assets');
assert(css.includes('width:min(calc(100% - 70px),1060px)'),'Expanded long message width grows without unbounded lines');
assert(panel.includes('expanded&&<button type="button" className="chatIconButton"'),'Collapse action reuses existing icon style');
assert(panel.includes("viewport.height-headerHeight")&&!panel.includes("dockHeight"),'Phone chat must not reserve hidden application dock space');
assert(panel.includes('chatPhoneHeadIcon')&&css.includes('.chatTop .chatExpandTrigger,')&&css.includes('display:none!important'),'Phone must not show the expand control');
assert(panel.includes('chatProcessTagMobileButton')&&panel.includes('open={processTagsOpen}'),'Phone # action uses existing process tags');
assert(css.includes('.chatRetentionNotice {display:none}'),'Phone media-retention banner is hidden without changing retention');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
if(!chrome)throw Error('Chrome is required');
const baseline='*{box-sizing:border-box}:root{--gs-ink:#173455;--gs-muted:#728199;--gs-border:#dce5f2;--gs-accent:#2453e6;--gs-surface-soft:#f6f8fd;--gs-shadow-lg:0 8px 25px #17244722}body{margin:0}.simChat{position:fixed;top:78px;right:16px;bottom:16px;width:430px;display:flex;flex-direction:column;background:white;border:1px solid var(--gs-border);border-radius:20px;overflow:hidden}.chatTop{position:relative;min-height:78px;display:flex;align-items:center;gap:12px;padding:17px 18px;border-bottom:1px solid var(--gs-border)}.chatHeadIcon{flex:none;width:40px;height:40px}.chatChannelPicker{position:static;flex:1;min-width:0}.chatChannelTrigger{display:flex;min-height:44px}.chatChannelMenu{position:absolute;top:100%;left:12px;right:12px;max-height:340px;background:white}.chatChannelOptionRow{display:grid;min-height:60px}.chatMessages{display:flex;flex:1;min-height:0;flex-direction:column;width:100%;padding:12px 14px;background:#f6f8fd;overflow:auto}.chatMsg{display:flex;min-width:0;width:100%}.chatMsg.mine{justify-content:flex-end}.chatMessageColumn{max-width:calc(100% - 70px)}.chatBubble{width:max-content;max-width:100%;padding:11px 13px;overflow-wrap:anywhere}.chatCompose{padding:14px;border-top:1px solid var(--gs-border);width:100%;display:grid;grid-template-columns:minmax(0,1fr)}.chatInputRow{display:flex;width:100%}.chatInputRow textarea{flex:1;min-width:0;min-height:58px}.chatComposeActions{display:flex;justify-content:flex-end;gap:8px;width:100%}.chatSendButton{flex:none;margin-left:auto;min-width:42px;min-height:42px}';
const fixtureCss='.chatChannelMenu.chatMenuExpandedOnly{display:none}.simChat.gsChatV2.chatExpanded .chatChannelMenu.chatMenuExpandedOnly{display:grid}';
const markup=['<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>',baseline,css,fixtureCss,'</style></head><body>',
'<aside class="simChat gsChatV2" id="chat"><header class="chatTop"><button type="button" class="chatHeadIcon chatExpandTrigger" id="expand" aria-label="Развернуть чат"></button><span class="chatHeadIcon chatPhoneHeadIcon" id="phoneIcon" aria-hidden="true"></span>',
'<div class="chatHeadText chatChannelPicker chatChannelSidebar" id="channels"><span class="chatEyebrow">Общение</span><b class="chatSidebarHeading">Беседы</b><button class="chatChannelTrigger">Публичная политика</button><div class="chatChannelMenu chatMenuExpandedOnly" id="menu" role="menu"><div class="chatChannelOptionRow"><button>Публичная политика</button></div><div class="chatChannelOptionRow"><button>Вне игры</button></div></div></div>',
'<div class="chatExpandedTitle" id="title"><b>Публичная политика</b><small>Общение</small></div><button aria-label="Закрыть чат">×</button></header>',
'<div class="chatMessages" id="messages"><div class="chatMsg theirs"><div class="chatMessageColumn" id="receivedColumn"><div class="chatBubble" id="longBubble">Длинное сообщение с несколькими абзацами о рассмотрении государственной инициативы, обсуждении предложений участников и оценке документально подтверждённых решений. Государственные органы обсуждают перспективы развития, порядок представления материалов и последствия принятых решений для дальнейшей политической работы. Позиции сторон остаются различными, а опубликованная информация должна быть понятной всем участникам общественной дискуссии без изменения утверждённой процедуры принятия решений и полномочий органов Республики.</div></div></div><div class="chatMsg mine"><div class="chatMessageColumn"><div class="chatBubble">Сообщение для проверки удобной ширины</div></div></div></div>',
'<div class="chatRetentionNotice" id="retention">Аудио и видео хранятся 1 час</div><div class="chatCompose chatComposeCompact" id="compose"><details class="chatProcessTags" id="tags"><summary>Сообщение для политического процесса</summary><small>Выберите тег</small><div><button>#вопрос</button></div></details><div class="chatInputRow" id="inputRow"><textarea aria-label="Сообщение"></textarea></div><div class="chatComposeActions" id="actions"><button>Файл</button><button>Микрофон</button><button>Камера</button><button class="chatIconButton chatProcessTagMobileButton" id="tagButton">#</button><button class="chatSendButton iconOnly" id="send">Отправить</button></div></div></aside>',
'<script>document.getElementById("expand").onclick=()=>document.getElementById("chat").classList.toggle("chatExpanded");</script></body></html>'].join('');
async function metrics(page){return page.evaluate(()=>{
 const ids=['chat','channels','menu','messages','compose','title','retention','expand','phoneIcon','tagButton','tags','inputRow','actions','send','receivedColumn','longBubble'];
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
   assert(r.retention.display!=='none','Desktop media policy stays visible at '+width);
   assert(r.tagButton.display==='none','Desktop retains original political process tags at '+width);
  }else{
   assert(r.menu.display==='none','Mobile dropdown closed at '+width);
   assert(Math.abs(r.messages.left-r.chat.left)<=2,'Mobile messages full width at '+width);
   assert(r.expand.display==='none','No chat expansion button on phone at '+width);
   assert(r.phoneIcon.display!=='none','Original decorative chat icon remains at '+width);
   assert(r.retention.display==='none','No media retention banner on phone at '+width);
   assert(r.tagButton.display!=='none','Phone # action visible beside media controls at '+width);
   assert(Math.abs(r.compose.bottom-r.chat.bottom)<3,'No blank bottom band under mobile composer at '+width);
   await page.evaluate(()=>{document.getElementById('tags').open=true});
   const tagDisplay=await page.evaluate(()=>getComputedStyle(document.getElementById('tags')).display);
   assert(tagDisplay!=='none','Existing process tags remain available via # at '+width);
  }
  if(width>760){
   await page.click('#expand');
   const restored=await metrics(page);
   assert(Math.abs(restored.r.chat.width-before.r.chat.width)<2,'Compact width restored at '+width);
  }
  console.log('PASS chat '+width+'px: desktop expansion or phone compact actions and no bottom gap');
  await page.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
