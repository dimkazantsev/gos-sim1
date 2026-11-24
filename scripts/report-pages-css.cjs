/* Report actual emitted GitHub Pages CSS assets from the existing static build.
 * This script does not fetch, build, modify files, or access user/game data. */
'use strict';
const {readdirSync,readFileSync,existsSync}=require('node:fs');
const {join,resolve,relative}=require('node:path');
const {gzipSync}=require('node:zlib');
const out=resolve(__dirname,'../.pages-build/out');
if(!existsSync(join(out,'index.html')))throw Error('GitHub Pages build output missing');
function files(dir){return !existsSync(dir)?[]:readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
 const path=join(dir,entry.name);return entry.isDirectory()?files(path):[path];
});}
const css=files(join(out,'_next/static')).filter(file=>file.endsWith('.css'));
const html=readFileSync(join(out,'index.html'),'utf8');
// Match actual stylesheet links and CSS preloads in the exported HTML.
function stylesheetHrefs(markup){
 return [...markup.matchAll(/<link\b[^>]*>/g)].map(match=>match[0])
  .filter(tag=>/\brel="stylesheet"/.test(tag)||(/\brel="preload"/.test(tag)&&/\bas="style"/.test(tag)))
  .map(tag=>/\bhref="([^"]+)"/.exec(tag)?.[1]).filter(Boolean);
}
const fixtureHref='/gos-sim1/_next/static/fixture.css';
if(stylesheetHrefs('<link href="'+fixtureHref+'" rel="stylesheet">')[0]!==fixtureHref)
 throw Error('Stylesheet link extraction is broken');
const styles=stylesheetHrefs(html);
const initial=[...new Set(styles.map(href=>{
 const pathname=new URL(href,'https://static.invalid').pathname;
 if(!pathname.startsWith('/gos-sim1/'))throw Error('Unscoped CSS asset: '+pathname);
 const file=join(out,pathname.slice('/gos-sim1/'.length));
 if(!file.endsWith('.css')||!existsSync(file))throw Error('Missing CSS asset: '+pathname);
 return file;
}))];
function report(paths){
 const sizes=paths.map(file=>{
  const data=readFileSync(file);return{path:relative(out,file),bytes:data.byteLength,gzipBytes:gzipSync(data).byteLength};
 }).sort((a,b)=>b.bytes-a.bytes);
 return{files:sizes.length,rawBytes:sizes.reduce((s,x)=>s+x.bytes,0),gzipBytes:sizes.reduce((s,x)=>s+x.gzipBytes,0),largest:sizes.slice(0,5)};
}
console.log('GOS_ID_CSS_ASSETS '+JSON.stringify({initialLinkReferences:styles.length,initialDocument:report(initial),allBuildCss:report(css)}));

const scriptPaths=[...new Set([...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g),...html.matchAll(/<link\b[^>]*>/g)].map(m=>{
 const tag=m[0];
 if(tag.startsWith('<link')&&!(/\brel="(?:preload|modulepreload)"/.test(tag)&&(/\bas="script"/.test(tag)||/\brel="modulepreload"/.test(tag))))return null;
 const url=tag.startsWith('<script')?m[1]:/\bhref="([^"]+)"/.exec(tag)?.[1];
 if(!url)return null;
 const pathname=new URL(url,'https://static.invalid').pathname;
 return pathname.startsWith('/gos-sim1/')&&pathname.endsWith('.js')?join(out,pathname.slice('/gos-sim1/'.length)):null;
}).filter(Boolean))];
for(const path of scriptPaths)if(!existsSync(path))throw Error('Missing initial JavaScript asset '+path);
console.log('GOS_ID_INITIAL_JS_ASSETS '+JSON.stringify(report(scriptPaths)));
