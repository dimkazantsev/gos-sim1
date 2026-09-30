import {cpSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),target=resolve(root,'.pages-build');
rmSync(target,{recursive:true,force:true});mkdirSync(target,{recursive:true});
for(const name of ['app','components','lib','public','package.json','package-lock.json','tsconfig.json','next-env.d.ts'])cpSync(resolve(root,name),resolve(target,name),{recursive:true});
rmSync(resolve(target,'app/game'),{recursive:true,force:true});rmSync(resolve(target,'app/api'),{recursive:true,force:true});
const base=process.env.PAGES_BASE_PATH||'/gos-sim1';
const publicConfig=JSON.parse(readFileSync(resolve(root,'public-client-config.json'),'utf8'));
const clientPath=resolve(target,'lib/supabase.ts');writeFileSync(clientPath,readFileSync(clientPath,'utf8').replace("'build-placeholder-key'",JSON.stringify(publicConfig.publishableKey)));
writeFileSync(resolve(target,'next.config.ts'),`export default {output:'export',basePath:${JSON.stringify(base)},assetPrefix:${JSON.stringify(base)},trailingSlash:true,images:{unoptimized:true}};\n`);
let home=readFileSync(resolve(target,'app/page.tsx'),'utf8');
home=home.replaceAll("router.push('/game/'+r.data)","window.location.assign("+JSON.stringify(base+'/?game=')+"+r.data)");
writeFileSync(resolve(target,'components/StaticLanding.tsx'),home);
writeFileSync(resolve(target,'components/StaticGame.tsx'),`'use client';
import {useSearchParams} from 'next/navigation';
import GameClient from './GameClient';
import Home from './StaticLanding';
export default function StaticGame(){const game=useSearchParams().get('game');return game?<GameClient gameId={game}/>:<Home/>}
`);
writeFileSync(resolve(target,'app/page.tsx'),`import {Suspense} from 'react';import StaticGame from '@/components/StaticGame';export default function Page(){return <Suspense fallback={<p>Загрузка игры…</p>}><StaticGame/></Suspense>};\n`);
// Root-relative assets must resolve under the project path on GitHub Pages.
for(const name of ['EventComic.tsx','ProfileAvatar.tsx','avatarCrop.ts','ComicSoundButton.tsx','portableSession.ts']){
 const file=resolve(target,'components/game',name);let source=readFileSync(file,'utf8');
 for(const prefix of ['/event-comics/','/avatars/','/vendor/','/models/','/audio/','/portable-session/'])source=source.replaceAll("'"+prefix,"'"+base+prefix).replaceAll('"'+prefix,'"'+base+prefix);
 writeFileSync(file,source);
}
let documents=readFileSync(resolve(target,'components/game/DocumentsView.tsx'),'utf8');
documents=documents.replace("const res=await fetch('/api/extract-document',{method:'POST',body:fd});const data=await res.json();", "const data={text:next.type==='text/plain'||next.name.toLowerCase().endsWith('.txt')?(await next.text()).slice(0,120000):'',error:'',pages:0,needsManualText:true};const res={ok:true};");
writeFileSync(resolve(target,'components/game/DocumentsView.tsx'),documents);
writeFileSync(resolve(target,'public/.nojekyll'),'');
console.log('Static application prepared at '+target);
