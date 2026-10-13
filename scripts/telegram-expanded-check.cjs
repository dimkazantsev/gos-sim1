/* Focused regression: Telegram, cross-surface mentions, assignments and retention. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function tsModule(path){
 const m=new Module(path,module);m.filename=path;m.paths=module.paths;
 m._compile(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,path);
 return m.exports;
}
const present=tsModule('lib/server/telegramPresentation.ts');
const doc=present.telegramDocumentButtons([{id:'12345678-1234-1234-1234-123456789abc',title:'Федеральный закон'}]);
assert.ok(doc.inline_keyboard[0][0].url.includes('section=documents'));
assert.ok(doc.inline_keyboard[0][0].url.includes('document=12345678'));
assert.ok(present.telegramSectionUrl('profile','tasks').includes('tasks=1'));
assert.ok(present.telegramSectionUrl('dashboard','abc').includes('openChat=1'));
assert.equal(present.telegramCallbackCommand('__proto__'),undefined);
assert.ok(present.telegramMessageHtml('<script>evil</script>').includes('&lt;script&gt;'));
const webhook=read('app/api/telegram/webhook/route.ts');
assert.ok(webhook.includes("🏛 ГОС.ID · Состояние республики"));
assert.ok(webhook.includes("stage?.title"));
assert.ok(webhook.includes("telegramDocumentButtons(data||[])"));
assert.ok(webhook.includes("order('created_at',{ascending:false}).limit(2)"));
assert.ok(!webhook.includes('gameUrl('));
assert.ok(!webhook.includes('gos-sim1.vercel.app/game/'));
const reg=read('app/api/telegram/register/route.ts');
assert.ok(reg.includes("'setMyName',{name:'ГОС.ID',language_code:''}"));
assert.ok(reg.includes("'setMyName',{name:'ГОС.ID',language_code:'ru'}"));
assert.ok(reg.includes('telegramSetProfilePhoto(config.token,avatarJpegBase64'));
assert.ok(reg.includes("member?.kind!=='teacher'"));
const bot=read('lib/server/telegram.ts');
assert.ok(bot.includes("/setMyProfilePhoto"));
assert.ok(bot.includes('1024 × 1024'));
const dispatch=read('app/api/telegram/dispatch/route.ts');
assert.ok(dispatch.includes("job.category==='mention_chat'"));
assert.ok(dispatch.includes("select('document_id').eq('id',job.source_id).eq('recipient_id',job.user_id)"));
assert.ok(dispatch.includes('telegramTaskButtons()'));
assert.ok(dispatch.includes('telegramChatButtons(job.channel_id||undefined)'));
const migrate=read('supabase/migrations/20261013050000_telegram_mentions_assignments.sql');
for(const required of [
 'create table if not exists public.game_assigned_tasks',
 'enable row level security',
 'assigned_tasks_read',
 'create_game_assigned_task',
 'complete_game_assigned_task',
 'confirm_game_assigned_task',
 "new.author_id<>new.recipient_id",
 'gos_chat_mention_notify',
 'gos_civic_mention_notify',
 'gos_wall_mention_notify',
 'gos_document_delivery_notify',
 "lower(split_part(btrim(m.full_name),' ',1))"
])assert.ok(migrate.includes(required),'Migration missing '+required);
assert.ok(migrate.includes("p_author_id is distinct from actor and not teacher"),'Only teacher may impersonate a task author');
assert.ok(migrate.includes('on conflict do nothing'),'Notifications are deduplicated');
const profile=read('components/game/ProfileView.tsx');
const tasks=read('components/game/AssignedTasks.tsx');
assert.ok(profile.includes('Назначить задачу')&&profile.includes('<AssignedTasks'));
assert.ok(tasks.includes("create_game_assigned_task")&&tasks.includes("complete_game_assigned_task")&&tasks.includes("confirm_game_assigned_task"));
assert.ok(tasks.includes('onBack')&&tasks.includes('requires_confirmation')===false || tasks.includes('p_requires_confirmation')); 
const comment=read('components/game/CivicDiscussion.tsx');
const wall=read('components/game/PoliticalWallView.tsx');
assert.ok(comment.includes('mentionOptions')&&comment.includes('@фамилия'));
assert.ok(wall.includes('postMentionOptions')&&wall.includes('@фамилия'));
const retention=read('app/api/maintenance/chat-media/route.ts');
assert.ok(retention.includes('RETENTION_HOURS=24'));
assert.ok(retention.includes("'kind',['audio','video']"));
assert.ok(retention.includes("authorization")&&retention.includes('CRON_SECRET'));
assert.ok(retention.indexOf("storage.from('game-media').remove(paths)")<retention.indexOf("from('chat_messages').delete()"));
const cron=JSON.parse(read('vercel.json')).crons;
assert.ok(cron.some(x=>x.path==='/api/maintenance/chat-media'));
console.log('PASS Telegram cards, bot name/photo, mention routing, assignment RLS, author audit and 24h media expiry contracts.');
