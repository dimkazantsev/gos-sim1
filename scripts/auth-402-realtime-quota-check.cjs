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
