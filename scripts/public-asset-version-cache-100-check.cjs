/* ГОС.ID: actual service worker, 100 synthetic browsers, no network.
 * Check cache versioning, bounded public images, and private-data exclusions. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const sw=fs.readFileSync('public/sw.js','utf8');
const registrar=fs.readFileSync('components/PwaRegistrar.tsx','utf8');

assert(registrar.includes("process.env.NEXT_PUBLIC_GOS_RELEASE"),'Use the published release fingerprint');
assert(registrar.includes("process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA"),'Support Vercel commit fingerprints');
assert(registrar.includes("base+'/sw.js'+version"),'Change the SW registration URL when release changes');
assert(registrar.includes("updateViaCache:'none'"),'Do not reuse an old service-worker script');
assert(sw.includes("MAX_PUBLIC_IMAGES=48")&&sw.includes("MAX_PUBLIC_IMAGE_BYTES=500000"),'Bound disk use per device');
assert(!/preloadAll|Promise\.all\(PUBLIC_IMAGE|fetch\(BASE\+'\/event-art/.test(sw),'No bulk illustration preloading');
assert(sw.includes("request.headers.has('authorization')"),'Authorization headers bypass CacheStorage');
assert(sw.includes("url.origin!==self.location.origin"),'Never cache cross-origin or Supabase traffic');

const buildA='a'.repeat(40),buildB='b'.repeat(40);
const BASE='https://example.test/gos-sim1';
const PUBLIC_ART=BASE+'/event-art/scene-001-480.webp';
const OVERSIZED=BASE+'/event-art/scene-large-1920.webp';
const NO_LENGTH=BASE+'/event-art/scene-streaming.webp';
function makeWorker(release,shared=new Map()){
 const listeners=new Map(),counts=new Map();
 function open(name){
  if(!shared.has(name))shared.set(name,new Map());
  const rows=shared.get(name);
  const key=req=>typeof req==='string'?req:req.url;
  return {
   match:async req=>rows.get(key(req)),
   put:async(req,response)=>{rows.set(key(req),response)},
   keys:async()=>[...rows.keys()].map(url=>({url})),
   delete:async req=>rows.delete(key(req)),
   addAll:async urls=>{for(const url of urls)rows.set(url,{ok:true,from:'preload'})}
  };
 }
 const store={
  open:async name=>open(name),
  keys:async()=>[...shared.keys()],
  delete:async name=>shared.delete(name),
  match:async url=>{for(const rows of shared.values())if(rows.has(url))return rows.get(url)}
 };
 const location={origin:'https://example.test',pathname:'/gos-sim1/sw.js',search:'?v='+release};
 const scope={
  self:{location,addEventListener:(name,fn)=>listeners.set(name,fn),clients:{claim:async()=>{}}},
  caches:store,URL,Response,Headers,console,
  fetch:async request=>{
   const url=typeof request==='string'?request:request.url;
   counts.set(url,(counts.get(url)||0)+1);
   const hdr=url.includes('scene-streaming')?{}:
    {'content-length':url.includes('scene-large')?'600000':'58000'};
   return{ok:true,status:200,type:'basic',headers:new Headers(hdr),clone(){return this}};
  }
 };
 vm.runInNewContext(sw,scope);
 async function trigger(name){
  const jobs=[];
  listeners.get(name)({waitUntil:promise=>jobs.push(promise)});
  await Promise.all(jobs);
 }
 async function get(url,{destination='image',mode='cors',method='GET',authorization=false}={}){
  const request={url,destination,mode,method,headers:new Headers(authorization?{authorization:'Bearer REDACTED'}:{})};
  const waits=[];let reply=null;
  listeners.get('fetch')({request,respondWith:promise=>{reply=promise},waitUntil:p=>waits.push(p)});
  if(reply){await reply;await Promise.all(waits)}
  return reply!==null;
 }
 return{trigger,get,counts,shared};
}
async function main(){
 let received=0,disallowed=0;
 for(let i=0;i<100;i++){
  const b=makeWorker(buildA);
  await b.trigger('install');await b.trigger('activate');
  assert.equal(b.counts.size,0,'No images fetched on PWA install');
  for(let t=0;t<8;t++)assert(await b.get(PUBLIC_ART),'Public artwork is intercepted');
  assert.equal(b.counts.get(PUBLIC_ART),1,'Eight visits reuse one network image per browser');
  received+=b.counts.get(PUBLIC_ART);
  for(const url of [
   'https://database.example.supabase.co/storage/v1/object/sign/private.png',
   BASE+'/api/extract-document',BASE+'/game/other-user.png',
   BASE+'/event-art/image.png?token=secret',
   BASE+'/event-art/some.pdf',
   BASE+'/event-art/image.svg?version=1',
   'https://pravo.gov.ru/proxy/ips/?docbody=&nd=102027595'
  ]){
   const handled=await b.get(url);assert.equal(handled,false,'Private, external or unversioned URLs bypass SW: '+url);disallowed++;
  }
  assert.equal(await b.get(BASE+'/event-art/test.webp',{authorization:true}),false);
  assert.equal(await b.get(BASE+'/event-art/test.webp',{method:'POST'}),false);
  assert(await b.get(OVERSIZED));
  assert(await b.get(OVERSIZED));
  assert.equal(b.counts.get(OVERSIZED),2,'Oversized art cannot fill mobile cache');
  assert(await b.get(NO_LENGTH));
  assert(await b.get(NO_LENGTH));
  assert.equal(b.counts.get(NO_LENGTH),2,'Unbounded-length art must not be persisted');
 }
 assert.equal(received,100,'100 synthetic browsers load a public asset once each');
 assert.equal(disallowed,700);

 // A new release removes both previous caches and fetches changed assets once.
 const shared=new Map();
 const old=makeWorker(buildA,shared);
 await old.trigger('install');await old.trigger('activate');
 await old.get(PUBLIC_ART);await old.get(PUBLIC_ART);
 assert.equal(old.counts.get(PUBLIC_ART),1);
 assert([...shared.keys()].every(k=>k.endsWith(buildA)),'Only current-release caches remain');
 const fresh=makeWorker(buildB,shared);
 await fresh.trigger('install');await fresh.trigger('activate');
 assert([...shared.keys()].every(k=>k.endsWith(buildB)),'New release invalidates both old asset caches');
 await fresh.get(PUBLIC_ART);await fresh.get(PUBLIC_ART);
 assert.equal(fresh.counts.get(PUBLIC_ART),1,'Changed release downloads image exactly once');
 assert(![...shared.keys()].some(k=>k.includes(buildA)),'Old version must be deleted');

 // Purely local 48-entry cap, no extra requests or global bulk preloading.
 const bounded=makeWorker(buildA);
 await bounded.trigger('install');await bounded.trigger('activate');
 for(let i=0;i<52;i++)await bounded.get(BASE+'/emblems/sample-'+i+'.png');
 const imageCache=bounded.shared.get('gos-id-pwa-public-images-'+buildA);
 assert.equal(imageCache.size,48,'Public-image disk cache stays within 48 entries');
 console.log('PASS: 100 synthetic clients, 8 repeated uses each: 800 -> 100 public image network fetches.');
 console.log('PASS: SHA-version invalidation, 48-entry/500KB budget, oversize and unknown-length rejection.');
 console.log('PASS: no private/API/external/token-bearing/POST cache, and zero image preloads.');
 console.log('NOTE: synthetic browser fetches only; HTTP cache and real CDN savings not measured.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
