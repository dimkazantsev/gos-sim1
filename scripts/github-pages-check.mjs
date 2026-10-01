import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),built=join(root,'.pages-build'),out=join(built,'out');
const base=process.env.PAGES_BASE_PATH||'/gos-sim1';
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(join(path,x.name)):[join(path,x.name)])}
const refs=new Set();
for(const file of files(out).filter(x=>x.endsWith('.html'))){
 for(const match of readFileSync(file,'utf8').matchAll(/(?:src|href)="([^"]+)"/g)){
  if(!match[1].startsWith(base+'/'))continue;
  const relative=decodeURIComponent(new URL(match[1],'https://static.invalid').pathname.slice(base.length+1));
  refs.add(relative);assert.ok(existsSync(join(out,relative))||existsSync(join(out,relative,'index.html')),'Missing asset: '+relative);
 }
}
for(const name of ['.nojekyll','models/facefinder.bin','portable/template.html','portable/engine.mjs','portable/server.mjs','event-comics/atlas-main.webp','event-comics/atlas-extra.webp','auth/update-password/index.html'])assert.ok(existsSync(join(out,name)),name);
const scenes=readdirSync(join(root,'public/event-comics')).filter(x=>/^scene-.*\.svg$/.test(x));
for(const name of scenes)assert.ok(existsSync(join(out,'event-comics',name)),name);
for(const name of ['components/StaticLanding.tsx','components/game/ProfileSecurityPanel.tsx'])assert.ok(readFileSync(join(built,name),'utf8').includes(JSON.stringify(base+'/auth/update-password/')),'Recovery redirect: '+name);
assert.ok(readFileSync(join(built,'components/StaticLanding.tsx'),'utf8').includes(base+'/?game='),'Dynamic game entry must use the static route.');
const documents=readFileSync(join(built,'components/game/DocumentsView.tsx'),'utf8');
assert.ok(!documents.includes("fetch('/api/"),'A static host cannot serve document POST requests.');
assert.ok(documents.includes('NEXT_PUBLIC_GAME_API_ORIGIN'),'Use the shared API for PDF/DOCX extraction.');
assert.ok(existsSync(join(built,'data/region-paths.json')),'Shared region data');
assert.ok(!readFileSync(join(built,'components/game/portableSession.ts'),'utf8').includes("asset('/portable/"),'Portable assets need the repository prefix.');
console.log(`PASS ${refs.size} HTML asset links, ${scenes.length} scenes, dynamic game entry, recovery route, document attachments and portable files.`);
