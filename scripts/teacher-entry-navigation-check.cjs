'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const home=fs.readFileSync('app/page.tsx','utf8');
const teacher=fs.readFileSync('app/teacher/page.tsx','utf8');
const style=fs.readFileSync('app/teacher/teacher-portal.css','utf8');
const staticBuild=fs.readFileSync('scripts/prepare-github-pages.mjs','utf8');
for(const [name,source] of [['public entry',home],['teacher',teacher]]){
 const js=ts.transpileModule(source,{fileName:name+'.tsx',compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert(!js.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error),name+' syntax');
}
const preLogin=home.split(' async function submit(')[0];
assert(!preLogin.includes("router.replace('/teacher')"),'Public landing must not redirect teachers on mount');
assert(!preLogin.includes("from('teacher_profiles').select('user_id')"),'Public landing must not query teacher profile on mount');
assert(home.includes("if(teacherLogin){\n    router.push('/teacher');"),'The personal teacher login remains an explicit path');
assert(home.includes("if(!incomingSectionSuffix())return;"),'Shared game links remain explicit navigation');
assert(staticBuild.includes("writeFileSync(resolve(target,'components/StaticLanding.tsx'),home)"),'Static GitHub Pages landing reflects the unredirected source');
assert(teacher.includes('className="simShell teacherZeroShell teacherZeroLoadingShell"'), 'Loading uses the existing game shell');
assert(teacher.includes('className="sidebarBrand"><BrandIdentity tagline/>'), 'Loading brand has the same alignment wrapper as the main game');
assert(teacher.includes('className="profileHero teacherZeroLoadingHero"'), 'Loading status is shown inside the existing profile hero');
assert(!teacher.includes('className="connectionCard"'), 'The old unstyled loading card is removed from teacher route');
assert(style.includes('.teacherZeroLoadingShell .teacherZeroLoadingHero'), 'Scoped desktop styles exist');
assert(style.includes('@media(max-width:600px)')&&style.includes('.teacherZeroLoadingPhoto'), 'Narrow phone layout is handled');
assert(teacher.includes("if(!uid||auth.data.session?.user.is_anonymous)"), 'Unauthorized visitors cannot see a profile');
assert(teacher.includes("rpc('list_my_teacher_games')"), 'Authorization still checks server roles');
console.log('PASS: public entry is stable; explicit teacher login/deeplinks work; zero-game loading reuses the approved profile and responsive styles.');
