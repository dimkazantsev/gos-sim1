const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const files=['public/pwa/icon-192.png','public/pwa/icon-512.png','public/pwa/apple-touch-icon.png'];
for(const [i,file] of files.entries()){
 const png=fs.readFileSync(file),size=[192,512,180][i];
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a',file+' PNG header');
 assert.equal(png.readUInt32BE(16),size,file+' width');
 assert.equal(png.readUInt32BE(20),size,file+' height');
}
const manifest=fs.readFileSync('app/manifest.ts','utf8');
for(const frag of ["start_url:'/'","display:'standalone'","'/pwa/icon-192.png'","'/pwa/icon-512.png'","purpose:'maskable'"])assert(manifest.includes(frag),frag);
const layout=fs.readFileSync('app/layout.tsx','utf8');
assert(layout.includes("manifest:'/manifest.webmanifest'")&&layout.includes('<PwaRegistrar/>'));
const sw=fs.readFileSync('public/sw.js','utf8');
for(const frag of ["url.origin!==self.location.origin","request.method!=='GET'","request.headers.has('authorization')","url.search===''","url.pathname.startsWith(BASE+'/_next/static/')","request.mode==='navigate'","MAX_ASSETS=80","cache.put(request,response.clone())"])
 assert(sw.includes(frag),'Missing SW safety: '+frag);
assert(!/cache\.put\(request,.*(?:game|member|votes)/.test(sw));
const listeners={},network=[],storage=new Map(),cacheWrites=[];
const cache={async match(req){return storage.get(typeof req==='string'?req:req.url)},async put(req,resp){cacheWrites.push(req.url);storage.set(req.url,resp)},async keys(){return [...storage.keys()].map(url=>({url}))},async delete(req){storage.delete(req.url)} ,async addAll(urls){for(const url of urls)storage.set(url,{ok:true})}};
const caches={async open(){return cache},async keys(){return ['gos-id-pwa-static-20261027-v1']},async delete(){return true},async match(u){return storage.get(u)}};
const scope={self:{location:{origin:'https://gos-sim1.vercel.app',pathname:'/sw.js'},addEventListener:(name,fn)=>{listeners[name]=fn},clients:{claim:async()=>{}}},caches,URL,Response,fetch:async req=>{network.push(req.url);if(req.fail)throw Error('offline');return{ok:true,type:'basic',headers:new Headers(),clone(){return this}}},Headers,console};
vm.runInNewContext(sw,scope);
const ask=(url,{mode='cors',method='GET',destination='',authorization=false,fail=false}={})=>{
 const request={url,mode,method,destination,fail,headers:new Headers(authorization?{Authorization:'Bearer secret'}:{})};
 let result,extras=[];listeners.fetch({request,respondWith(p){result=p},waitUntil(p){extras.push(p)}});
 return {result,extras};
};
(async()=>{
 const installing=[];listeners.install({waitUntil(p){installing.push(p)}});
 await Promise.all(installing); // Real worker install precaches the generic offline shell.
 for(const url of ['https://bderfrcfuhnutuoyudje.supabase.co/auth/v1/token','https://gos-sim1.vercel.app/api/telegram/dispatch','https://gos-sim1.vercel.app/game/abc']){
  const ev=ask(url);assert.equal(ev.result,undefined,'Private/API not cached '+url);
 }
 const privateRead=ask('https://gos-sim1.vercel.app/game/123',{mode:'navigate'});await privateRead.result;assert.equal(cacheWrites.length,0,'Do not cache navigation');
 const staticReq=ask('https://gos-sim1.vercel.app/_next/static/chunks/hash.js',{destination:'script'});
 await staticReq.result;await Promise.all(staticReq.extras);assert.equal(cacheWrites.length,1);
 const repeat=ask('https://gos-sim1.vercel.app/_next/static/chunks/hash.js',{destination:'script'});await repeat.result;assert.equal(network.length,2,'Only initial static download should hit network after 1 navigation');
 const hasToken=ask('https://gos-sim1.vercel.app/_next/static/chunks/hash.js',{destination:'script',authorization:true});assert.equal(hasToken.result,undefined);
 const tokenQuery=ask('https://gos-sim1.vercel.app/_next/static/chunks/hash.js?token=private',{destination:'script'});assert.equal(tokenQuery.result,undefined);
 const offlinePage=ask('https://gos-sim1.vercel.app/game/123',{mode:'navigate',fail:true});assert((await offlinePage.result).ok,'Only public generic offline shell may appear');
 console.log('PASS PWA 192/512/180 icons, static cache, no private/auth caches, offline fallback');
})().catch(e=>{console.error(e);process.exitCode=1});
