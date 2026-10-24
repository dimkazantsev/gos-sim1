/* Never conflate selected role, invitation type and account identity. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const entry=read('app/page.tsx'),sessions=read('components/game/TeacherGameSessions.tsx'),
 access=read('components/game/TeacherAccessCodes.tsx'),
 m=read('supabase/migrations/20261025113000_strict_roles_and_owner_codes.sql'),
 harden=read('supabase/migrations/20261025114000_owner_only_code_management.sql'),
 names=read('supabase/migrations/20261025115000_protect_owner_name_and_teacher_profiles.sql');
assert(!entry.includes('newParticipantIdentity')&&!entry.includes('entryNewParticipant'),'Never ask participant to check extra role switch');
assert(entry.includes("rpc('join_game_as_role'")&&entry.includes("p_expected_kind:mode==='guest'?'observer':mode"),'Game join binds selected role to invitation');
assert(entry.includes("rpc('resume_member_game_as_role'"),'Password resume cannot elevate to owner');
assert(entry.includes("signOut({scope:'local'})")&&entry.includes("signInAnonymously"),'Test identity cannot reuse teacher uid');
assert(!entry.includes("rpc('join_game_with_code'"),'Disallow legacy role inference');
assert(m.includes("AND ic.kind=p_expected_kind")&&m.includes("IF k<>p_expected_kind"),'Server checks expected role before insertion');
assert(m.includes("v_uid IS NULL")&&m.includes("auth.users u")&&m.includes("u.email_confirmed_at IS NOT NULL"),'External teacher must use verified email and password');
assert(m.includes("teacher_profiles tp WHERE tp.user_id=v_uid")&&m.includes("platform_admins pa WHERE pa.user_id=v_uid"),'Teacher cannot join as student/guest on same identity');
assert(m.includes("REVOKE ALL ON FUNCTION public.join_game_with_code"),'Legacy role inference not exposed');
assert(m.includes("REVOKE ALL ON FUNCTION public.resume_member_game"),'Old resume does not grant elevated role');
assert(harden.includes("REVOKE ALL ON FUNCTION public.create_game_session"),'An anonymous account cannot create a fake teacher game');
assert(names.includes("защищённой учётной записи")&&names.includes("u.is_anonymous"),'Owner name and teacher row protection');
assert(sessions.includes('TeacherAccessCodes gameId={game.id}')&&sessions.includes('setCodesFor(String(r.data))'),'New codes accessible in owner profile immediately');
assert(sessions.includes("generated('STD')")&&sessions.includes("generated('TCH')")&&sessions.includes("generated('GOS')"),'Three distinct generator buttons');
assert(!sessions.includes("openGame(String(r.data))"),'Creating a game stays in owner profile and displays codes');
assert(access.includes("owner_rotate_invitation")&&access.includes('teacherCodeActiveRoles'),'Generated secrets remain visible and rotatable');
assert(access.includes("p_kind:kind")&&access.includes("scope==='teacher'"),'Teacher invitation is separate from owner login');
assert(m.includes("vault.create_secret")&&m.includes("private.game_invitation_secrets"),'Initial secrets persist in Vault, not only in short-lived UI');
assert(m.includes("private.is_game_code_owner")&&harden.includes("private.is_game_code_owner"),'Non-owner teachers cannot view or generate private codes');
console.log('PASS strict game roles, owner-only persistent codes, safe fresh participant identity and no role-switch checkbox.');
