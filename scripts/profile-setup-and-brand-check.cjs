const fs=require('node:fs'),assert=require('node:assert/strict');
const file=p=>fs.readFileSync(p,'utf8');
const client=file('components/GameClient.tsx');
const profile=file('components/game/ProfileView.tsx');
const auth=file('components/game/ProfileSecurityPanel.tsx');
const sql=file('supabase/migrations/20261012230000_profile_setup_once_status.sql');
const css=file('app/profile-first-setup.css');
const layout=file('app/layout.tsx');
const targets=[
 'components/game/TelegramConnection.tsx',
 'app/api/telegram/webhook/route.ts',
 'components/PublicScreen.tsx',
 'app/poll/page.tsx',
 'components/game/Achievements.tsx',
 'components/game/DocumentPaper.tsx',
 'components/game/PresidentialElectionLab.tsx',
 'components/game/portableSession.ts',
 'components/game/useRepublicGame.ts'
];
assert(!client.includes('className="onboardingBar"'),'Repeated onboarding ribbon must be removed');
assert(client.includes('role="dialog" aria-modal="true"'),'First visit must open a centered modal');
assert(client.includes('const showSetupWelcome=')&&client.includes('setupWelcomeActive'),'Modal must have an explicit first-display gate');
assert(client.includes('get_my_game_profile_setup'),'Status must be checked on server');
assert(client.includes('mark_my_game_profile_setup_prompt_seen'),'First display must be persisted');
assert(client.indexOf("mark_my_game_profile_setup_prompt_seen")>client.indexOf("setSetupWelcomeActive(true)"),'Persist on first display, not only on completion');
assert(client.includes('const setupDialogRef=useDialog(showSetupWelcome'),'Modal must trap focus');
assert(client.includes('setSetupFocusVersion(x=>x+1)'),'Jump to missing field required');
assert(client.includes("supabase.channel('event-count:"),'Existing realtime event counts must remain intact');
assert(client.includes("supabase.rpc('complete_my_game_profile'"),'Server completion guard must remain');
assert(profile.includes('data-profile-setup-field="name"')&&profile.includes('data-profile-setup-field="gender"')&&profile.includes('data-profile-setup-field="bio"'));
assert(profile.includes('data-profile-setup-field="signature"')&&auth.includes('data-profile-setup-field="email"')&&auth.includes('data-profile-setup-field="password"'));
assert(profile.includes('panel?.scrollIntoView')&&profile.includes('profileSetupInvalid'),'Invalid fields must be highlighted and focused');
assert(profile.includes('onFinishSetup'),'Completion must be available inside profile');
assert(sql.includes('profile_setup_prompt_seen_at')&&sql.includes('get_my_game_profile_setup')&&sql.includes('mark_my_game_profile_setup_prompt_seen'));
assert(sql.includes('auth.uid()')&&sql.includes('private.is_game_member')&&sql.includes('private.is_game_observer'));
assert(!sql.includes('encrypted_password\'',0)||sql.includes('to_jsonb(missing)'),'Never send password hash to client');
assert(sql.includes('to_jsonb(missing)')&&sql.includes("'completed'"),'Read-only status must contain only safe fields');
assert(css.includes('place-items:center')&&css.includes('profileSetupInvalid'));
assert(layout.includes("import './profile-first-setup.css'"));
for(const target of targets)assert(!/GOS\/\/SIMS/.test(file(target)),'Visible legacy brand in '+target);
assert(file('components/game/TelegramConnection.tsx').includes("GosSimsGameBot"),'Do not change the real Telegram bot username');
assert(file('components/GameClient.tsx').includes('gos-sims-dock:'),'Storage keys must stay backward-compatible');
assert(file('components/game/portableSession.ts').includes("'GOS-SIMS'"),'Archive format remains unchanged');
// Email confirmation UX: request accepted is not the same as email verified.
assert(auth.includes('if(r.error){')&&auth.includes('describeProfileEmailError(r.error)')&&auth.includes('setNotice(issue.notice)'),'Do not announce mail sent on Supabase error');
assert(auth.includes("setNotice('Письмо отправлено на '+requestedEmail"),'An accepted verification request must clearly say the email was sent');
assert(auth.includes('независимо от того, какая страница открылась по ссылке'),'After clicking the link, students must know to return even if the result was unexpected');
assert(auth.includes('Проверить подтверждение» ещё раз'),'Unverified state must explain the retry rather than imply email was not sent');
assert(auth.includes('Отправить письмо повторно')&&auth.includes('Отправить письмо для подтверждения'),'Email button labels must match the request state');
assert(auth.includes('disabled={busy} onClick={()=>void check()}'),'The follow-up confirmation button must remain usable after returning from the link');
assert(auth.indexOf('{notice&&<p className="profileSecurityNotice"')<auth.indexOf('{verified&&<div className='),'The request result must be displayed next to email actions, not below unrelated controls');
assert(auth.includes('Почта подтверждена. Теперь установите личный пароль'),'Successful confirmation must explicitly identify the next action');
console.log('PASS first-visit persisted modal, profile field focus/labels, safe RPC and visible brand migration');