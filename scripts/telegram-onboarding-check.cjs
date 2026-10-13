/* Telegram branding and authorization regressions: pure presentation + mocked Bot API. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
function compile(path,mocks={}){
 const mod=new Module(path,module);mod.filename=path;mod.paths=module.paths;
 const original=mod.require.bind(mod);
 mod.require=id=>Object.prototype.hasOwnProperty.call(mocks,id)?mocks[id]:original(id);
 mod._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText,path);
 return mod.exports;
}
const presentation=compile('lib/server/telegramPresentation.ts');
const service=compile('lib/server/telegram.ts',{
 '@supabase/supabase-js':{createClient:()=>({})},
 './telegramPresentation':presentation
});
const {
 TELEGRAM_PROJECT_URL,TELEGRAM_COMMANDS,TELEGRAM_WELCOME_BUTTONS,TELEGRAM_MENU_BUTTONS,
 TELEGRAM_BACK_BUTTONS,telegramCallbackCommand,telegramMessageHtml,
 telegramWelcomeText,telegramMenuText,telegramHelpText
}=presentation;
assert.equal(TELEGRAM_PROJECT_URL,'https://dimkazantsev.github.io/gos-sim1/');
assert.ok(telegramWelcomeText().includes('Добро пожаловать')&&telegramWelcomeText().includes('Начать'));
assert.ok(telegramWelcomeText(true).includes('подключён'));
assert.ok(telegramMenuText(false).includes('привяжите Telegram'));
assert.ok(telegramHelpText().includes('/chat текст'));
assert.equal(telegramCallbackCommand('gos:begin'),'/menu');
assert.equal(telegramCallbackCommand('gos:status'),'/status');
assert.equal(telegramCallbackCommand('gos:random'),undefined);
assert.equal(telegramCallbackCommand('__proto__'),undefined);
assert.ok(TELEGRAM_MENU_BUTTONS.inline_keyboard.flat().some(b=>b.callback_data==='gos:channels'));
assert.ok(TELEGRAM_WELCOME_BUTTONS.inline_keyboard.flat().some(b=>b.text.includes('Начать')));
assert.ok(TELEGRAM_COMMANDS.some(c=>c.command==='menu'));
assert.ok(TELEGRAM_BACK_BUTTONS.inline_keyboard.flat().some(b=>b.url===TELEGRAM_PROJECT_URL));
const message=telegramMessageHtml('🗳 <Закон> & "сведения"');
assert.ok(message.startsWith('<b>🗳 &lt;Закон&gt; &amp; &quot;сведения&quot;</b>'));
assert.ok(message.endsWith('<a href="'+TELEGRAM_PROJECT_URL+'">ГОС.ID</a>'));
const long=telegramMessageHtml('🔔 '+'&'.repeat(5000));
assert.ok(long.length<4096&&long.endsWith('</a>'),'long messages keep complete HTML and footer');

const webhook=fs.readFileSync('app/api/telegram/webhook/route.ts','utf8');
const register=fs.readFileSync('app/api/telegram/register/route.ts','utf8');
const activation=fs.readFileSync('lib/server/telegramActivation.ts','utf8');
const outbox=fs.readFileSync('app/api/telegram/dispatch/route.ts','utf8');
assert.ok(webhook.includes("x-telegram-bot-api-secret-token"),'webhook secret enforced');
assert.ok(webhook.includes("message.chat.type!=='private'"),'no commands in group chats');
assert.ok(webhook.includes('telegramCallbackCommand('),'callback actions are allowlisted');
assert.ok(webhook.includes("telegram_connect"),'existing deep-link account binding preserved');
assert.ok(webhook.includes("telegram_post_chat"),'existing permission-checked chat publishing preserved');
assert.ok(webhook.includes("telegramAcknowledge("),'callback spinner acknowledged');
assert.ok(webhook.includes("TELEGRAM_WELCOME_BUTTONS"),'first contact has Start button');
assert.ok(webhook.includes("TELEGRAM_MENU_BUTTONS"),'menu is actionable');
assert.ok(register.includes("member?.kind!=='teacher'"),'only teacher registers menu and webhook');
assert.ok(register.includes("process.env.VERCEL_ENV!=='production'"),'preview cannot register bot');
assert.ok(activation.includes("allowed_updates:['message','callback_query']"),'callbacks are actually delivered');

assert.ok(activation.includes("'setMyCommands'")&&activation.includes("'setChatMenuButton'"),'Telegram native menu configured');
assert.ok(activation.includes("'getWebhookInfo'")&&activation.includes("'getMyCommands'")&&activation.includes("'getChatMenuButton'"),'Bot setup is verified with Telegram API');
assert.ok(register.includes('TelegramSetupError'),'Failed activation step is returned explicitly');
assert.ok(outbox.includes("telegramSend(config.token,link.chat_id,job.body,buttons)"),'notifications use same footer helper');

const calls=[];
const oldFetch=global.fetch;
global.fetch=async (url,init)=>{
 const payload=JSON.parse(init.body);
 calls.push({url,payload});
 return{ok:true,json:async()=>({ok:true,result:true})};
};
async function run(){
 try{
  await service.telegramSend('test-token',123,'🔔 <secret> & update');
  const sent=calls.at(-1);
  assert.ok(sent.url.endsWith('/sendMessage'));
  assert.equal(sent.payload.chat_id,123);
  assert.equal(sent.payload.parse_mode,'HTML');
  assert.deepEqual(sent.payload.reply_markup,TELEGRAM_BACK_BUTTONS);
  assert.ok(sent.payload.text.includes('&lt;secret&gt; &amp; update'));
  assert.ok(sent.payload.text.endsWith('<a href="'+TELEGRAM_PROJECT_URL+'">ГОС.ID</a>'));
  await service.telegramSend('test-token',123,telegramWelcomeText(),TELEGRAM_WELCOME_BUTTONS);
  assert.deepEqual(calls.at(-1).payload.reply_markup,TELEGRAM_WELCOME_BUTTONS);
  await service.telegramAcknowledge('test-token','callback-id');
  assert.ok(calls.at(-1).url.endsWith('/answerCallbackQuery'));
  assert.equal(calls.at(-1).payload.callback_query_id,'callback-id');
  assert.ok(!calls.some(c=>JSON.stringify(c.payload).includes('SUPABASE_SECRET')),'no credentials');
  console.log('PASS Telegram Start/menu, permanent commands, linked footer, HTML escaping, long messages and callback API');
 }finally{global.fetch=oldFetch}
}
run().catch(e=>{console.error(e);process.exitCode=1});
