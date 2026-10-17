import {cpSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),target=resolve(root,'.pages-build');
const base=process.env.PAGES_BASE_PATH||'/gos-sim1';
if(!/^\/[A-Za-z0-9._-]+$/.test(base))throw Error('PAGES_BASE_PATH must be a single repository path.');
const publicConfig=JSON.parse(readFileSync(resolve(root,'public-client-config.json'),'utf8'));
let publicKey=publicConfig.publishableKey;
if(!publicKey?.startsWith('sb_publishable_')){
 const payload=JSON.parse(Buffer.from(String(publicKey).split('.')[1]||'','base64url').toString());
 if(payload.role!=='anon')throw Error('Only a publishable key or legacy anon key may be included.');
}
if(publicConfig.url!=='https://bderfrcfuhnutuoyudje.supabase.co')throw Error('Unexpected game database.');
function transform(name,from,to){
 const file=resolve(target,name),source=readFileSync(file,'utf8');
 if(!source.includes(from))throw Error('Static build adapter needs updating: '+name);
 writeFileSync(file,source.replaceAll(from,to));
}
rmSync(target,{recursive:true,force:true});mkdirSync(target,{recursive:true});
for(const name of ['app','components','lib','public','data','package.json','package-lock.json','tsconfig.json','next-env.d.ts','public-client-config.json'])cpSync(resolve(root,name),resolve(target,name),{recursive:true});
rmSync(resolve(target,'app/game'),{recursive:true,force:true});rmSync(resolve(target,'app/api'),{recursive:true,force:true});
transform('lib/supabase.ts',"'build-placeholder-key'",JSON.stringify(publicKey));
writeFileSync(resolve(target,'next.config.ts'),`export default {output:'export',basePath:${JSON.stringify(base)},assetPrefix:${JSON.stringify(base)},trailingSlash:true,images:{unoptimized:true},experimental:{useTypeScriptCli:false}};\n`);
// The GitHub Pages host has a repository subpath; Vercel metadata must not leak
// into social previews sent from https://dimkazantsev.github.io/gos-sim1/.
// Absolute URLs are intentional: Telegram and other crawlers do not resolve
// relative og:image paths against the client-side query-string navigation.
const pagesOrigin='https://dimkazantsev.github.io';
const pagesUrl=pagesOrigin+base+'/';
const pagesImage=pagesOrigin+base+'/share/gos-id-preview.jpg';
transform('app/layout.tsx',
 "metadataBase:new URL('https://gos-sim1.vercel.app'),",
 'metadataBase:new URL('+JSON.stringify(pagesOrigin+base)+'),');
transform('app/layout.tsx',
 "const socialPreview='/share/gos-id-preview.jpg';",
 'const socialPreview='+JSON.stringify(pagesImage)+';');
transform('app/layout.tsx',
 "type:'website',locale:'ru_RU',url:'/',siteName:BRAND_NAME,",
 "type:'website',locale:'ru_RU',url:"+JSON.stringify(pagesUrl)+",siteName:BRAND_NAME,");
let home=readFileSync(resolve(target,'app/page.tsx'),'utf8');
// Static Pages uses ?game=... instead of Vercel's /game/:id route.
// Preserve validated Telegram section/deep-link parameters on every transition.
for(const [method,target] of [
 ['push','r.data'],['push','resumedGameId'],
 ['replace','rows.data[0].game_id'],['replace','String(resume.data)']
]){
 const original="router."+method+"('/game/'+"+target+"+incomingSectionSuffix())";
 if(!home.includes(original))throw Error('Static game entry adapter is missing: '+original);
 home=home.replaceAll(original,
  "window.location.assign("+JSON.stringify(base+'/?game=')+"+"+target+
  "+(incomingSectionSuffix()?'&'+incomingSectionSuffix().slice(1):''))");
}
home=home.replaceAll('href="/"','href='+JSON.stringify(base+'/'));
writeFileSync(resolve(target,'components/StaticLanding.tsx'),home);
writeFileSync(resolve(target,'components/StaticGame.tsx'),`'use client';
import {useSearchParams} from 'next/navigation';
import GameClient from './GameClient';
import Home from './StaticLanding';
export default function StaticGame(){const game=useSearchParams().get('game');return game?<GameClient key={game} gameId={game}/>:<Home/>}
`);
writeFileSync(resolve(target,'app/page.tsx'),`import {Suspense} from 'react';import StaticGame from '@/components/StaticGame';export default function Page(){return <Suspense fallback={<p>Загрузка игры…</p>}><StaticGame/></Suspense>};\n`);
// Root-relative assets must resolve under the project path on GitHub Pages.
for(const name of ['EventComic.tsx','ProfileAvatar.tsx','avatarCrop.ts','ComicSoundButton.tsx','portableSession.ts']){
 const file=resolve(target,'components/game',name);let source=readFileSync(file,'utf8');
 for(const prefix of ['/event-comics/','/avatars/','/vendor/','/models/','/audio/','/portable/'])source=source.replaceAll("'"+prefix,"'"+base+prefix).replaceAll('"'+prefix,'"'+base+prefix);
 writeFileSync(file,source);
}
// Document extraction/import uses the same authorised API as the live app.
for(const name of ['components/GameClient.tsx','components/PublicScreen.tsx'])transform(name,'href="/"','href='+JSON.stringify(base+'/'));
transform('components/game/SessionManager.tsx',"window.location.assign('/')",'window.location.assign('+JSON.stringify(base+'/')+')');
// Both StaticLanding (derived from app/page.tsx) and ProfileSecurityPanel now
// direct password recovery to the application server. Do not rewrite that
// callback to the static GitHub Pages origin: it cannot serve dynamic recovery.
writeFileSync(resolve(target,'public/.nojekyll'),'');
const staticTsconfig=JSON.parse(readFileSync(resolve(target,'tsconfig.json'),'utf8'));
staticTsconfig.exclude=['node_modules','production-app'];writeFileSync(resolve(target,'tsconfig.json'),JSON.stringify(staticTsconfig,null,2)+'\n');
console.log('Static application prepared at '+target);
