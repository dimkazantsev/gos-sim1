// Prepare one unambiguous, crawler-visible social head for the exported
// GitHub Pages entry. The live game, routes, and Next metadata are unchanged.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const output=resolve(import.meta.dirname,'../.pages-build/out/index.html');
const base=process.env.PAGES_BASE_PATH||'/gos-sim1';
assert.match(base,/^\/[A-Za-z0-9._-]+$/);
const publicUrl='https://dimkazantsev.github.io'+base+'/';
const title='ГОС.ID — Цифровая платформа России';
const description='Моделирование работы органов публичной власти России, подготовка законов и принятие государственных решений.';
const imageUrl=publicUrl+'share/gos-id-preview.jpg?v=20261013-1';
const raw=readFileSync(output,'utf8');
assert.ok(raw.includes(title),'Expected approved social title in Next output');
assert.ok(raw.includes(publicUrl+'share/gos-id-preview.jpg'),'Expected approved preview in Next output');
const encode=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const tags=[
 ['name','description',description],
 ['property','og:type','website'],
 ['property','og:locale','ru_RU'],
 ['property','og:site_name','ГОС.ID'],
 ['property','og:url',publicUrl],
 ['property','og:title',title],
 ['property','og:description',description],
 ['property','og:image',imageUrl],
 ['property','og:image:secure_url',imageUrl],
 ['property','og:image:type','image/jpeg'],
 ['property','og:image:width','1200'],
 ['property','og:image:height','632'],
 ['property','og:image:alt',title],
 ['name','twitter:card','summary_large_image'],
 ['name','twitter:title',title],
 ['name','twitter:description',description],
 ['name','twitter:image',imageUrl]
];
const headLines=[
 '<title>'+encode(title)+'</title>',
 '<link rel="canonical" href="'+encode(publicUrl)+'">',
 ...tags.map(([kind,name,value])=>'<meta '+kind+'="'+name+'" content="'+encode(value)+'">')
];
let html=raw.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi,'');
html=html.replace(/<meta\b[^>]*>/gi,tag=>{
 const name=tag.match(/\b(?:property|name)=["']([^"']+)["']/i)?.[1];
 return name&&(name==='description'||name.startsWith('og:')||name.startsWith('twitter:'))?'':tag;
});
html=html.replace(/<link\b[^>]*>/gi,tag=>/\brel=["']canonical["']/i.test(tag)?'':tag);
assert.ok(html.includes('<head>'),'Expected exported HTML head');
html=html.replace('<head>','<head>'+headLines.join(''));
const head=html.split('</head>',1)[0];
for(const [kind,name] of tags){
 const pattern=kind+'="'+name+'"';
 assert.equal(head.split(pattern).length-1,1,'Unique preview tag: '+name);
}
assert.ok(head.indexOf('property="og:image"')<3500,'Preview must be early in the HTML head');
assert.ok(!head.includes('gos-sim1.vercel.app/share/'),'Pages must not reference Vercel for social images');
writeFileSync(output,html);
console.log('PASS GitHub Pages root social metadata placed at the start of <head>.');
