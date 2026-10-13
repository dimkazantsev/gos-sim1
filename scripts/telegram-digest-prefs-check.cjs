const assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const migrate=read('supabase/migrations/20261013070000_telegram_digest_prefs.sql');
for(const term of ['enable row level security','telegram_prefs_owner_select','telegram_prefs_owner_insert','telegram_prefs_owner_update','private.telegram_daily_digest_ledger','on conflict do nothing returning','auth.role()',"'service_role'","m.roster_archived_at is null","l.notifications_enabled","coalesce(p.daily_brief,true)"]){
 assert.ok(migrate.includes(term),'Missing migration constraint: '+term);
}
assert.ok(!migrate.includes('delete from public.game_assigned_tasks'),'Never mutate game assignments');
for(const category of ["'chat'","'stage'","'vote'","'event'","'document'","'daily_brief'","'appeal'","'appeal_reply'","'task'","'document_delivery'"]){
 assert.ok(migrate.includes(category),'Outbox must allow '+category);
}
assert.ok(migrate.includes('telegram_outbox_category_check'),'Legacy CHECK must be updated');
assert.ok(migrate.includes('grant select,insert,update on public.telegram_notification_preferences to service_role'),'Dispatcher must be able to read prefs');
const hook=read('app/api/telegram/webhook/route.ts');
assert.ok(hook.includes("telegram_notification_preferences"));
assert.ok(hook.includes("const key=prefMap[command]"));
assert.ok(!hook.includes("telegram_notification_preferences').upsert"),'Toggling must not reset other preferences');
assert.ok(hook.includes("table.update({[key]:!oldValue"),'Existing preferences must be patched by column');
const menu=read('lib/server/telegramPresentation.ts');
assert.ok(menu.includes("'gos:prefs:brief':'/settings_brief'"));
assert.ok(menu.includes("'gos:prefs:quiet':'/settings_quiet'"));
const card=read('lib/server/telegramCabinet.ts');
assert.ok(card.includes("telegram_notification_preferences"));
assert.ok(card.includes("callback_data:'gos:prefs:'+key"));
const dispatch=read('app/api/telegram/dispatch/route.ts');
assert.ok(dispatch.includes("preferences?.quiet_hours"),'Quiet hours enforced in dispatcher');
assert.ok(dispatch.includes('attempts:job.attempts,next_attempt_at:'),'Quiet hours must not consume delivery retries');
assert.ok(dispatch.includes("Notification category disabled"),'Category filter enforced in dispatcher');
assert.ok(dispatch.includes("job.category==='daily_brief'"),'Daily digest gets personal office button');
const daily=read('app/api/telegram/digest/route.ts');
assert.ok(daily.includes('CRON_SECRET')&&daily.includes("telegram_queue_morning_digest"));
const crons=JSON.parse(read('vercel.json')).crons;
assert.equal(crons.find(x=>x.path==='/api/telegram/digest')?.schedule,'0 1 * * *');
assert.equal(crons.find(x=>x.path==='/api/telegram/dispatch')?.schedule,'0 2 * * *');
console.log('PASS Telegram digest idempotence, preferences ACL, quiet hours and schedule contracts');
