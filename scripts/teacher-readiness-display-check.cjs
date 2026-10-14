/* Deterministic, network-free rendering regression for the teacher's compact readiness card. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const originalResolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){
 return originalResolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args);
};
require.extensions['.css']=module=>{module.exports={}};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>{
 module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}
 }).outputText,file);
};
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const StageReadinessPanel=require('../components/game/StageReadinessPanel').default;
const game={id:'test-game'};
const base={g:{game,teacher:true,setError:()=>{}},stageNo:1,compact:true,onCompactRefresh:()=>{}};
const ready={stage_no:1,ready:true,blockers:[],warnings:[],metrics:{}};
const blocked={...ready,ready:false,blockers:['Не зарегистрирован устав партии.']};
const warned={...ready,warnings:['Требуется уточнение состава.']};
function render(props){return renderToStaticMarkup(React.createElement(StageReadinessPanel,{...base,...props}));}
const unchecked=render({});
assert.match(unchecked,/Проверка ещё не выполнялась/);
assert.match(unchecked,/Перепроверить/);
const ok=render({compactChecked:true,compactReadiness:ready});
assert.match(ok,/Этап процедурно готов/);
assert.match(ok,/Перепроверить/);
const notReady=render({compactChecked:true,compactReadiness:blocked});
assert.match(notReady,/Есть незавершённые процедуры/);
assert.match(notReady,/Не зарегистрирован устав партии/);
const warning=render({compactChecked:true,compactReadiness:warned});
assert.match(warning,/Готово с замечаниями/);
const failed=render({compactChecked:true,compactError:'RPC недоступен'});
assert.match(failed,/Не удалось проверить готовность/);
assert.match(failed,/RPC недоступен/);
assert.match(failed,/role="alert"/);
const pending=render({compactLoading:true});
assert.match(pending,/Проверяем готовность/);
assert.match(pending,/disabled=""/);
assert.match(render({compactChecked:true}),/Нет данных о готовности этапа/);
// The teacher manager must pass its single bulk-RPC snapshot into this card.
const manager=fs.readFileSync(path.join(root,'components/game/TeacherStageManager.tsx'),'utf8');
assert.match(manager,/supabase\.rpc\('get_game_readiness'/);
assert.match(manager,/compactReadiness=\{selectedReady\}/);
assert.match(manager,/compactChecked=\{readinessChecked\}/);
assert.match(manager,/onCompactRefresh=\{\(\)=>void refreshReadiness\(\)\}/);
const teacher=fs.readFileSync(path.join(root,'components/game/TeacherView.tsx'),'utf8');
assert.doesNotMatch(teacher,/teacherCommandStatus|ХОД ОТКРЫТ/);
console.log('PASS teacher compact readiness: unchecked, ready, blocked, warning, RPC failure, loading, missing data, shared refresh and no duplicate status');
