/* Realtime-connected clients should not flood Supabase with full game reads.
 * Exercise the actual polling callback with virtual time and WebSocket status. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const userError=fs.readFileSync('lib/userError.ts','utf8');
const ast=ts.createSourceFile('useRepublicGame.ts',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
assert.equal(ast.parseDiagnostics.length,0,'useRepublicGame.ts must parse');
assert(userError.includes('status===402'),'Explicit service restriction error');
assert(source.includes("for(const table of ['game_stages'"),'Realtime targeted refresh is retained');
assert(!source.includes('telegramWake'),'Realtime updates must not wake dispatcher in every connected client');
assert.equal((source.match(/kickTelegramDispatch\(/g)||[]).length,4,
 'Only 3 explicit party mutation paths may wake Telegram, plus the helper definition');
const migration=fs.readFileSync('supabase/migrations/20261021080433_telegram_dispatch_skip_empty_outbox.sql','utf8');
const guardedCall=migration.indexOf('select private.request_telegram_dispatch()');
const dueCheck=migration.indexOf('where exists (');
assert(guardedCall>=0&&dueCheck>guardedCall,
 'Cron must skip dispatcher HTTP call when no due job exists');
assert(migration.includes('cron.alter_job')&&migration.includes('telegram_outbox_ready_idx'),
 'Patch only the existing scheduled job using the indexed queue check');
assert(migration.includes('where sent_at is null and attempts < 5 and next_attempt_at <= now()'),
 'Queue guard matches dispatcher eligibility');
assert(!migration.includes('create or replace function private.request_telegram_dispatch'),
 'Immediate INSERT-trigger function must remain unchanged');

assert(source.includes("if(liveConnected&&now-lastPollAt<180000)return"),'Connected polling is reduced to once per 3 minutes');
assert(source.includes('},30000+pollJitter)'), 'Disconnected recovery remains on 30–40s timer');

const focusStart=source.indexOf('  const recover=()=>{');
const focusEnd=source.indexOf('  const visible=()=>{',focusStart);
assert(focusStart>=0&&focusEnd>focusStart,'Focus recovery function is available');
let focusClock=1_000_000,recoveryReads=0,widgetInvalidations=0;
const focusEnv={
 disposed:false,document:{visibilityState:'visible'},
 authUser:{current:'user-one'},acceptedMember:{current:{user_id:'user-one'}},
 Date:{now:()=>focusClock},lastRecoveryAt:0,
 hydrateActiveView(){recoveryReads++;return Promise.resolve()},
 notifyGameDataRefresh(){widgetInvalidations++},
 activeViewRef:{current:'stages'},refreshBudgetPulse(){},
 gameId:'game-one'
};
vm.runInNewContext(source.slice(focusStart,focusEnd)+
 'recover();recover();document.visibilityState="hidden";recover();',focusEnv);
assert.equal(recoveryReads,1,'Focus and visibility event burst causes one recovery');
assert.equal(widgetInvalidations,1,'Only one stage invalidation per focus burst');
focusEnv.document.visibilityState='visible';
focusClock+=1501;
vm.runInNewContext('recover()',focusEnv);
assert.equal(recoveryReads,2,'Recovery resumes after debounce interval');

const cleanupSql=fs.readFileSync('supabase/migrations/20261021085946_chat_media_cleanup_skip_empty.sql','utf8');
const operationalSql=fs.readFileSync('supabase/ops/chat_media_cleanup_schedule.sql','utf8');
for(const sql of [cleanupSql,operationalSql]){
 assert(sql.includes("exists (select 1 from public.chat_media_expired_candidates(1))"),
  'Cleanup only wakes for due Storage objects');
 assert(sql.includes("and not exists (")&&sql.includes("from storage.objects o"),
  'Orphaned chat rows still trigger eventual finalization');
 assert(sql.includes("interval '1 hour'"),'One-hour media retention is unchanged');
 assert(sql.includes("gos_chat_media_cleanup_token"),'Vault-based function authorization is retained');
 assert(sql.includes("net.http_post("),'Preserve Edge Function invocation for due cleanup');
}
assert(cleanupSql.includes('cron.alter_job'),'Production migration only updates existing cron job');
assert(!cleanupSql.includes('cron.unschedule'),'Scheduled cleanup cannot be disabled');

const sectionSource=fs.readFileSync('components/game/useSectionUpdates.ts','utf8');
const gameTableSync=fs.readFileSync('components/game/useGameTableSync.ts','utf8');
const gameShell=fs.readFileSync('components/GameClient.tsx','utf8');
assert(gameTableSync.includes("export const SECTION_UPDATES_REFRESH_EVENT='gos-sims:section-updates'"),
 'A separate section invalidation must not refetch unrelated stage widgets');
assert(sectionSource.includes('window.addEventListener(SECTION_UPDATES_REFRESH_EVENT,invalidated)'),
 'Section count hook consumes the targeted event');
assert(sectionSource.includes("document.visibilityState!=='visible'||(e as CustomEvent"),
 'Hidden tabs cannot launch section counter RPCs on pushed events');
assert(sectionSource.includes("document.addEventListener('visibilitychange',focused)"),
 'Resuming a hidden tab refreshes section counts without waiting for the 3-minute fallback');
assert(sectionSource.includes('window.removeEventListener(SECTION_UPDATES_REFRESH_EVENT,invalidated)'),
 'Section count hook releases the event listener on unmount');
assert(gameShell.includes('notifySectionUpdates(game!.id)'),
 'Event assignment/invitation changes invalidate the section counter');
assert(source.includes('if(partyDocs)notifySectionUpdates(gameId)'),
 'Party document changes invalidate teacher section counters');
assert(sectionSource.includes('gameRealtimeConnected(gameId)'),
 'Section badges must reuse shared WebSocket health instead of always polling');
assert(sectionSource.includes("window.addEventListener(GAME_DATA_REFRESH_EVENT,invalidated)"),
 'Section badges still respond to pushed changes');
const sectionPollStart=sectionSource.indexOf('  const poll=setInterval(()=>{');
const sectionPollEnd=sectionSource.indexOf('  window.addEventListener(GAME_DATA_REFRESH_EVENT',sectionPollStart);
assert(sectionPollStart>=0&&sectionPollEnd>sectionPollStart);
let pollClock=1_000_000,sectionReads=0,connected=true,sectionTick=null;
const sectionEnv={
 document:{visibilityState:'visible'},Date:{now:()=>pollClock},
 gameRealtimeConnected:()=>connected,gameId:'game-one',
 lastFallbackAt:pollClock,
 load:()=>{sectionReads++;return Promise.resolve()},
 setInterval:fn=>{sectionTick=fn;return 1},
 Math:Object.assign(Object.create(Math),{random:()=>0})
};
vm.runInNewContext(sectionSource.slice(sectionPollStart,sectionPollEnd),sectionEnv);
pollClock+=120_000;sectionTick();
assert.equal(sectionReads,0,'Connected badges must not poll within 2 minutes');
pollClock+=60_000;sectionTick();
assert.equal(sectionReads,1,'Connected badges reconcile once after 3 minutes');
pollClock+=30_000;sectionTick();
assert.equal(sectionReads,1,'No 30-second polling on a healthy WebSocket');
connected=false;pollClock+=30_000;sectionTick();
assert.equal(sectionReads,2,'Disconnected badges recover on the regular timer');
sectionEnv.document.visibilityState='hidden';pollClock+=60_000;sectionTick();
assert.equal(sectionReads,2,'Hidden tabs do not poll');


const from=source.indexOf('  channel.subscribe(status=>{');
const to=source.indexOf('  return()=>{',from);
assert(from>=0&&to>from,'Live subscribe and fallback polling located');
const snippet=source.slice(from,to);
assert(snippet.includes('const poll=setInterval'), 'Expected polling callback');
let clock=1000000,callback=null,tick=null,changed=0;
const env={
 Date:{now:()=>clock},
 channel:{subscribe(fn){callback=fn;return this}},
 setGameRealtimeConnection(_gameId,_connected){},
 document:{visibilityState:'visible'},
 setRealtimeState(){},
 setInterval(fn){tick=fn;return 1},
 chatOpenRef:{current:false},
 me:{user_id:'regression-student'},
 gameId:'simulation',
 schedule(){changed++},
 liveConnected:false,lastPollAt:0,disposed:false,dirtyCore:false,dirtyOverview:false,dirtyChat:false,dirtyPins:false,
 console
};
const script=snippet.slice(0,snippet.indexOf('  // Realtime handles unread counters while chat is closed.'));
vm.runInNewContext(script,env);
assert.equal(typeof callback,'function');
assert.equal(typeof tick,'function');
callback('SUBSCRIBED');
tick();
assert.equal(changed,0,'No immediate full refresh on healthy socket');
clock+=179999;tick();
assert.equal(changed,0,'Connected refresh skipped until 3-minute fallback threshold');
clock+=1;tick();
assert.equal(changed,1,'Once per 3 minutes when connected');
clock+=30000;tick();
assert.equal(changed,1,'Not every 30 seconds while connected');
callback('CLOSED');tick();
assert.equal(changed,2,'Disconnected client recovers on next normal poll');
console.log('PASS: 402 visible to user, connected 3-minute fallback, disconnected 30-40s recovery, game realtime events retained, syntax.');
