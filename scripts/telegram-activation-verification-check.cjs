const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const p='lib/server/telegramActivation.ts';
const presentSource=fs.readFileSync('lib/server/telegramPresentation.ts','utf8');
const present=new Module('lib/server/telegramPresentation.ts',module);
present.filename='lib/server/telegramPresentation.ts';present.paths=module.paths;
present._compile(ts.transpileModule(presentSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,present.filename);
let fail='',calls=[];
const api={
 telegramApi:async(_token,method)=>{calls.push(method);if(method===fail)throw Error('400: Telegram rejected '+method)},
 telegramApiResult:async(_token,method)=>{
  calls.push(method);
  if(method===fail)throw Error('400: Telegram rejected '+method);
  switch(method){
   case 'getWebhookInfo':return{url:'https://gos-sim1.vercel.app/api/telegram/webhook'};
   case 'getMyCommands':return present.exports.TELEGRAM_COMMANDS;
   case 'getChatMenuButton':return{type:'commands'};
   case 'getMyName':return{name:'ГОС.ID'};
   case 'getMyShortDescription':return{short_description:''};
   case 'getMyDescription':return{description:''};
   default:throw Error('Unexpected '+method)
  }
 },
 telegramSetProfilePhoto:async()=>{throw Error('Photo temporarily unavailable')}
};
const m=new Module(p,module);m.filename=p;m.paths=module.paths;
const requireOriginal=m.require.bind(m);
const errorExports={};
new Function('exports',ts.transpileModule(fs.readFileSync('lib/userError.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(errorExports);
m.require=id=>id==='./telegram'?api:id==='./telegramPresentation'?present.exports:id==='../userError'?errorExports:requireOriginal(id);
m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,p);
(async()=>{
 const good=await m.exports.activateTelegramBot('fake','secret','image');
 assert.equal(good.webhook,true);assert.equal(good.commands,true);assert.equal(good.menu,true);
 assert.equal(good.logo,false);assert.ok(good.warnings.some(w=>w.includes('Эмблема')));
 assert.ok(calls.includes('getWebhookInfo')&&calls.includes('getMyCommands')&&calls.includes('getChatMenuButton'));
 const status=await m.exports.verifyTelegramBot('fake');
 assert.ok(status.webhook&&status.commands&&status.menu);
 calls=[];fail='setWebhook';
 await assert.rejects(()=>m.exports.activateTelegramBot('fake','secret',''),e=>
  e instanceof m.exports.TelegramSetupError&&e.step==='webhook'&&/[А-Яа-яЁё]/.test(e.message)&&!/[A-Za-z]/.test(e.message));
 assert.deepEqual(calls,['setWebhook']);
 const register=fs.readFileSync('app/api/telegram/register/route.ts','utf8');
 assert.ok(register.includes('TelegramSetupError')&&register.includes('stage,reason'));
 const route=fs.readFileSync('app/api/telegram/activate/route.ts','utf8');
 assert.ok(route.includes("member?.kind!=='teacher'")&&route.includes('verifyTelegramBot(config.token)'));
 assert.ok(route.includes("'Access-Control-Allow-Methods':'GET, POST, OPTIONS'"));
 console.log('PASS Telegram: verified registration, separate branding failures, stage diagnostics, teacher-only live status');
})().catch(e=>{console.error(e);process.exitCode=1});
