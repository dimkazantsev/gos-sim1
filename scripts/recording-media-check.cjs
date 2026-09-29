/* Deterministic unit tests for browser audio/video capture metadata and limits. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const file='components/game/recordingMedia.ts';
const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const {CHAT_MAX_FILE_BYTES,preferredRecordingMime,recordingFileExtension,
 recordingFileName,formatRecordingDuration,uploadedChatKind,inferChatMime}=mod.exports;
assert.equal(CHAT_MAX_FILE_BYTES,25*1024*1024);
assert.equal(preferredRecordingMime('audio',s=>s==='audio/mp4'),'audio/mp4');
assert.equal(preferredRecordingMime('video',s=>s==='video/webm'),'video/webm');
assert.equal(preferredRecordingMime('audio',()=>false),'');
assert.equal(recordingFileExtension('audio/mp4;codecs=mp4a.40.2','audio'),'m4a');
assert.equal(recordingFileExtension('video/mp4','video'),'mp4');
assert.equal(recordingFileExtension('audio/webm;codecs=opus','audio'),'webm');
assert.equal(recordingFileExtension('audio/ogg;codecs=opus','audio'),'ogg');
assert.equal(recordingFileName('audio','audio/mp4',new Date('2026-09-29T03:00:00Z')),
 'audio-2026-09-29T03-00-00-000Z.m4a');
assert.equal(formatRecordingDuration(0),'00:00');
assert.equal(formatRecordingDuration(84),'01:24');
assert.equal(uploadedChatKind('audio/mpeg'),'audio');
assert.equal(uploadedChatKind('video/mp4'),'video');
assert.equal(uploadedChatKind('application/pdf'),'file');
assert.equal(inferChatMime({name:'example.mp4',type:''}),'video/mp4');
assert.equal(inferChatMime({name:'voice.m4a',type:''}),'audio/mp4');
assert.equal(inferChatMime({name:'clip.webm',type:'audio/webm'}),'audio/webm');
console.log('PASS audio/video MIME negotiation, extension matching, elapsed time, 25 MB limit and mobile file type fallback');
