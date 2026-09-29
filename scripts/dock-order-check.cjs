/* Pure ordering contract for the reorderable bottom navigation. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../components/game/MobileDock.tsx'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleForTest=new Module(path.join(__dirname,'../components/game/MobileDock.tsx'),module);
moduleForTest.filename=path.join(__dirname,'../components/game/MobileDock.tsx');
moduleForTest.paths=module.paths;
moduleForTest._compile(compiled,moduleForTest.filename);
const {normalizeDockOrder,moveDockItem}=moduleForTest.exports;
const current=['teacher','dashboard','stages','votes','actions','parties','documents','grades','profile'];
assert.deepEqual(normalizeDockOrder(null,current),current);
assert.deepEqual(normalizeDockOrder(['grades','teacher','grades','not_a_route'],current),
 ['grades','teacher','dashboard','stages','votes','actions','parties','documents','profile']);
assert.deepEqual(normalizeDockOrder(['teacher','grades','profile'],['dashboard','stages','grades','profile']),
 ['grades','profile','dashboard','stages'],'Teacher route must not leak into student preview');
assert.deepEqual(moveDockItem(current,'teacher','profile'),
 ['dashboard','stages','votes','actions','parties','documents','grades','profile','teacher']);
assert.deepEqual(moveDockItem(current,'profile','teacher'),
 ['profile','teacher','dashboard','stages','votes','actions','parties','documents','grades']);
assert.deepEqual(moveDockItem(current,'unknown','teacher'),current);
console.log('PASS dock order: forward/backward moves, deduplication, new routes and role restrictions');
