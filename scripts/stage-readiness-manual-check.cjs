/* Readiness must be explicit: no background checks in the stage panel,
 * and each teacher stage transition must run a fresh preflight. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const panel=read('components/game/StageReadinessPanel.tsx');
const game=read('components/game/useRepublicGame.ts');
const teacher=read('components/game/TeacherView.tsx');
const css=read('app/stage-map.css');

assert(!panel.includes('useGameTableSync('),'The readiness panel must not subscribe to background invalidations or polling');
assert(!panel.includes('setInterval('),'The readiness panel must not poll');
assert(!panel.includes('STAGE_REALTIME_TABLES'),'The readiness panel must not subscribe to stage realtime tables');
assert(panel.includes('onClick={()=>void load()}'),'Manual verification button must trigger the RPC');
assert(panel.includes("setChecked(false)"),'Changing stage/game must invalidate the previous result');
assert(panel.includes("'Проверка ещё не выполнялась'"),'Before a manual check, readiness must not appear blocked/ready');
assert(panel.includes("!checked?'unchecked'"),'Unverified stage must have a neutral state');
assert(panel.includes("setChecked(true)"),'Only a completed attempt sets the checked state');
const start=game.indexOf(' async function openStage(stageNo:number){');
const end=game.indexOf(' async function nextStage()',start);
assert(start>=0&&end>start,'Teacher stage transition must be found');
const transition=game.slice(start,end);
const preflight=transition.indexOf("supabase.rpc('get_stage_readiness'");
const change=transition.indexOf("supabase.rpc('set_game_stage'");
assert(preflight>=0&&change>preflight,'Fresh readiness must be fetched before changing the stage');
assert(transition.includes("closing.stage_no!==stageNo"),'Do not preflight reopening the same stage');
assert(transition.includes("typeof verdict.ready!=='boolean'"),'Invalid or failed verification must fail closed');
assert(transition.includes('window.confirm(note+'),'Teacher must explicitly confirm the checked transition');
assert(!teacher.includes("if(window.confirm('Перейти к следующему этапу?"),'Double confirmation must be removed');
assert(css.includes('.stageReadinessWorkspace .stageReadinessGroup li p{font-size:14px'), 'Blockers must be readable');
assert(css.includes('.stageReadinessWorkspace .stageReadinessGroup header small{font-size:12px'), 'Small explanatory labels must be readable');
console.log('PASS manual stage readiness, neutral unverified state, confirmed stage transition and larger text');
