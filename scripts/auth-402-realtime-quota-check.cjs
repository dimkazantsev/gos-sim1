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
 lastCoreSuccessAt:{current:0},realtimeDirtyTables:{current:new Set()},
 scheduleRealtimeReload(){recoveryReads++},
 notifyGameDataRefresh(){widgetInvalidations++},
 activeViewRef:{current:'stages'},refreshBudgetPulse(){},
 gameId:'game-one'
};
vm.runInNewContext(source.slice(focusStart,focusEnd)+
 'recover();recover();document.visibilityState="hidden";recover();',focusEnv);
assert.equal(recoveryReads,1,'Focus and visibility event burst causes one recovery');
assert.equal(widgetInvalidations,0,'Focus recovery does not broadcast unrelated widget invalidations');
focusEnv.document.visibilityState='visible';
focusClock+=1501;
vm.runInNewContext('recover()',focusEnv);
assert.equal(recoveryReads,1,'Focus noise inside the upstream 30-second window does not reload');
focusClock+=30000;
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
assert(sectionSource.includes("pending!==undefined||document.visibilityState!=='visible'"),
 'Hidden tabs cannot launch section counter RPCs on pushed events');
assert(sectionSource.includes("document.addEventListener('visibilitychange',focused)"),
 'Resuming a hidden tab refreshes section counts without waiting for the 3-minute fallback');
assert(sectionSource.includes('window.removeEventListener(SECTION_UPDATES_REFRESH_EVENT,invalidated)'),
 'Section count hook releases the event listener on unmount');
assert(gameShell.includes("['event_assignments','event_collaboration_invites','event_decisions']"),
 'Event badges retain scoped reconciliation for assignments and invitations');
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
 schedule:()=>{sectionReads++},
 setInterval:fn=>{sectionTick=fn;return 1},
 userJitter:0,
 Math:Object.assign(Object.create(Math),{random:()=>0})
};
vm.runInNewContext(sectionSource.slice(sectionPollStart,sectionPollEnd),sectionEnv);
pollClock+=120_000;sectionTick();
assert.equal(sectionReads,0,'Connected badges must not poll within 2 minutes');
pollClock+=180_000;sectionTick();
assert.equal(sectionReads,1,'Connected badges reconcile once after 5 minutes');
pollClock+=30_000;sectionTick();
assert.equal(sectionReads,1,'No frequent polling on a healthy WebSocket');
connected=false;pollClock+=30_000;sectionTick();
assert.equal(sectionReads,2,'Disconnected badges recover on the regular timer');
sectionEnv.document.visibilityState='hidden';pollClock+=60_000;sectionTick();
assert.equal(sectionReads,2,'Hidden tabs do not poll');


assert(source.includes('void supabase.realtime.setAuth().then(()=>{'),'Private Broadcast must authenticate before subscribing');
assert(source.includes('channel.subscribe(status=>{'),'Existing single channel still carries health status');
assert(source.includes('setGameRealtimeConnection(gameId,liveConnected)'),'Room connection health remains shared');
const from=source.indexOf('  const pollJitter=');
const to=source.indexOf('  // Realtime handles unread counters while chat is closed.',from);
assert(from>=0&&to>from,'Live fallback polling section found');
const snippet=source.slice(from,to);
assert(snippet.includes('const poll=setInterval'),'Expected 30–40s polling callback');
let clock=1_000_000,tick=null,changed=0;
const env={
 Date:{now:()=>clock},
 setInterval(fn){tick=fn;return 1},
 document:{visibilityState:'visible'},
 chatOpenRef:{current:false},
 me:{user_id:'regression-student'},
 gameId:'simulation',
 schedule(){changed++},
 liveConnected:true,lastPollAt:clock,disposed:false,reconcileTables:new Set(),dirtyOverview:false,dirtyChat:false,dirtyPins:false,
 activeViewRef:{current:'dashboard'},passiveSyncAt:{current:new Map()},lastFullPresentationAt:{current:clock},passiveSections:()=>['game_events','game_evaluations','game_crises'],
 backendRecoveryAfter:{current:0},
 officeReadState:{current:{lastSuccessAt:0,lastAttemptAt:0,inflight:null}},
 loadRepublicOffices:()=>Promise.resolve(),
 PRESENTATION_CACHE_TTL_MS:600000,
 console
};
vm.runInNewContext(snippet,env);
assert.equal(typeof tick,'function','Existing fallback timer remains registered');
tick();
assert.equal(changed,0,'No immediate refresh on healthy socket');
clock+=179999;tick();
assert.equal(changed,0,'Connected refresh skipped until 3-minute fallback threshold');
clock+=1;tick();
assert.equal(changed,1,'Once per 3 minutes when connected');
assert(env.reconcileTables.has('session_recovery'),'Connected fallback only verifies role and membership');
assert(!env.reconcileTables.has('*')&&!env.reconcileTables.has('game_stages'),
 'Connected fallback does not load all core collections or stages');
clock+=30000;tick();
assert.equal(changed,1,'Not every 30 seconds while connected');
env.reconcileTables.clear();
env.liveConnected=false;tick();
assert.equal(changed,2,'Disconnected client recovers on next normal poll');
assert(env.reconcileTables.has('session_recovery')&&env.reconcileTables.has('game_stages')
 &&env.reconcileTables.has('game_votes'),'Disconnected recovery requests only identity, stages and votes');
assert(!env.reconcileTables.has('*'),'Disconnection must not trigger a full entry bundle');
console.log('PASS: 402 visible, connected 5-minute badge fallback, game realtime 3-minute fallback, syntax.');
