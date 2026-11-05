/* ГОС.ID PWA — on-demand, release-versioned public assets only.
 * Stage rules, legal source metadata and reference directories already ship
 * inside hashed JS chunks, cached below. Do NOT duplicate them in IndexedDB.
 * Never cache HTML, /game, /teacher, personal data, signed URLs,
 * Supabase REST/Auth/Storage, RSC navigation, or any write.
 */
const releaseMatch=(self.location.search||'').match(/^\?v=([0-9a-f]{40})$/i);
const CACHE_VERSION=releaseMatch?releaseMatch[1].toLowerCase():'20261106-v2';
const CACHE='gos-id-pwa-static-'+CACHE_VERSION;
const IMAGE_CACHE='gos-id-pwa-public-images-'+CACHE_VERSION;
const BASE=(self.location.pathname||'/sw.js').replace(/\/sw\.js$/,'').replace(/\/$/,'');
const OFFLINE=BASE+'/offline.html';
const MAX_ASSETS=80;
const MAX_PUBLIC_IMAGES=96;
const MAX_PUBLIC_IMAGE_BYTES=750000;
// Preload nothing new: images are fetched and stored only on actual demand.
const PUBLIC_IMAGE_FOLDERS=['/emblems/','/event-art/','/event-comics/','/republic-art/','/medals/','/pwa/'];
const PRELOAD=[OFFLINE,BASE+'/pwa/icon-192.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRELOAD)));
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('gos-id-pwa-')&&name!==CACHE&&name!==IMAGE_CACHE).map(name=>caches.delete(name)));
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
 const safeStatic=url.search===''&&url.pathname.startsWith(BASE+'/_next/static/')&&
  ['script','style','font','image'].includes(request.destination);
 // Public images have no user/session component. The list is an explicit
 // allowlist of repo assets, not a blanket cache of /storage, PDFs or API.
 const publicImage=url.search===''&&request.destination==='image'&&
  PUBLIC_IMAGE_FOLDERS.some(folder=>url.pathname.startsWith(BASE+folder))&&
  /\.(?:svg|png|jpe?g|webp|avif|gif)$/i.test(url.pathname);
 if(!safeStatic&&!publicImage)return;
 event.respondWith((async()=>{
  const cache=await caches.open(publicImage?IMAGE_CACHE:CACHE);
  const hit=await cache.match(request);
  if(hit)return hit;
  const response=await fetch(request);
  const imageLength=publicImage?Number(response.headers.get('content-length')):0;
  // Skip unbounded or oversized responses; don't buffer their bodies to
  // measure them, and never trigger a second network request for caching.
  const bounded=!publicImage||(Number.isFinite(imageLength)&&imageLength>0&&imageLength<=MAX_PUBLIC_IMAGE_BYTES);
  if(response.ok&&response.type==='basic'&&!response.headers.has('set-cookie')&&bounded){
   event.waitUntil((async()=>{
    await cache.put(request,response.clone());
    const keys=await cache.keys();
    const max=publicImage?MAX_PUBLIC_IMAGES:MAX_ASSETS;
    if(keys.length>max)await Promise.all(keys.slice(0,keys.length-max).map(key=>cache.delete(key)));
   })());
  }
  return response;
 })());
});
