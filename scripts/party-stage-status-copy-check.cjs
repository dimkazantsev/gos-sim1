/* First-stage party copy must follow the actual status, not just availability. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const Module=require('node:module');
const file='components/game/stageWorkStatus.ts';
const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const {isStageWorkOpen,stageWorkLabel}=mod.exports;
const game={id:'game-1',status:'running',turn_open:true,turn_ends_at:null};
const stage={game_id:game.id,stage_no:1,status:'completed',deadline:null};
assert.equal(isStageWorkOpen(game,stage),false);
assert.equal(stageWorkLabel(game,stage),'Этап завершён','Completed has priority over unavailable.');
assert.equal(isStageWorkOpen(game,{...stage,status:'open'}),true);
assert.equal(stageWorkLabel(game,{...stage,status:'open'}),'Этап открыт');
assert.equal(stageWorkLabel(game,{...stage,status:'open',deadline:'2000-01-01'}),'Этап приостановлен');
assert.equal(stageWorkLabel(game,{...stage,status:'locked'}),'Этап ещё не открыт');
assert.equal(stageWorkLabel({...game,turn_open:false},{...stage,status:'open'}),'Этап приостановлен');
const ui=fs.readFileSync('components/game/PartiesView.tsx','utf8');
assert(ui.includes("stageOne?.status==='completed'"),'Detect the completed stage before showing a disabled state.');
assert(ui.includes("stageOne?.status==='open'&&!partyFormationOpen"),'Do not call a paused stage unopened.');
assert(ui.includes("'Этап 01 завершён'"));
assert(ui.includes("'Этап 01 приостановлен'"));
assert(ui.includes("'Этап 01 ещё не открыт'"));
assert(ui.includes('Первый этап завершён. Формирование партий'));
assert(ui.includes('{partyStageNotice}'),'The explanatory paragraph must use the stage state.');
assert(!ui.includes('Работа с партиями откроется после запуска первого этапа преподавателем'),'Unconditional opening text must not remain.');
assert(ui.includes("const canCreate=partyFormationOpen"),'Do not grant creation rights after completion.');
assert(ui.includes("disabled={busy||!partyFormationOpen}"),'Party document uploads stay gated by the existing work window.');
const css=fs.readFileSync('app/globals.css','utf8');
assert(css.includes('.gosPartyStageBadge.isCompleted'),'Completed status receives its own appearance.');
console.log('PASS parties: completed, active, paused and unopened labels; access and uploads unchanged.');
