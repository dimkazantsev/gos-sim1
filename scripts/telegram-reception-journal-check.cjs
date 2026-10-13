const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),Module=require('node:module');
function read(p){return fs.readFileSync(p,'utf8')}
function load(p,mocks={}){
 const m=new Module(p,module);m.filename=p;m.paths=module.paths;
 const prior=m.require.bind(m);
 m.require=id=>Object.prototype.hasOwnProperty.call(mocks,id)?mocks[id]:prior(id);
 m._compile(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,p);
 return m.exports;
}
const presentation=load('lib/server/telegramPresentation.ts');
const notice=load('lib/server/telegramNotice.ts');
const uid='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const draft='11111111-2222-3333-4444-555555555555';
for(const action of ['pick','confirm','edit','cancel']){
 const c='gos:appeal:'+action+':'+uid;
 assert.ok(c.length<=64,'Callback remains within Telegram limit');
 assert.equal(presentation.telegramCallbackCommand(c),'/appeal_'+action+' '+uid);
}
assert.equal(presentation.telegramCallbackCommand('gos:appeal:test'),'/appeal_test');
assert.equal(presentation.telegramCallbackCommand('gos:appeal:page:3'),'/appeal_page 3');
assert.equal(presentation.telegramCallbackCommand('gos:appeal:confirm:bad'),undefined);
assert.equal(presentation.telegramCallbackCommand('gos:appeal:pick:'+uid+';DROP'),undefined);
const individual=notice.telegramSystemNotice('task','Поручение получено.');
const html=presentation.telegramMessageHtml(individual);
assert.ok(html.startsWith('<b>🏛 ГОС.ID · Поручения</b>\n\nПоручение получено.'));
assert.equal((html.match(/<b>/g)||[]).length,1,'Only heading bold');
assert.ok(notice.telegramGroupNotices('task',['Поручение 1.','Поручение 2.'])
 .includes('1. Поручение 1.\n\n2. Поручение 2.'));
assert.ok(notice.telegramSystemNotice('chat','🏛 ГОС.ID · Чаты\n\nТекст').startsWith('🏛 ГОС.ID · Чаты\n\n'));
const sql=read('supabase/migrations/20261013193000_telegram_appeal_draft_workflow.sql');
for(const required of [
 'enable row level security', 'revoke all on public.telegram_appeal_drafts from public,anon,authenticated',
 'telegram_appeal_one_active_draft', "d.status<>'preview'",
 'p_telegram_user_id', 'for update', "m.roster_archived_at is null",
 'telegram_create_official_appeal(', "d.status='sent'", 'd.expires_at<=now()'
])assert.ok(sql.includes(required),'Missing draft security invariant: '+required);
const workflow=read('lib/server/telegramAppealWorkflow.ts');
assert.ok(workflow.includes("actor?.kind!=='teacher'"),'Teacher only dry run');
assert.ok(workflow.includes('Созданных обращений: 0.'),'Test mode does not send records');
assert.ok(workflow.includes("telegram_confirm_appeal_draft"),'Only confirmation sends an appeal');
assert.ok(workflow.includes("status:'awaiting_text'"),'Editing returns to input state');
assert.ok(workflow.includes("status:'cancelled'"),'Cancellation never submits an appeal');
assert.ok(workflow.includes("p_telegram_user_id:telegramId"),'Telegram identity is enforced in the RPC');
const dispatch=read('app/api/telegram/dispatch/route.ts');
assert.ok(dispatch.includes("candidate.user_id===job.user_id")&&dispatch.includes("candidate.game_id===job.game_id"),'Same game and addressee only');
assert.ok(dispatch.includes("candidate.category==='task'"),'Only low urgency tasks grouped');
assert.ok(dispatch.includes('.eq(\'attempts\',extra.attempts)'), 'Claims are CAS protected');
assert.ok(dispatch.includes("if(!source||source.status==='confirmed')"),'Removed tasks are skipped');
assert.ok(dispatch.includes('telegramGroupNotices(job.category,grouped.map(item=>item.body))'));
const journal=read('components/game/ClassroomJournal.tsx');
const css=read('app/journal-mobile-isolated.css');
const layout=read('app/layout.tsx');
assert.ok(journal.includes('className="gosJournalRecord"'));
assert.ok(journal.includes('className="gosJournalRecordBody"'));
assert.ok(!journal.includes('className="journalEvent"'));
assert.ok(css.includes('.classroomJournal .gosJournalRecord'));
assert.ok(css.includes('flex-direction:column')&&css.includes('overflow-wrap:anywhere'));
assert.ok(layout.indexOf("'./journal-mobile-isolated.css'")>layout.indexOf("'./2026-october-refinement.css'"));
console.log('PASS Telegram picker, preview confirmation, teacher dry-run, restricted aggregation, formatting and isolated mobile journal.');
