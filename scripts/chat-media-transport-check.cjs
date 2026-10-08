/* Deterministic tests for recording-to-storage-to-chat publication and retry. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const file='components/game/chatMediaTransport.ts';
const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const {sendChatMedia}=mod.exports;
const blob=new Blob(['valid media bytes'],{type:'audio/webm;codecs=opus'});
function input(overrides={}){
 let n=0;const calls={uploads:[],inserts:[],exists:[]};const existing=new Set();
 const transport={
  upload:async(path,data,contentType)=>{calls.uploads.push({path,size:data.size,contentType});return{error:null}},
  insert:async row=>{calls.inserts.push(row);existing.add(row.id);return{error:null}},
  exists:async id=>{calls.exists.push(id);return existing.has(id)}
 };
 return{calls,transport,existing,args:{blob,fileName:'voice.webm',mime:'audio/webm;codecs=opus',kind:'audio',gameId:'g',channelId:'c',userId:'u',
  generateId:()=>String(++n),transport,...overrides}};
}
async function run(){
 const success=input();const phases=[];success.args.onPhase=x=>phases.push(x);
 const sent=await sendChatMedia(success.args);
 assert(sent.ok);assert.deepEqual(phases,['uploading','saving']);
 assert.equal(success.calls.uploads[0].contentType,'audio/webm');
 assert.equal(success.calls.inserts[0].mime_type,'audio/webm;codecs=opus');
 assert.equal(success.calls.inserts[0].kind,'audio');
 assert.equal(success.calls.inserts[0].storage_path,success.calls.uploads[0].path);
 console.log('PASS audio blob uploads with bare Storage MIME and publishes original codec metadata');
 const wave=input({voiceMeta:{duration:3.2,waveform:Array(36).fill(45)}});
 const waveSent=await sendChatMedia(wave.args);
 assert(waveSent.ok);
 assert.equal(wave.calls.inserts[0].voice_meta.duration,3.2);
 assert.equal(wave.calls.inserts[0].voice_meta.waveform.length,36);
 console.log('PASS real voice duration and 36 RMS peaks persist in audio message records');
 const retry=input();let insertCount=0;
 retry.transport.insert=async row=>{retry.calls.inserts.push(row);insertCount++;return{error:insertCount===1?{message:'temporary database error'}:null}};
 const first=await sendChatMedia(retry.args);
 assert(!first.ok&&first.stage==='message'&&first.pending);
 assert.equal(retry.calls.uploads.length,1);
 const second=await sendChatMedia({...retry.args,pending:first.pending});
 assert(second.ok);assert.equal(retry.calls.uploads.length,1);
 assert.equal(retry.calls.inserts[0].id,retry.calls.inserts[1].id);
 console.log('PASS failed message insert preserves upload and retries same message UUID without duplicate Storage objects');
 for(const changed of [{gameId:'other-game'},{channelId:'other-channel'},{userId:'other-user'}]){
  const blocked=await sendChatMedia({...retry.args,...changed,pending:first.pending});
  assert(!blocked.ok&&blocked.stage==='validation');
  assert.deepEqual(blocked.pending,first.pending);
  assert.equal(retry.calls.uploads.length,1);
  assert.equal(retry.calls.inserts.length,2);
 }
 console.log('PASS pending uploads stay bound to their original game, channel and author without discarding the recording');
 const uncertain=input();
 uncertain.transport.insert=async row=>{uncertain.existing.add(row.id);throw new Error('network reset after commit')};
 const confirmed=await sendChatMedia(uncertain.args);
 assert(confirmed.ok);assert.equal(uncertain.calls.uploads.length,1);
 assert.equal(uncertain.calls.exists.length,1);
 console.log('PASS network loss after committed insert checks for saved message before retry');
 const rejected=input();rejected.transport.upload=async()=>({error:{message:'permission denied'}});
 const refused=await sendChatMedia(rejected.args);
 assert(!refused.ok&&refused.stage==='upload');
 assert.equal(rejected.calls.inserts.length,0);
 console.log('PASS upload permission failures cannot create broken chat messages');
 const video=input({mime:'video/webm;codecs=vp8,opus',kind:'video',fileName:'video.webm'});
 const movie=await sendChatMedia(video.args);
 assert(movie.ok);assert.equal(video.calls.inserts[0].kind,'video');
 assert.equal(video.calls.uploads[0].contentType,'video/webm');
 console.log('PASS video storage MIME and published message kind');
}
run().catch(e=>{console.error(e);process.exitCode=1});
