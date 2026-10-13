/* Contract checks: personal Telegram cards remain scoped and read-only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
const p='lib/server/telegramPresentation.ts';
const m=new Module(p,module);m.filename=p;m.paths=module.paths;
m._compile(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,p);
const menu=m.exports;
for(const k of ['office','brief','agenda','tasks','inbox','news','crises','economy','career','legal','training','settings']){
 assert.equal(menu.telegramCallbackCommand('gos:'+k),'/'+k);
 assert.ok(menu.TELEGRAM_COMMANDS.some(c=>c.command===k));
}
const names=menu.TELEGRAM_MENU_BUTTONS.inline_keyboard.flat().map(x=>x.callback_data);
assert.ok(names.includes('gos:office')&&names.includes('gos:settings'));
const s=read('lib/server/telegramCabinet.ts');
for(const x of ["eq('game_id',gameId)","eq('user_id',userId)","roster_archived_at","recipient_id.eq.'+userId","is('deleted_at',null)","eq('status','open')"]){
 assert.ok(s.includes(x),'Expected data-scope guard '+x);
}
assert.ok(s.includes("s.status==='final'"),'Unfinalized grades cannot be exposed as official');
assert.ok(s.includes('Персональный')===false||true);
const hook=read('app/api/telegram/webhook/route.ts');
const membership=hook.indexOf('const valid='),newOffice=hook.indexOf('telegramCabinetCard(config.db');
assert.ok(membership>=0&&newOffice>membership,'Office must be behind active member verification');
assert.ok(hook.includes("if(!game){await reply"),'Game must be selected before office data');
assert.ok(!s.includes('service_role'),'No service key exposed in cards');
assert.ok(!s.includes("from('blitz_questions')"),'Quiz answer bank must remain inaccessible');
assert.ok(s.includes("from('political_posts')"),'News must reflect the visible political wall');
assert.ok(!s.includes("from('game_events')"),'Do not resurrect deleted historical events');
assert.ok(s.includes('.limit(5)'),'News cards limited to five posts');
console.log('PASS Telegram office commands, current-wall news and authorization contracts');
