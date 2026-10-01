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
let home=readFileSync(resolve(target,'app/page.tsx'),'utf8');
home=home.replaceAll("router.push('/game/'+r.data)","window.location.assign("+JSON.stringify(base+'/?game=')+"+r.data)");
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
for(const name of ['components/StaticLanding.tsx','components/game/ProfileSecurityPanel.tsx'])transform(name,"window.location.origin+'/auth/update-password'",'window.location.origin+'+JSON.stringify(base+'/auth/update-password/'));
writeFileSync(resolve(target,'public/.nojekyll'),'');
const staticTsconfig=JSON.parse(readFileSync(resolve(target,'tsconfig.json'),'utf8'));
staticTsconfig.exclude=['node_modules','production-app'];writeFileSync(resolve(target,'tsconfig.json'),JSON.stringify(staticTsconfig,null,2)+'\n');
console.log('Static application prepared at '+target);
