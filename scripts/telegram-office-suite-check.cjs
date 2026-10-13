/* Personal Telegram office contract regression: secrets, RLS, scope and behaviour. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const Module=require('node:module');
const read=p=>fs.readFileSync(p,'utf8');
function compile(path,mocks={}){
 const m=new Module(path,module);m.filename=path;m.paths=module.paths;
 const native=m.require.bind(m);m.require=k=>Object.hasOwn(mocks,k)?mocks[k]:native(k);
 m._compile(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,path);
 return m.exports;
}
const p=compile('lib/server/telegramPresentation.ts');
for(const cmd of ['office','brief','inbox','deadlines','agenda','alerts','law','news','reception','economy','career','blitz','settings']){
 assert.ok(p.TELEGRAM_COMMANDS.some(x=>x.command===cmd),'Missing /'+cmd);
 assert.equal(p.telegramCallbackCommand('gos:'+cmd),'/'+cmd,'Missing allowed callback '+cmd);
 assert.ok(p.TELEGRAM_MENU_BUTTONS.inline_keyboard.some(row=>row.some(b=>b.callback_data==='gos:'+cmd)),'Missing menu '+cmd);
}
assert.equal(p.telegramCallbackCommand('gos:admin'),undefined,'Untrusted callbacks forbidden');
assert.equal(p.telegramCallbackCommand('__proto__'),undefined);
assert.ok(!p.TELEGRAM_COMMANDS.some(x=>x.command==='miniapp'));
assert.ok(p.TELEGRAM_MENU_BUTTONS.inline_keyboard.length<=18,'Keep menu compact');
const bot=read('lib/server/telegramOffice.ts');
assert.ok(bot.includes("import type {runtimeConfig}"));
assert.ok(bot.includes('gameId:string;userId:string;chatId:number;telegramId:number;messageId:number'));
assert.ok(bot.includes("if(memberError||!me)"),'Office requires active membership');
assert.ok(!/\.select\([^)]*(correct_index|explanation|options|question)[^)]*\)/.test(bot),'Never query solutions');
assert.ok(bot.includes("eq('verified',true)")&&bot.includes("select('legal_act,article,source_url')"));
for(const key of ["recipient_id',userId","game_id',gameId","roster_archived_at',null","status','published","telegram_chat_id:chatId","telegram_message_id:messageId"])
 assert.ok(bot.includes(key),'Missing scope/audit '+key);
assert.ok(bot.includes("error.code!=='23505'"),'Duplicate Telegram updates must be idempotent');
assert.ok(bot.includes("['Asia/Barnaul','Asia/Novosibirsk','Europe/Moscow','UTC']"),'Timezone must be allowlisted');
const web=read('app/api/telegram/webhook/route.ts');
const officeIndex=web.indexOf('telegramOfficeCommand({');
const linkIndex=web.indexOf("const {data:links,error:linksError}");
assert.ok(officeIndex>linkIndex&&linkIndex>0,'Office must only run after verified bot membership');
assert.ok(web.includes("x-telegram-bot-api-secret-token"));
const schema=read('supabase/migrations/20261013120000_telegram_personal_office.sql');
for(const required of [
 'create table if not exists public.telegram_bot_preferences',
 'create table if not exists public.telegram_reception_requests',
 'enable row level security',
 "revoke insert,update,delete",
 'telegram_reception_participant_read',
 'gos_reception_telegram_notify',
 'unique(game_id,sender_id,telegram_chat_id,telegram_message_id)',
 'on conflict do nothing'
])assert.ok(schema.includes(required),'Migration required: '+required);
const d=read('app/api/telegram/daily-brief/route.ts');
assert.ok(d.includes('CRON_SECRET'),'Digest must require server authorization');
assert.ok(d.includes('notifications_enabled'));
assert.ok(d.includes("category:'digest_'+day"),'Daily idempotency by date');
assert.ok(d.includes("category:'task_reminder_'+day"),'One deadline reminder per day');
assert.ok(d.includes('pref?.daily_digest===false'),'Preferences must control digests');
const dispatch=read('app/api/telegram/dispatch/route.ts');
for(const req of ['notify_tasks','notify_messages','notify_documents','notify_events','quiet_start','next_attempt_at','Disabled in personal settings'])
 assert.ok(dispatch.includes(req),'Dispatch must enforce '+req);
const cron=JSON.parse(read('vercel.json')).crons;
assert.ok(cron.some(x=>x.path==='/api/telegram/daily-brief'&&x.schedule==='0 0 * * *'));
assert.ok(cron.some(x=>x.path==='/api/telegram/dispatch'&&x.schedule==='0 1 * * *'));
const entries=[];
const records={
 game_members:{kind:'member',full_name:'Иванов Иван',role_title:'Министр',group_name:'1',score:4},
 games:{title:'Республика',current_round:1,turn_open:true},
 game_assigned_tasks:{count:2,data:[]},
 telegram_bot_preferences:null
};
function query(table){
 const filters=[];
 let head=false;
 const q={
  select:(columns,opts)=>{entries.push({table,columns});head=opts?.head||false;return q},
  eq:(k,v)=>{filters.push([k,v]);return q},
  neq:()=>q,is:()=>q,in:()=>q,not:()=>q,
  or:()=>q,
  order:()=>q,limit:()=>q,
  maybeSingle:async()=>({data:records[table]||null,error:null}),
  single:async()=>({data:records[table]||null,error:null}),
  then:(resolve,reject)=>Promise.resolve({data:head?null:records[table]?.data||[],count:records[table]?.count||0,error:null}).then(resolve,reject)
 };
 return q;
}
const {telegramOfficeCommand}=compile('lib/server/telegramOffice.ts',{
 './telegramPresentation':p
});
async function run(){
 const ctx={db:{from:query},gameId:'game-id',userId:'user-id',chatId:123,telegramId:42,messageId:53,text:'/career',command:'/career'};
 const career=await telegramOfficeCommand(ctx);
 assert.ok(career.text.includes('Иванов Иван')&&career.text.includes('Министр'));
 assert.ok(career.text.includes('Баллы: 4'));
 const law=await telegramOfficeCommand({...ctx,text:'/law',command:'/law'});
 assert.ok(law.text.includes('Правовой справочник'));
 const attempt=await telegramOfficeCommand({...ctx,command:'/appeal',text:'/appeal something invalid'});
 assert.ok(attempt.text.includes('Формат обращения'));
 const setting=await telegramOfficeCommand({...ctx,command:'/settings',text:'/settings'});
 assert.ok(setting.text.includes('Утренний доклад'));
 const invalid=await telegramOfficeCommand({...ctx,command:'/settings',text:'/settings timezone Bad/Region'});
 assert.ok(invalid.text.includes('Допустимые пояса'));
 const answer=await telegramOfficeCommand({...ctx,command:'/not-real',text:'/not-real'});
 assert.equal(answer,undefined);
 assert.ok(entries.some(x=>x.table==='blitz_questions'&&x.columns==='legal_act,article,source_url'));
 console.log('PASS Telegram 14-section office, safe legal lookup, RLS migration, digest/quiet and command routing');
}
run().catch(e=>{console.error(e);process.exitCode=1});
