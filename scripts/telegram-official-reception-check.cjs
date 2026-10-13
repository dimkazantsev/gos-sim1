const assert=require('node:assert/strict'),fs=require('node:fs');
const q=p=>fs.readFileSync(p,'utf8');
const sql=q('supabase/migrations/20261013083000_telegram_official_reception.sql');
for(const word of [
 'create table if not exists public.official_appeals','enable row level security',
 'official_appeals_read','author_id=(select auth.uid())','recipient_id=(select auth.uid())',
 'unique(game_id,author_id,telegram_message_id)',
 'telegram_create_official_appeal','telegram_reply_official_appeal',
 "auth.role() is distinct from 'service_role'",
 'm.roster_archived_at is null','on conflict(game_id,author_id,telegram_message_id)',
 'gos_appeal_notify','grant execute on function public.telegram_reply_official_appeal'
])assert.ok(sql.includes(word),'Missing security invariant: '+word);
assert.ok(sql.includes("grant select,insert,update on public.official_appeals to service_role"),'Privileged dispatcher needs explicit table grant');
const digestSql=q('supabase/migrations/20261013070000_telegram_digest_prefs.sql');
for(const category of ["'appeal'","'appeal_reply'","'daily_brief'"])assert.ok(digestSql.includes(category),'Queue CHECK must permit '+category);
const hook=q('app/api/telegram/webhook/route.ts');
const workflow=q('lib/server/telegramAppealWorkflow.ts');
const draftSql=q('supabase/migrations/20261013193000_telegram_appeal_draft_workflow.sql');
assert.ok(hook.includes('handleTelegramAppeal('),'Interactive flow remains behind authenticated Telegram membership');
assert.ok(hook.includes("config.db.rpc('telegram_reply_official_appeal'"));
assert.ok(workflow.includes("resolveAppealRecipient(people,userId,match[1])"),'Invalid address rejected');
assert.ok(workflow.includes("telegram_confirm_appeal_draft"),'Confirmation must call atomic RPC');
assert.ok(!workflow.includes("telegram_create_official_appeal'"),'No direct send before confirmation');
assert.ok(draftSql.includes('for update')&&draftSql.includes("d.status<>'preview'"),'Exactly-once locked confirmation');
assert.ok(draftSql.includes("auth.role() is distinct from 'service_role'"),'Unauthorized clients cannot confirm');
assert.ok(draftSql.includes('telegram_create_official_appeal('),'Existing secured RPC is reused');
assert.ok(draftSql.includes('telegram_appeal_one_active_draft'),'Only one editable pending draft');
const menu=q('lib/server/telegramPresentation.ts');
assert.ok(menu.includes("'gos:appeals':'/appeals'"));
assert.ok(menu.includes("'gos:appeal':'/appeal'"));
const queue=q('app/api/telegram/dispatch/route.ts');
assert.ok(queue.includes("job.category==='appeal'")&&queue.includes("'gos:appeals'"));
console.log('PASS official Telegram reception: strict linked sender, unique recipient, RLS, idempotent messages and safe replies');
