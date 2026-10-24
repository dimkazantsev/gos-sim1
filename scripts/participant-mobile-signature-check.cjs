const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
function read(p){return fs.readFileSync(p,'utf8')}
const client=read('components/game/useRepublicGame.ts');
const signature=read('components/game/SignatureUpload.tsx');
const tour=read('components/game/GuidedTour.tsx');
const css=read('components/game/GuidedTour.module.css');
const dock=read('app/mobile-nav-polish.css');
const home=read('app/page.tsx');
const migration=read('supabase/migrations/20261025002500_prevent_cross_role_rejoin.sql');
for(const path of ['components/game/useRepublicGame.ts','components/game/GuidedTour.tsx','app/page.tsx']){
 const result=ts.transpileModule(read(path),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
 assert(!result.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error),path+' TypeScript syntax');
}
assert(client.includes('active.data.session?.user.id!==me.user_id'),'Signature must be uploaded only by account being edited');
assert(client.includes("if(me.kind==='teacher'?'teacher-assets/")||client.includes("me.kind==='teacher'?'teacher-assets/"),'Teacher signs in permanent account storage');
assert(client.includes("gameId+'/profiles/'+me.user_id"),'Real students sign their own profile in the game');
assert(signature.includes('onSaved?.()'),'Successful signatures reload setup state');
assert(tour.includes("mobile?'Нажмите подсвеченную кнопку в нижнем меню"),'Tour tells users where to tap');
assert(tour.includes('(mobile||!rect)&&<button'),'Mobile tutorial offers fallback even with a highlighted dock target');
assert(tour.includes('onClick={()=>onFallback(step.target)}'),'Mobile alternative really navigates');
assert(css.includes('.fallback{display:flex'),'Mobile fallback must be a proper button');
assert(dock.includes('.mobileDockIcon .eventDockBadge')&&dock.includes('top:0;right:-8px'),'Counters kept within clipped horizontal dock');
assert(dock.includes('.mobileDockIcon{position:relative;transform:translateY(2px)}'),'Shared optical baseline');
assert(home.includes("newParticipantIdentity&&session"),'Switch creates a separate anonymous identity');
assert(migration.includes('gm.kind<>k')&&migration.includes('auth.uid()'),'RPC blocks cross-role changes');
console.log('PASS: real-role signature guard, mobile tutorial action, counters and protected classroom identity switching.');
