/* Tests approved ID-only mark, browser JPEG generation, server validation and Telegram upload. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
function compile(path,mocks={}){
 const m=new Module(path,module);m.filename=path;m.paths=module.paths;
 const original=m.require.bind(m);
 m.require=id=>Object.prototype.hasOwnProperty.call(mocks,id)?mocks[id]:original(id);
 m._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText,path);
 return m.exports;
}
const icon=fs.readFileSync('app/icon.svg','utf8');
const avatar=fs.readFileSync('components/game/telegramBotAvatar.ts','utf8');
assert.match(icon,/>ID<\/text>/);
for(const approved of ['#2453e6','font-weight="900"','font-size="76"','letter-spacing="-4"','>ID</text>'])
 assert.ok(icon.includes(approved)&&avatar.includes(approved),'Avatar must use approved ID vector: '+approved);
assert.ok(avatar.includes('canvas.width=1024;canvas.height=1024'),'Full-resolution square avatar required');
assert.ok(avatar.includes("toDataURL('image/jpeg',0.93)"),'Telegram requires fresh JPG bytes');
assert.ok(!avatar.includes('gos-id-preview'),'Never reuse landscape social preview');

const oldDocument=global.document,oldImage=global.Image,oldUrl=global.URL,oldFetch=global.fetch;
const drawing=[];
const fakeJpeg=(width,height)=>{
 const buffer=Buffer.alloc(1100);
 buffer[0]=0xff;buffer[1]=0xd8;
 buffer[2]=0xff;buffer[3]=0xc0;
 buffer.writeUInt16BE(17,4);
 buffer[6]=8;buffer.writeUInt16BE(height,7);buffer.writeUInt16BE(width,9);
 buffer[1098]=0xff;buffer[1099]=0xd9;
 return buffer.toString('base64');
};
const fixture=fakeJpeg(1024,1024);
const svgPath=[];
global.URL={createObjectURL:()=>{svgPath.push('created');return 'blob:gos-id'},revokeObjectURL:()=>svgPath.push('revoked')};
global.Image=class{set src(value){assert.equal(value,'blob:gos-id');this.onload()}}
global.document={createElement:(kind)=>{
 assert.equal(kind,'canvas');
 return {width:0,height:0,
 getContext:()=>({set fillStyle(value){drawing.push('fill:'+value)},fillRect:(...p)=>drawing.push('rect:'+p),drawImage:(...p)=>drawing.push('image:'+p.length)}),
 toDataURL:(type,quality)=>{assert.equal(type,'image/jpeg');assert.equal(quality,0.93);return 'data:image/jpeg;base64,'+fixture}};
}};
const {prepareTelegramBotAvatar}=compile('components/game/telegramBotAvatar.ts');
const present=compile('lib/server/telegramPresentation.ts');
const {telegramSetProfilePhoto}=compile('lib/server/telegram.ts',{
 '@supabase/supabase-js':{createClient:()=>({})},
 './telegramPresentation':present
});
async function run(){
 try{
  const content=await prepareTelegramBotAvatar();
  assert.equal(content,fixture);
  assert.ok(drawing.includes('fill:#2453e6'));
  assert.ok(drawing.includes('rect:0,0,1024,1024'));
  assert.deepEqual(svgPath,['created','revoked']);
  const calls=[];
  global.fetch=async(url,init)=>{
   calls.push({url,init});
   return {ok:true,json:async()=>({ok:true,result:true})};
  };
  await telegramSetProfilePhoto('test-token',content);
  assert.equal(calls.length,1,'Only bot API should be contacted; no fetch of Pages preview');
  assert.ok(calls[0].url.endsWith('/setMyProfilePhoto'));
  assert.equal(JSON.parse(calls[0].init.body.get('photo')).photo,'attach://logo');
  const file=calls[0].init.body.get('logo');
  assert.equal(file.type,'image/jpeg');
  assert.equal(file.name,'gos-id-1024.jpg');
  assert.equal(file.size,1100);
  await assert.rejects(()=>telegramSetProfilePhoto('test-token',fakeJpeg(1200,632)),/1024/);
  await assert.rejects(()=>telegramSetProfilePhoto('test-token','!not-base64!'),/данные/);
  assert.equal(calls.length,1,'Invalid JPG must never be uploaded');
  console.log('PASS ID-only avatar; 1024 JPG browser render, validated Telegram multipart and rejected legacy landscape');
 }finally{global.document=oldDocument;global.Image=oldImage;global.URL=oldUrl;global.fetch=oldFetch}
}
run().catch(e=>{console.error(e);process.exitCode=1});
