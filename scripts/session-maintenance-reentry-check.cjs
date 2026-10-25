const fs=require('node:fs'),assert=require('node:assert/strict');
/* One game's export / prepare / storage purge must be non-reentrant.
   No live game or Supabase access: simulate two clicks in the same React frame. */
const src=fs.readFileSync('components/game/SessionManager.tsx','utf8');
assert(src.includes("import {useRef,useState} from 'react'"),'Operation guard must use a synchronous ref');
assert(src.includes('const operationRef=useRef(false)'),'Each game row owns a synchronous operation guard');
const from=src.indexOf(' function lock(){'),to=src.indexOf(' async function exportOne(',from);
assert(from>=0&&to>from,'Find the actual game maintenance lock/unlock implementation');
const make=new Function('operationRef','setBusy','onBusyChange','session',src.slice(from,to)+'\nreturn {lock,unlock};');
const updates=[],ref={current:false};
const actions=make(ref,x=>updates.push(['busy',x]),x=>updates.push(['game',x]),{id:'fixture-game'});
assert.equal(actions.lock(),true,'First click acquires lock immediately');
assert.equal(ref.current,true);
assert.equal(actions.lock(),false,'Second click is rejected before state re-renders');
assert.deepEqual(updates,[['busy',true],['game','fixture-game']],'Rejected click must not repeat state changes');
actions.unlock();
assert.equal(ref.current,false,'After a completed or cancelled action, lock is released');
assert.equal(actions.lock(),true,'A subsequent intentional operation can proceed');
actions.unlock();
const exportsStart=src.indexOf(' async function exportOne(');
const deletesStart=src.indexOf(' async function openDelete(',exportsStart);
const deletionStart=src.indexOf(' async function deleteOne(',deletesStart);
const renderStart=src.indexOf('\n return <div className="gosTeacherManagedGame">',deletionStart);
assert(exportsStart>=0&&deletesStart>exportsStart&&deletionStart>deletesStart&&renderStart>deletionStart);
const exportBody=src.slice(exportsStart,deletesStart),openBody=src.slice(deletesStart,deletionStart),deleteBody=src.slice(deletionStart,renderStart);
assert(exportBody.includes('||!lock())return;'),'Export must acquire lock before first awaited RPC');
assert(openBody.includes('if(!lock())return;'),'Open deletion must acquire lock before looking up the game code');
assert(deleteBody.includes('if(!lock())return;'),'Permanent deletion must acquire lock before user confirmation');
assert(deleteBody.indexOf('if(!lock())return;')<deleteBody.indexOf('window.confirm('),'Confirmation must happen after acquiring lock');
assert(deleteBody.indexOf('try{')<deleteBody.indexOf('window.confirm('),'Cancel path must release lock in finally');
assert(deleteBody.includes('finally{unlock();setProgress(\'\')}'),'Errors and cancellation must release the lock');
assert(deleteBody.indexOf("supabase.rpc('prepare_game_deletion'")<deleteBody.indexOf('preserveOwnTeacherAssets(session.id,id)')&&
 deleteBody.indexOf('preserveOwnTeacherAssets(session.id,id)')<deleteBody.indexOf("supabase.rpc('assert_game_teacher_assets_safe_to_purge'")&&
 deleteBody.indexOf("supabase.rpc('assert_game_teacher_assets_safe_to_purge'")<deleteBody.indexOf('await purgeGameAssets(session.id')&&
 deleteBody.indexOf('await purgeGameAssets(session.id')<deleteBody.indexOf("supabase.rpc('delete_game_permanently'"),
 'Deletion must preserve all server/file safety stages and their order');
console.log('PASS: 2 rapid clicks on same game admit 1 action; cancelled/error actions release lock; deletion ordering preserved');
