const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const client=fs.readFileSync('components/GameClient.tsx','utf8');
const profile=fs.readFileSync('components/game/ProfileView.tsx','utf8');
const setup=fs.readFileSync('components/game/profileSetup.ts','utf8');
// All changes must retain the server-side completion contract: no direct profile
// writes, no client-side bypass when required fields are actually missing.
const compiled=ts.transpileModule(client,{fileName:'GameClient.tsx',compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert(!compiled.diagnostics?.some(x=>x.category===ts.DiagnosticCategory.Error),'GameClient syntax');
const profileCompiled=ts.transpileModule(profile,{fileName:'ProfileView.tsx',compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert(!profileCompiled.diagnostics?.some(x=>x.category===ts.DiagnosticCategory.Error),'ProfileView syntax');
assert(setup.includes("['name','gender','bio','signature','email','password']"),'Keep all six mandatory fields');
assert(client.includes("setupStatusScope===profileScope&&setupStatus&&!setupStatus.completed&&setupStatus.missing.length===0"),'Queue navigation only with a verified full checklist');
assert(client.includes('pendingProfileNavigation.current={view:next,target}'),'Never throw away requested section');
assert(client.includes("supabase.rpc('complete_my_game_profile',{p_game:gameAtRequest})"),'Only protected RPC may finalize a profile');
assert(client.includes("if(r.error)errorText=r.error.message"),'Do not claim success on RPC error');
assert(client.includes("if(pending)navigate(pending.view,pending.target,true)"),'Resume requested section after confirmed server completion');
assert(client.includes("setVerifiedSetupScope(profileScope)"),'Treat a confirmed RPC success as completed while the profile cache catches up');
assert(client.includes("if(r.data.completed)setVerifiedSetupScope("),'Use server-confirmed state after reload even when the profile row is stale');
assert(client.includes("setupStatusScope!==profileScope||!setupStatus||setupStatus.completed||setupStatus.missing.length===0"),'Do not force profile redirection before checking missing fields');
assert(client.includes("setupStatus.missing.map(key=>PROFILE_SETUP_LABELS[key])"),'Explain which fields remain');
assert(client.includes("next='profile'"),'Keep existing first-time setup requirement for genuinely incomplete users');
assert(client.includes("setupStatus.missing.length>0&&introSeen"),'No onboarding popup when all fields are ready for auto-finalization');
assert(profile.includes("own&&setupNotice&&<p className=\"profileSetupFeedback\""),'Show the reason immediately at the top of the profile');
assert(profile.includes("onFinishSetup"),'Keep manual finalization as a fallback');
assert(!client.includes("supabase.from('game_profiles').update("),'Do not forge a completion flag on the client');
console.log('PASS profile navigation: six fields, race-free setup status, secure auto-finalization, remembered section, failure explanation.');
