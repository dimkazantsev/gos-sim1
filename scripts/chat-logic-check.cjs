/* Regression tests for pure chat grouping and filtering. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const file='components/game/chatUtils.ts';
const mod=new Module(file,module);
mod.filename=file;
mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const {buildChatEntries,chatDayLabel,matchChatMessage,formatChatTime}=mod.exports;
const make=(id,author,created_at,kind='text',text='Пример сообщения')=>({
 id,game_id:'g',channel_id:'c',author_id:author,created_at,kind,text,mime_type:null
});
const now=new Date('2026-09-29T12:00:00Z');
const messages=[
 make('1','alice','2026-09-27T09:00:00Z'),
 make('2','alice','2026-09-27T09:01:00Z'),
 make('3','alice','2026-09-27T09:10:00Z'),
 make('4','bob','2026-09-27T09:12:00Z'),
 make('5','bob','2026-09-28T09:15:00Z'),
 make('6','alice','2026-09-28T09:19:00Z'),
];
const entries=buildChatEntries(messages,'alice',now);
assert.deepEqual(entries.map(x=>x.startsGroup),[true,false,true,true,true,true]);
assert.deepEqual(entries.map(x=>x.startsDay),[true,false,false,false,true,false]);
assert.deepEqual(entries.map(x=>x.own),[true,true,true,false,false,true]);
assert.equal(entries[4].dayLabel,'Вчера');
assert.equal(chatDayLabel('2026-09-29T09:00:00Z',now),'Сегодня');
console.log('PASS grouping by author, six-minute gaps, real dates and own messages');
const document={...make('f','alice','2026-09-29T09:00:00Z','file','Проект постановления.pdf'),mime_type:'application/pdf'};
assert(matchChatMessage(document,'ПОСТАНОВЛЕНИЯ','Анна'));
assert(matchChatMessage(document,'АННА','Анна'));
assert(matchChatMessage(document,'', 'Анна',true));
assert(!matchChatMessage(messages[0],'','Анна',true));
assert(!matchChatMessage(document,'приказ','Анна'));
console.log('PASS case-insensitive message, author and attachment search');
assert.equal(formatChatTime('not-a-date'),'');
assert.equal(chatDayLabel('bad',now),'Без даты');
const notGrouped=buildChatEntries([make('a','alice','2026-09-29T09:10:00Z'),make('b','alice','2026-09-29T09:08:00Z')],'alice',now);
assert.equal(notGrouped[1].startsGroup,true);
console.log('PASS invalid dates and nonmonotonic event order are handled');
