/* Focused regression for one invitation panel without changing the wider membership system. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const source=read('components/game/TeacherAccessCodes.tsx');
const session=read('components/game/SessionManager.tsx');
const page=read('app/page.tsx');
const sql=read('supabase/migrations/20261013234000_unified_guest_access_codes.sql');
assert.ok(session.includes('<TeacherAccessCodes gameId={game.id}/>'));
assert.ok(!session.includes('profileGuestInvites')&&!session.includes('guestCode,setGuestCode'),'No duplicate guest code editor');
for(const marker of ['participant','group','guest' ,'teacher_create_saved_invitation','teacher_access_code_list',
 'teacher_revoke_access_code','teacher_delete_access_code','Сгенерировать','Создать приглашение','Копировать']){
 assert.ok(source.includes(marker),'Missing single-panel feature '+marker);
}
assert.ok(source.includes("scope==='guest'?6:8"),'Guest minimum code length must remain six');
assert.ok(source.includes("crypto.getRandomValues"),'Generated codes must be unpredictable');
assert.ok(source.includes('Повторно посмотреть секретное значение нельзя'),'Hashed codes cannot be shown again');
assert.ok(source.includes('window.confirm'),'Revocation and deletion require confirmation');
assert.ok(page.includes('Приглашение гостя')&&page.includes('Приглашение участника'),'Login invitation names standardized');
assert.ok(sql.includes("private.is_game_teacher(p_game_id)"),'Read and writes require teacher server validation');
assert.ok(sql.includes("i.kind in ('student','observer')"),'Both invitation categories must appear');
assert.ok(sql.includes("kind in ('student','observer') and active=false"),'Never delete active or teacher codes');
assert.ok(!/delete from public\.(games|game_members|game_profiles)/i.test(sql),'No participant or game deletion');
assert.ok(!/select[^;]*code_hash/i.test(sql),'The code list must not expose hashes');
console.log('PASS unified game code and participant/group/guest invitation lifecycle');
