/* Targeted iPhone chat regression: no Supabase, no new network requests.
 * Real iOS Safari interaction still requires hardware verification. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const panel=fs.readFileSync('components/game/ChatPanel.tsx','utf8');
const css=fs.readFileSync('app/profile-chat-responsive.css','utf8');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const transport=fs.readFileSync('components/game/chatMediaTransport.ts','utf8');
assert(panel.includes('enterKeyHint="enter"'),'Mobile keyboard must offer a newline');
assert(panel.includes("(e.ctrlKey||e.metaKey)"),'Ctrl/Cmd+Enter optionally sends');
assert(!panel.includes("e.key==='Enter'&&!e.shiftKey"),'Plain Enter must not send');
assert(panel.includes('stageAttachment(file)'),'File selection must only stage, not send');
assert(panel.includes('chatPendingAttachment')&&panel.includes('setPendingFile(null)'),'File preview can be removed');
assert(panel.includes('(!text.trim()&&!attachment)'),'A file may be sent without a caption');
assert(panel.includes('sendChatFile(attachment.file,sentText)'),'One file and caption send');
assert(panel.includes('setPendingFile(current=>current?.file===attachment.file?null:current)'),'Keep staged file on failure');
assert(panel.includes("decodeChatAttachmentText(m.text||'').caption"),'Caption displays with the media');
assert(hook.includes('caption,gameId,channelId:targetChannel'),'Keep original media upload and authorization path');
assert(transport.includes('encodeChatAttachmentText(fileName,input.caption)'),'File and caption use one message row');
assert(panel.includes('useLayoutEffect(sizeComposer,[text,readyFile])'),'Long input resized before paint');
assert(panel.includes("const priority='important'"),'Viewport positioning overrides legacy mobile !important CSS');
assert(css.includes('font-size:16px!important'),'iOS should not zoom for a 13px field');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chromium is required');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,390,430]){
   const page=await browser.newPage({viewport:{width,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:2});
   // Reproduce the older 13px cascade, then load the actual final chat CSS.
   const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<style>.gsChatV2 .chatComposeCompact .chatInputRow textarea{font-size:13px}</style><style>'+css+'</style></head><body>'+
    '<section class="simChat gsChatV2" style="position:fixed;top:0;left:0;width:100%;height:390px;display:flex;flex-direction:column">'+
    '<div class="chatMessages" style="flex:1;min-height:0;overflow:auto"></div>'+
    '<div class="chatCompose chatComposeCompact" style="flex:0 0 auto">'+
    '<div class="chatPendingAttachment"><span>документ.pdf</span><button>×</button></div>'+
    '<div class="chatInputRow"><textarea aria-label="Ваше сообщение" rows="1"></textarea></div>'+
    '<div class="chatComposeActions" style="display:flex"><button>Файл</button><button>Аудио</button><button>Видео</button><button>Отправить</button></div></div></section></body></html>';
   await page.setContent(html);
   const t=page.locator('textarea');await t.fill('Первый абзац\n'+('Длинное сообщение '.repeat(24))+'\nПоправка в начале');
   const m=await page.evaluate(()=>{
    const input=document.querySelector('textarea'),actions=document.querySelector('.chatComposeActions'),compose=document.querySelector('.chatCompose');
    input.style.height='44px';input.style.height=Math.min(136,Math.max(44,input.scrollHeight))+'px';
    const a=input.getBoundingClientRect(),b=actions.getBoundingClientRect(),c=compose.getBoundingClientRect();
    return{font:getComputedStyle(input).fontSize,inside:a.right<=innerWidth+1,after:b.top>=a.bottom-1,within:b.bottom<=c.bottom+1};
   });
   assert.equal(m.font,'16px','iOS zoom guard at '+width);
   assert(m.inside&&m.after&&m.within,'Buttons must remain below the multiline input at '+width+': '+JSON.stringify(m));
   console.log('PASS iPhone-like '+width+'px: multiline editing, 16px input and toolbar below input');
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
