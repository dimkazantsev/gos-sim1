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
// Public link previews must be served from this same GitHub Pages domain,
// not from the separate Vercel deployment. Test the exported HTML and bytes.
const html=readFileSync(join(out,'index.html'),'utf8');
const pagesOrigin='https://dimkazantsev.github.io';
const pagesUrl=pagesOrigin+base+'/';
const imageBaseUrl=pagesOrigin+base+'/share/gos-id-preview.jpg';
const previewUrl=imageBaseUrl+'?v=20261013-1';
const imagePath=join(out,'share/gos-id-preview.jpg');
assert.ok(existsSync(imagePath),'Approved share image must be exported to GitHub Pages');
const jpeg=readFileSync(imagePath);
assert.ok(jpeg.length>20000&&jpeg[0]===0xff&&jpeg[1]===0xd8,'Social preview must be a nonempty JPEG');
for(const [type,value] of [['property="og:image"',previewUrl],['name="twitter:image"',previewUrl],['property="og:url"',pagesUrl]]){
 assert.ok(html.includes(type),'Missing social tag '+type);
 assert.ok(html.includes(value),'Missing GitHub Pages social URL '+value);
}
assert.ok(!html.includes('https://gos-sim1.vercel.app/share/gos-id-preview.jpg'),
 'Social preview must not point to Vercel on GitHub Pages');
// The site root (including links without the trailing slash or with ?section)
// must include one unambiguous preview at the very start of <head>.
const rootHead=html.slice(0,html.indexOf('</head>'));
assert.ok(html.includes('<head>')&&rootHead.endsWith('</head>')===false,'Expected a real head');
for(const [kind,name,value] of [
 ['property','og:title','ГОС.ID — Цифровая платформа России'],
 ['property','og:description','Моделирование работы органов публичной власти России, подготовка законов и принятие государственных решений.'],
 ['property','og:image',previewUrl],
 ['property','og:image:secure_url',previewUrl],
 ['name','twitter:card','summary_large_image'],
 ['name','twitter:image',previewUrl]
]){
 const tag=kind+'="'+name+'"';
 assert.equal(rootHead.split(tag).length-1,1,'Expected exactly one root '+name);
 assert.ok(rootHead.includes(tag+' content="'+value+'"'),'Wrong root '+name);
}
assert.ok(rootHead.indexOf('property="og:image"')<3500,'Root image preview must be at beginning of <head>');
assert.ok(rootHead.includes('<title>ГОС.ID — Цифровая платформа России</title>'),'Correct root page title');
// Fresh social entry isolates new previews from old messenger URL caches.
const visitHtml=readFileSync(join(out,'visit/index.html'),'utf8');
const visitUrl=pagesUrl+'visit/';
for(const [tag,value] of [
 ['property="og:url"',visitUrl],
 ['property="og:title"','ГОС.ID — Цифровая платформа России'],
 ['property="og:description"','Моделирование работы органов публичной власти России'],
 ['property="og:image"',imageBaseUrl],
 ['property="og:image:secure_url"',imageBaseUrl],
 ['property="og:image:type"','image/jpeg'],
 ['property="og:image:width"','1200'],
 ['property="og:image:height"','632'],
 ['name="twitter:card"','summary_large_image']
])assert.ok(visitHtml.includes(tag)&&visitHtml.includes(value),'Invalid social entry: '+tag);
assert.ok(visitHtml.includes('window.location.replace('),'Social entry must forward browsers to the game');
assert.ok(!/симулятор/i.test(visitHtml),'Public sharing text must not use old branding');
assert.ok(html.includes('Цифровая платформа России'),'Root social title must be current');
// Sharing from the live game must use the same preview entry for every section.
const gameClient=readFileSync(join(root,'components/GameClient.tsx'),'utf8');
assert.ok(gameClient.includes("u.pathname='/gos-sim1/visit/'"),'Pages sharing must use the preview route');
assert.ok(gameClient.includes("u.searchParams.set('section',currentScreen.view)"),'Preserve section deep links');
for(const parameter of ['stage','document','vote'])
 assert.ok(gameClient.includes("u.searchParams.set('"+parameter+"'"),'Preserve shared '+parameter+' context');
assert.ok(gameClient.includes('alt="QR-код ссылки на текущий раздел ГОС.ID"'),'Share dialog must contain a branded QR code');
// Query strings do not select another HTML file on GitHub Pages; confirm the
// entry for ?section=dashboard is the same index.html with a real OG image.
assert.ok(html.includes('property="og:image"')&&html.includes(previewUrl),
 'Root ?section=dashboard links must retain an absolute OG preview');
// Meta crawlers such as WhatsApp may ignore Open Graph tags outside <head>.
// Searching the whole HTML (the previous test) was not sufficient.
for(const [name,document] of [['root',html],['visit',visitHtml]]){
 const end=document.indexOf('</head>');
 assert.ok(end>=0,name+' missing </head>');
 const head=document.slice(0,end);
 for(const field of ['property="og:title"','property="og:description"','property="og:image"','name="twitter:card"'])
  assert.ok(head.includes(field),name+' must expose '+field+' within <head>');
}
const fallback=readFileSync(join(out,'404.html'),'utf8');
assert.ok(fallback.includes('window.location.replace(base+"/?game="'),'Legacy dynamic game routes should redirect to static game entry.');
assert.ok(fallback.includes('^[0-9a-f]{8}'),'Only UUID game routes may redirect.');
for(const name of ['.nojekyll','models/facefinder.bin','portable/template.html','portable/engine.mjs','portable/server.mjs','event-comics/atlas-main.webp','event-comics/atlas-extra.webp','auth/update-password/index.html'])assert.ok(existsSync(join(out,name)),name);
const scenes=readdirSync(join(root,'public/event-comics')).filter(x=>/^scene-.*\.svg$/.test(x));
for(const name of scenes)assert.ok(existsSync(join(out,'event-comics',name)),name);
for(const name of ['components/StaticLanding.tsx','components/game/ProfileSecurityPanel.tsx'])assert.ok(readFileSync(join(built,name),'utf8').includes(JSON.stringify(base+'/auth/update-password/')),'Recovery redirect: '+name);
assert.ok(readFileSync(join(built,'components/StaticLanding.tsx'),'utf8').includes(base+'/?game='),'Dynamic game entry must use the static route.');
const documents=readFileSync(join(built,'components/game/DocumentsView.tsx'),'utf8');
assert.ok(!documents.includes("fetch('/api/"),'A static host cannot serve document POST requests.');
assert.ok(documents.includes('NEXT_PUBLIC_GAME_API_ORIGIN'),'Use the shared API for PDF/DOCX extraction.');
const telegram=readFileSync(join(built,'components/game/TelegramConnection.tsx'),'utf8');
assert.ok(telegram.includes('NEXT_PUBLIC_GAME_API_ORIGIN'),'Telegram activation must use the shared server API; GitHub Pages cannot handle POST.');
assert.ok(!telegram.includes("fetch('/api/telegram/"),'Telegram must not POST to a relative static-host API route.');

assert.ok(existsSync(join(built,'data/region-paths.json')),'Shared region data');
assert.ok(!readFileSync(join(built,'components/game/portableSession.ts'),'utf8').includes("asset('/portable/"),'Portable assets need the repository prefix.');
console.log(`PASS ${refs.size} HTML asset links, ${scenes.length} scenes, dynamic game entry, recovery route, document attachments and portable files.`);
