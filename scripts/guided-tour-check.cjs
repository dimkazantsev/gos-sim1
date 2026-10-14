const fs=require('node:fs'),assert=require('node:assert/strict');
const read=path=>fs.readFileSync(path,'utf8');
const client=read('components/GameClient.tsx');
const tour=read('components/game/GuidedTour.tsx');
const style=read('components/game/GuidedTour.module.css');
const profile=read('components/game/ProfileView.tsx');
const dock=read('components/game/MobileDock.tsx');
const layout=read('app/layout.tsx');
const steps=[...tour.matchAll(/\{target:'(dashboard|stages|actions|parties|documents|votes|budget|events|grades|chat|profile)',title:/g)].map(x=>x[1]);
assert.deepEqual(steps,['dashboard','stages','actions','parties','documents','votes','budget','events','grades','chat','profile'],'The entire participant route must remain present and ordered');
assert(tour.includes("target:'teacher'")&&tour.includes('getTourSteps(teacher:boolean)'),'Teacher-only management step must be conditional');
for(const target of steps.filter(x=>x!=='chat')){
 assert(client.includes("['"+target+"'")||client.includes("'"+target+"'"),'Navigation route missing: '+target);
}
assert(client.includes('fromTourClick')&&client.includes('getTourSteps(!!g.teacher)'),'Tour steps must follow actual navigation clicks');
assert(client.includes("tourMode!=='tour'")&&client.includes('profileVerified'),'Profile gating must permit guided-only navigation');
assert(client.includes('const showSetupWelcome=')&&client.includes("tourMode==='idle'"),'Tour must not compete with required profile modal');
assert(client.includes('complete_my_game_profile'),'Server still completes profiles');
assert(client.includes("setTourMode('choice')")&&client.includes("setTourMode('tour')"),'Comic-to-choice-to-tour transition required');
assert(client.includes("navigate('profile',undefined,true)")&&client.includes("rememberTourChoice('skipped')"),'Skip must preserve profile setup');
assert(client.includes('onStartTutorial={beginTour}')&&profile.includes('Архив комиксов</button>')&&profile.includes('<Compass size={17}/> Пройти обучение</button>'),'Replay must be adjacent to comic archive and say «Пройти обучение» for both roles');
const teacherView=read('components/game/TeacherView.tsx');
assert(teacherView.includes('className="teacherQuick teacherTourButton"')&&teacherView.includes('onClick={onStartTutorial}')&&teacherView.includes('Пройти обучение'),'Teacher must have a direct launch button in management');
assert(client.includes('<TeacherView g={g} onStartTutorial={beginTour}'),'Teacher management must launch the existing tour rather than a duplicate tutorial');
assert(dock.includes('data-tour-view={item.key}')&&client.includes('data-tour-view={k}'),'Desktop and mobile need actual spotlight targets');
assert(tour.includes('.mobileDockChat')&&tour.includes('.topChatButton'),'Both chat buttons must be discoverable');
assert(tour.includes('onFallback')&&tour.includes('onSkip'),'Unreachable target and skip paths need controls');
assert(style.includes('pointer-events:auto')&&style.includes('pointer-events:none'),'Overlay must pass pointer events through active hole');
assert(/\.header>button\{[^}]*position:absolute[^}]*place-items:center[^}]*padding:0/.test(style),'Tour close button must stay anchored and clear inherited padding');
assert(/\.header>button>svg\{[^}]*width:19px[^}]*margin:0/.test(style),'Close icon geometry must not inherit offsets');
assert(/\.header\{[^}]*padding-right:48px/.test(style),'Title must reserve room for absolute close button');
assert(/@media\(max-width:600px\)[^\n]*\.header>button\{top:17px;right:18px\}/.test(style),'Mobile close button must match compact card padding');
assert(layout.includes("import './onboarding-tour.css'"),'Initial tutorial choice stylesheet must load');
assert(client.includes("tourMode==='idle'}"),'Time-sensitive blitz must not obscure the guided tour');

assert(tour.includes('clippedRect(el)')&&tour.includes("'.mobileDockScroll,.mobileDockPinned,.mobileAllGrid'"),'Targets outside horizontally scrolling mobile navigation must not count as visible');
assert(tour.includes('dockScroller.scrollBy({left:'),'Guided steps must reveal offscreen dock controls before spotlight placement');
assert(tour.includes('placeTourCard(rect,viewport,cardSize)'),'Tour must position cards from target and viewport geometry');
assert(client.includes("key={mobileMenuOpen?'all-sections':'navigation'}"),'Mobile all-sections sheet must refresh the active spotlight');
assert(client.includes('data-tour-view="chat"')&&client.includes('toggleTourChat()'),'Chat in the mobile menu must advance the tour');
const ts=require('typescript'),vm=require('node:vm');
const compiled=ts.transpileModule(read('components/game/tourPlacement.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const geometryModule={exports:{}};
vm.runInNewContext(compiled,{module:geometryModule,exports:geometryModule.exports});
const {placeTourCard}=geometryModule.exports;
assert.equal(typeof placeTourCard,'function');
function checkPlacement(viewport,target,expectedSide){
 const card=placeTourCard(target,viewport,{width:420,height:420});
 assert.equal(card.side,expectedSide,JSON.stringify({viewport,target,card}));
 const cardHeight=Math.min(420,card.maxHeight);
 assert(card.left>=0&&card.left+card.width<=viewport.width+.01,'Card overflows viewport width');
 assert(card.top>=0&&card.top+cardHeight<=viewport.height+.01,'Card overflows viewport height');
 if(target){
  const overlapWidth=Math.min(card.left+card.width,target.right)-Math.max(card.left,target.left);
  const overlapHeight=Math.min(card.top+cardHeight,target.bottom)-Math.max(card.top,target.top);
  assert(overlapWidth<=0||overlapHeight<=0,'Card obscures active navigation target: '+JSON.stringify({viewport,target,card}));
 }
}
const box=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});
checkPlacement({width:1440,height:900},box(20,200,270,46),'right');
checkPlacement({width:671,height:645},box(15,475,310,46),'right');
for(const [width,height] of [[390,844],[430,932],[360,800]]){
 // A horizontally scrolled dock can expose targets at either edge.
 for(const left of [6,Math.round(width/2)-28,width-62])
  checkPlacement({width,height},box(left,height-62,56,50),'above');
 // All-sections dialog targets are above the dock and require a bounded panel.
 checkPlacement({width,height},box(18,150,102,70),'below');
}
checkPlacement({width:360,height:320},box(15,155,56,48),'above');
checkPlacement({width:390,height:844},null,'center');

console.log('PASS guided route, comic choice, real navigation, replay, mobile, skip, profile gate and nonintrusive overlay');
