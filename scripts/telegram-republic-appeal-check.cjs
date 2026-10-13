const assert=require('node:assert/strict');
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const path='lib/server/telegramRepublicText.ts';
const mod=new Module(path,module);mod.filename=path;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,path);
const {resolveAppealRecipient,appealRecipientError,telegramRepublicName,telegramSentence}=mod.exports;
const people=[
 {user_id:'11111111-2222-3333-4444-555555555555',full_name:'Казанцев Дмитрий Анатольевич'},
 {user_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',full_name:'Иванова Мария'},
 {user_id:'abcdefab-eeee-cccc-bbbb-999999999999',full_name:'Иванова Наталья'},
 {user_id:'cccccccc-3333-2222-1111-000000000000',full_name:'Петров Олег'}
];
const me=people[0].user_id;
let result=resolveAppealRecipient(people,me,'Казанцев');
assert.equal(result.kind,'self');
assert.ok(appealRecipientError(result).includes('самому себе'));
assert.ok(!appealRecipientError(result).includes('однозначно определить'));
result=resolveAppealRecipient(people,me,'Петров');
assert.equal(result.kind,'found');
assert.equal(result.recipient.user_id,people[3].user_id);
result=resolveAppealRecipient(people,me,'Иванова');
assert.equal(result.kind,'ambiguous');
assert.equal(result.hints.length,2);
assert.ok(result.hints.every(x=>/^@иванова_[a-f0-9]{8}$/.test(x)));
assert.ok(appealRecipientError(result).includes('несколько адресатов'));
result=resolveAppealRecipient(people,me,'Иванова_aaaaaaaa');
assert.equal(result.kind,'found');
assert.equal(result.recipient.user_id,people[1].user_id);
result=resolveAppealRecipient(people,me,'Несуществующий');
assert.equal(result.kind,'missing');
assert.ok(appealRecipientError(result).includes('не найден'));
assert.equal(telegramRepublicName('ПАУ'),'ГОС.ID');
assert.equal(telegramRepublicName('  пау  '),'ГОС.ID');
assert.equal(telegramRepublicName('Республика'),'ГОС.ID');
assert.equal(telegramRepublicName(null),'ГОС.ID');
assert.equal(telegramRepublicName('Моя игра'),'Моя игра');
assert.equal(telegramRepublicName('Россия'),'Россия');
assert.equal(telegramSentence('Создание партий'),'Создание партий.');
assert.equal(telegramSentence('Ход закрыт.'),'Ход закрыт.');
assert.equal(telegramSentence('Голосование завершено!'),'Голосование завершено!');
const hook=fs.readFileSync('app/api/telegram/webhook/route.ts','utf8');
const cabinet=fs.readFileSync('lib/server/telegramCabinet.ts','utf8');
const presentation=fs.readFileSync('lib/server/telegramPresentation.ts','utf8');
const begin=hook.indexOf("if(command==='/status')"),end=hook.indexOf("if(command==='/stages')",begin);
assert.ok(begin>=0&&end>begin);
const status=hook.slice(begin,end);
assert.ok(!status.includes("select('title,current_round,turn_open')"),'Legacy game title must not be printed in status');
assert.ok(status.includes("telegramSentence(stage?.title"),'Stage name ends with punctuation');
assert.ok(!hook.includes('Нет подключённых республик.'),'No outdated games placeholder');
assert.ok(hook.includes("'🏛 Игра: '+telegramRepublicName(g.title)"),'Game list formats live names');
assert.ok(status.includes('Ход закрыт.'),'Closed turn sentence ends with period');
const workflow=fs.readFileSync('lib/server/telegramAppealWorkflow.ts','utf8');
assert.ok(workflow.includes('resolveAppealRecipient(people,userId,match[1])'));
assert.ok(workflow.includes("result.kind!=='found'"),'Invalid recipients cannot create a preview');
assert.ok(workflow.includes('telegram_confirm_appeal_draft'),'Explicit confirmation replaces immediate delivery');
assert.ok(cabinet.includes('telegramRepublicName(user.group_name)'),'Office hides obsolete group name');
assert.equal((presentation.match(/'\/games — /g)||[]).length,1);
assert.equal((presentation.match(/'\/channels — /g)||[]).length,1);
console.log('PASS Telegram recipient resolution: own address, unique, ambiguous, missing; brand and sentence punctuation.');
