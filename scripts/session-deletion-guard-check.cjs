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
console.log('PASS game-session deletion: scoped ZIP receipt, expiry, strict confirmation, UI explanation, owner and RPC protections');
