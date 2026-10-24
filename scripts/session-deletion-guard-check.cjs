const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../components/game/sessionDeletionGuard.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const guard={};
new Function('exports',compiled)(guard);
const {freshGameBackupReceipt,gameBackupReceiptKey,canPermanentlyDeleteGame,GAME_BACKUP_RECEIPT_TTL_MS}=guard;
const now=1770000000000;
assert.notEqual(gameBackupReceiptKey('teacher-A','game-A'),gameBackupReceiptKey('teacher-B','game-A'));
assert.notEqual(gameBackupReceiptKey('teacher-A','game-A'),gameBackupReceiptKey('teacher-A','game-B'));
assert.equal(freshGameBackupReceipt(String(now-5000),now),true,'Recent ZIP receipt survives same-tab reload');
for(const receipt of [null,'','NaN','0',String(now+1),String(now-GAME_BACKUP_RECEIPT_TTL_MS),String(now-GAME_BACKUP_RECEIPT_TTL_MS*2)]){
 assert.equal(freshGameBackupReceipt(receipt,now),false,'Absent, future, or stale ZIP receipt is rejected');
}
const valid={busy:false,confirmed:true,typed:'8.414',code:'8.414',backupReady:true};
assert.equal(canPermanentlyDeleteGame(valid),true,'Exact dotted session code accepted');
for(const overrides of [{busy:true},{confirmed:false},{typed:'8.41'},{typed:'8.414 '},{code:'8.415'},{backupReady:false}]){
 assert.equal(canPermanentlyDeleteGame({...valid,...overrides}),false,'Deletion guard rejects missing prerequisite');
}
const ui=fs.readFileSync(path.join(__dirname,'../components/game/SessionManager.tsx'),'utf8');
assert(ui.includes('window.sessionStorage.setItem(key,timestamp)')&&ui.includes('window.sessionStorage.getItem(receiptKey)'),'ZIP receipt survives refresh in one tab');
assert(ui.includes("if(format==='zip'&&me)")&&ui.includes('saveGameBlob(blob,'),'Only full ZIP export creates deletion receipt');
assert(ui.includes('disabled={!deleteAllowed}')&&ui.includes('if(!s||!teacher||!deleteAllowed)return'),'UI and handler share the same guard');
assert(ui.includes('Для разблокировки удаления')&&ui.includes('ZIP · Локальная Игра'),'User sees why deletion is disabled');
assert(ui.includes("s.owner_id!==me?.user_id&&!admin")&&ui.includes("supabase.rpc('prepare_game_deletion'")&&ui.includes("supabase.rpc('delete_game_permanently'"),'Owner/admin checks and server deletion workflow remain intact');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261023165000_game_deletion_cec_dependencies.sql'),'utf8');
for(const needle of ["select * into target from public.games where id=p_game for update","target.owner_id<>auth.uid()","upper(trim(p_code))<>target.game_code","target.status<>'archived'","storage.objects","remaining>0","delete from public.presidential_cec_court_referrals where game_id=p_game","delete from public.presidential_cec_complaints where game_id=p_game","delete from public.games where id=p_game"]){
 assert(migration.includes(needle),'Missing guarded game deletion clause: '+needle);
}
const order=[
 "select * into target from public.games",
 "target.owner_id<>auth.uid()",
 "upper(trim(p_code))<>target.game_code",
 "target.status<>'archived'",
 "if remaining>0 then",
 "delete from public.presidential_cec_court_referrals where game_id=p_game",
 "delete from public.presidential_cec_complaints where game_id=p_game",
 "delete from public.member_login_emails where game_id=p_game",
 "delete from public.retired_event_cases where game_id=p_game",
 "delete from public.games where id=p_game",
];
for(let i=1;i<order.length;i++)assert(migration.indexOf(order[i])>migration.indexOf(order[i-1]),'Delete guard and FK dependency order was changed: '+order[i]);
assert(!/delete\s+from\s+auth\./i.test(migration),'Game deletion must never destroy global Auth users');
assert(migration.includes("revoke all on function public.delete_game_permanently(uuid,text) from public,anon"),'No anonymous delete rights');
console.log('PASS safe CEC removal: permission, code, archive, media guards and child-first FK cleanup');

console.log('PASS game-session deletion: scoped ZIP receipt, expiry, strict confirmation, UI explanation, owner and RPC protections');

const permanent=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261024223000_teacher_account_assets.sql'),'utf8');
const saver=fs.readFileSync(path.join(__dirname,'../components/game/preserveTeacherAssets.ts'),'utf8');
const gameHook=fs.readFileSync(path.join(__dirname,'../components/game/useRepublicGame.ts'),'utf8');
const resolver=fs.readFileSync(path.join(__dirname,'../lib/resolveStoredAsset.ts'),'utf8');
for(const guard of ['teacher_assets_owner_insert','teacher_assets_member_read','teacher_assets_owner_delete',
 'teacher_profile_sync_games','private.teacher_game_profile_persist','private.prevent_teacher_asset_loss']){
 assert(permanent.includes(guard),'Account-scoped assets missing safeguard: '+guard);
}
assert(permanent.includes("JOIN storage.objects o ON o.bucket_id='game-assets'"),
 'Legacy deletion guard must check actual objects rather than stale paths');
assert(permanent.includes("pg_trigger_depth()>1"),'Profile propagation must avoid recursive writes');
assert(saver.includes("supabase.storage.from('teacher-assets').upload")&&saver.includes("supabase.from('teacher_profiles').update"),
 'Legacy assets must be copied before profile path is switched');
assert(saver.includes('if(status===404)continue'),'Missing legacy files do not trigger permanent deletion failure');
assert(resolver.includes("storedPath.startsWith(marker)")&&resolver.includes("bucket:'teacher-assets'"),
 'Account asset links use a private, game-independent bucket');
assert(gameHook.includes("me.kind==='teacher'?'teacher-assets/'"),
 'Teacher avatar and signature uploads must be stored outside game paths');
assert(ui.indexOf('preserveOwnTeacherAssets(s.id,me.user_id)')<ui.indexOf('await purgeGameAssets(s.id'),
 'Permanent teacher media must be migrated before cleanup');
assert(!/delete\s+from\s+public\.teacher_profiles/i.test(permanent),
 'Game deletion must not erase the permanent teacher account');
const purgeGuard=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261024224500_prevent_shared_teacher_asset_purge.sql'),'utf8');
assert(purgeGuard.includes("JOIN storage.objects o ON o.bucket_id='game-assets'"),
 'All teachers shared with the game must be checked before file deletion');
assert(purgeGuard.includes('g.owner_id<>(select auth.uid())')&&purgeGuard.includes("g.status<>'archived'"),
 'Private guard checks owner permissions and archive status');
assert(ui.indexOf("supabase.rpc('assert_game_teacher_assets_safe_to_purge'")>
       ui.indexOf('preserveOwnTeacherAssets(s.id,me.user_id)')&&
       ui.indexOf("supabase.rpc('assert_game_teacher_assets_safe_to_purge'")<
       ui.indexOf('await purgeGameAssets(s.id'),
 'Files of other teachers must be checked before purging any shared game media');
console.log('PASS permanent teacher asset storage: identity, access, profile sync and safe deletion order');
