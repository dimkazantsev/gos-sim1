const assert=require('node:assert/strict');
const Module=require('node:module');
const fs=require('node:fs');
const ts=require('typescript');
const file='components/game/voiceWaveform.ts';
const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const {VOICE_BARS,voiceWaveformFromSamples,normalizeVoiceWaveform}=mod.exports;
assert.equal(VOICE_BARS,36);
const quiet=new Float32Array(3600);
const loud=new Float32Array(3600);
for(let i=1200;i<2400;i++)loud[i]=Math.sin(i/20)*.6;
const wave=voiceWaveformFromSamples([loud]);
assert.equal(wave.length,36);
assert(wave.every(v=>v>=18&&v<=100));
assert(wave[16]>wave[2],'Measured loud segment must render taller than silence');
assert(wave[16]>wave[33],'Trailing silence is not presented as sound');
const silent=voiceWaveformFromSamples([quiet]);
assert(silent.every(v=>v===18),'Silent recording remains visually quiet');
assert.equal(normalizeVoiceWaveform([]),null);
assert.equal(normalizeVoiceWaveform(Array(36).fill(NaN)),null);
assert.equal(normalizeVoiceWaveform(Array(36).fill(35))?.length,36);
console.log('PASS measured 36-bar RMS waveform, silence, finite normalization and legacy fallback');
