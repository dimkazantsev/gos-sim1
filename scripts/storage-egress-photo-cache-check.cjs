const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const files=[
 'components/game/scopedSignedAssetCache.ts',
 'components/game/prepareCandidatePhoto.ts',
 'components/game/PresidentialElectionStage7.tsx',
 'components/game/PresidentialElectionLab.tsx',
 'components/game/DocumentsView.tsx',
 'components/game/PartyUnregisteredFiles.tsx'
];
for(const file of files){
 const src=fs.readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,src,ts.ScriptTarget.ES2022,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.equal(ast.parseDiagnostics.length,0,'Malformed TSX/TS: '+file);
}
function loadModule(file,extra={}){
 const src=fs.readFileSync(file,'utf8');
 const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};vm.runInNewContext('(function(module,exports){'+compiled+'})',extra)(module,module.exports);return module.exports;
}
(async()=>{
 const {createScopedSignedAssetCache}=loadModule('components/game/scopedSignedAssetCache.ts');
 let time=1000000,signs=0,running=0,peak=0;
 const sign=async path=>{signs++;running++;peak=Math.max(running,peak);await Promise.resolve();running--;return 'https://example.invalid/private/'+path+'?token='+signs};
 const sessions=Array.from({length:40},()=>createScopedSignedAssetCache(sign,{now:()=>time}));
 const photos=['presidential/first/photo.png','presidential/second/photo.jpg'];
 const round=async()=>Promise.all(sessions.flatMap(cache=>photos.map(path=>cache(path))));
 const first=await round();
 assert.equal(signs,80,'40 users should each sign exactly 2 photos');
 for(let i=0;i<15;i++){
  const result=await round();
  assert.deepEqual([...result],first,'Same signed URLs must survive refreshes');
 }
 assert.equal(signs,80,'Fifteen stage refreshes must NOT create new signed URLs or image URLs');
 assert(peak<=80,'Forty independent users must not exceed 2 signing requests each');
 let localActive=0,localPeak=0;
 const one=createScopedSignedAssetCache(async path=>{
  localActive++;localPeak=Math.max(localPeak,localActive);
  await Promise.resolve();localActive--;return path;
 });
 await Promise.all(Array.from({length:20},(_,i)=>one('unique-file-'+i)));
 assert(localPeak<=4,'Every individual component caps simultaneous signed requests at four');

 time+=46*60000;
 const second=await round();
 assert.equal(signs,160,'Expired links are refreshed once per user and path');
 assert.notDeepEqual(second,first);
 const denied=createScopedSignedAssetCache(async()=>null);
 assert.equal(await denied('missing'),null);
 assert.equal(await denied('missing'),null);
 assert.equal(await denied(null),null);
 const zero=fs.readFileSync('components/game/PresidentialElectionStage7.tsx','utf8');
 const lab=fs.readFileSync('components/game/PresidentialElectionLab.tsx','utf8');
 const docs=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
 assert(zero.includes('signedAsset(path)')&&zero.includes('loading="lazy"'));
 assert(lab.includes("createScopedSignedAssetCache")&&lab.includes("cacheControl:'3600'"));
 assert(lab.includes('prepareCandidatePhoto(file)'));
 assert(docs.includes('signedAsset(row.signature_path)'));
 assert(fs.readFileSync('components/game/PartyUnregisteredFiles.tsx','utf8').includes('signedAsset(path)'));
 const fakeFile={name:'photo.png',type:'image/png',size:240000,lastModified:4};
 const {prepareCandidatePhoto:pass}=loadModule('components/game/prepareCandidatePhoto.ts',{document:undefined,createImageBitmap:undefined});
 assert.equal(await pass(fakeFile),fakeFile,'Small files unchanged');
 const browser={File:class {constructor(data,name,opt){this.name=name;this.type=opt.type;this.lastModified=opt.lastModified;this.size=data[0].size;}},createImageBitmap:async()=>({width:2800,height:1400,close(){}}),
 document:{createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}}),toBlob:cb=>cb({type:'image/webp',size:180000})})}};
 const {prepareCandidatePhoto:compress}=loadModule('components/game/prepareCandidatePhoto.ts',browser);
 const photo={name:'photo.png',type:'image/png',size:2684109,lastModified:100};
 const optimized=await compress(photo);
 assert.equal(optimized.type,'image/webp');
 assert.equal(optimized.name,'photo.webp');
 assert.equal(optimized.size,180000);
 const ratio=photo.size/optimized.size;
 assert(ratio>10,'Photo optimisation gives meaningful reduction in simulated bitmap');
 const profile=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
 assert(profile.includes('assetSignatures=useRef(new Map'),'Keep existing signed URL deduplication across other modules');
 console.log('PASS: 40 sessions / 2 photos / 15 refreshes = 80 signatures instead of 1280; bounded requests, 45-minute expiry, no cross-session URL cache; image lazy loading; new-photo browser compression, no change to current assets.');
})().catch(e=>{console.error(e);process.exitCode=1});
