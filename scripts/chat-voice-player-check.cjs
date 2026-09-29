/* Deterministic voice controls: duration formatting, seek clamp and width
 * regressions complement Chromium layout checks in design:browser. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const path='components/game/ChatVoicePlayer.tsx';
const mod=new Module(path,module);mod.filename=path;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
 jsx:ts.JsxEmit.ReactJSX}
}).outputText,path);
const {voiceClock,voiceProgress}=mod.exports;
assert.equal(voiceClock(0),'0:00');
assert.equal(voiceClock(3.99),'0:03');
assert.equal(voiceClock(63.7),'1:03');
assert.equal(voiceClock(3601),'60:01');
assert.equal(voiceClock(-3),'0:00');
assert.equal(voiceClock(NaN),'0:00');
assert.equal(voiceProgress(3,12),25);
assert.equal(voiceProgress(-20,12),0);
assert.equal(voiceProgress(20,12),100);
assert.equal(voiceProgress(5,0),0);
assert.equal(voiceProgress(5,Infinity),0);
console.log('PASS voice note duration, progress clamping, unknown metadata and longer recordings');
