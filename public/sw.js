/* ГОС.ID PWA — public immutable assets only.
 * Never cache HTML, /game, /teacher, personal data, token-bearing URLs,
 * Supabase REST/Auth/Storage, RSC navigation, or any write.
 */
const CACHE='gos-id-pwa-static-20261027-v1';
const OFFLINE='/offline.html';
const MAX_ASSETS=80;
const PRELOAD=[OFFLINE,'/pwa/icon-192.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRELOAD)));
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('gos-id-pwa-')&&name!==CACHE).map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 if(request.headers.has('authorization'))return;
 // No document responses or flight payloads are ever stored; a disconnected
 // client gets an explicit notice, not stale records from a previous player.
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).catch(async()=>await caches.match(OFFLINE)||Response.error()));
  return;
 }
 const safeStatic=url.search===''&&url.pathname.startsWith('/_next/static/')&&
  ['script','style','font','image'].includes(request.destination);
 if(!safeStatic)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const hit=await cache.match(request);
  if(hit)return hit;
  const response=await fetch(request);
  if(response.ok&&response.type==='basic'&&!response.headers.has('set-cookie')){
   event.waitUntil((async()=>{
    await cache.put(request,response.clone());
    const keys=await cache.keys();
    if(keys.length>MAX_ASSETS)await Promise.all(keys.slice(0,keys.length-MAX_ASSETS).map(key=>cache.delete(key)));
   })());
  }
  return response;
 })());
});
