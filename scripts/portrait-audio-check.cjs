/* Algorithm checks. Browser decoding, upload interaction and audible playback remain separate checks. */
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),sharp=require('sharp');
function load(file,dependencies={}){const module={exports:{}};const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',js)(name=>dependencies[name],module,module.exports);return module.exports}
const pico=load('lib/vendor/pico.js'),portrait=load('components/game/avatarCrop.ts',{'@/lib/vendor/pico':pico});
for(const [width,height,face] of [[400,900],[900,400],[500,500,{x:180,y:150,width:100,height:130}],[500,300,{x:0,y:0,width:120,height:120}],[300,500,{x:180,y:380,width:100,height:100}]]){
 const b=portrait.portraitBounds(width,height,face);assert(Number.isFinite(b.size)&&b.size>0);assert(b.x>=0&&b.y>=0&&b.x+b.size<=width+.001&&b.y+b.size<=height+.001);
 if(face)assert(face.x+face.width/2>=b.x&&face.x+face.width/2<=b.x+b.size);
}
const source=fs.readFileSync('components/game/ComicSoundButton.tsx','utf8');
const score=new Function('return function score(ctx){'+source.split('function score(ctx:AudioContext){')[1].split('async function start')[0])();
let samples;
score({sampleRate:44100,createBuffer(channels,length,rate){assert.equal(channels,2);assert.equal(length/rate,36);samples=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:i=>samples[i]}}});
for(const channel of samples){assert(channel.every(Number.isFinite));assert(Math.abs(channel[0]-channel[channel.length-1])<.001);assert(channel.every(v=>Math.abs(v)<.3));assert(channel.some(v=>Math.abs(v)>.02))}
(async()=>{
 const fixture=process.argv[2];
 if(fixture){
  const {data,info}=await sharp(fixture).resize({width:480,height:480,fit:'inside'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const pixels=new Uint8Array(info.width*info.height);for(let i=0;i<pixels.length;i++)pixels[i]=(data[i*info.channels]*2+data[i*info.channels+1]*7+data[i*info.channels+2])/10;
  const model=pico.unpack_cascade(new Int8Array(fs.readFileSync('public/models/facefinder.bin')));
  const faces=pico.cluster_detections(pico.run_cascade({pixels,nrows:info.height,ncols:info.width,ldim:info.width},model,{shiftfactor:.06,minsize:28,maxsize:Math.min(info.height,info.width),scalefactor:1.08}),.2).filter(f=>f[3]>50);
  assert(faces.some(([row,col,size])=>row>150&&row<400&&col>150&&col<400&&size>80),'Bundled Detector Must Find The Reference Face');
  const blank=pico.run_cascade({pixels:new Uint8Array(info.width*info.height),nrows:info.height,ncols:info.width,ldim:info.width},model,{shiftfactor:.06,minsize:28,maxsize:Math.min(info.height,info.width),scalefactor:1.08});
  assert.equal(blank.length,0,'Blank Image Must Not Produce A Face');
  console.log('PASS: Bundled Face Model Detects Reference Portrait.');
 }
 console.log('PASS: Portrait Bounds, Edge Cases, 36-Second Stereo Sound, Finite Samples, Smooth Loop Boundary.');
})().catch(e=>{console.error(e);process.exit(1)});
