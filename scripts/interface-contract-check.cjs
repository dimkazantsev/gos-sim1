const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
require.extensions['.css']=module=>{module.exports={}};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),EventComic=require('../components/game/EventComic').default;
const cases=['events-v3-authority.json','events-legal-2026.json'].flatMap(file=>JSON.parse(fs.readFileSync(path.join(root,'content',file),'utf8')));
const clipIds=new Set(),rasterPaths=new Set();
for(const c of cases){
 const html=renderToStaticMarkup(React.createElement(EventComic,{title:c.title,category:c.category,caseKey:c.case_key,scene:c.comic_scene,silent:true}));
 if(html.includes('cinematicRaster')){
  assert.match(html,/width="1920"/,c.case_key+': full resolution width');
  assert.match(html,/height="1080"/,c.case_key+': 16:9 image height');
  assert.match(html,/-480.webp 480w/,c.case_key+': phone encoding');
  assert.match(html,/-960.webp 960w/,c.case_key+': tablet encoding');
  const src=html.match(/src="([^"]+1920.webp)"/)[1];
  assert.ok(!rasterPaths.has(src),c.case_key+': every situation must own its artwork');
  rasterPaths.add(src);
  for(const width of [480,960,1920]){
   const file=path.join(root,'public',src.replace(/.*?(\/event-art\/)/,'$1').replace('1920.webp',width+'.webp'));
   assert.ok(fs.existsSync(file),c.case_key+': encoding must be deployed');
   const bytes=fs.readFileSync(file);
   assert.ok(bytes.length>100,c.case_key+': encoding must not be empty');
   assert.equal(bytes.toString('ascii',0,4),'RIFF',c.case_key+': valid WebP container');
   assert.equal(bytes.toString('ascii',8,12),'WEBP',c.case_key+': valid WebP format');
  }
  continue;
 }
 assert.match(html,/<clipPath[^>]*>[\s\S]*?<rect/,c.case_key+': artwork must explicitly clip its own scene');
 assert.match(html,/clip-path="url\(#/,c.case_key+': clipping must be applied to the image');
 assert.match(html,/viewBox="0 0 /,c.case_key+': independent case viewport');
 clipIds.add(html.match(/<clipPath id="([^"]+)/)[1]);
}
assert.equal(clipIds.size+rasterPaths.size,200,'Every case has its own independent artwork');
console.log('PASS All 200 case illustrations are independent; '+rasterPaths.size+' use responsive cinematic artwork');

const budgetCases=require('../content/budget-cases-2026.json');
const budgetArtPaths=new Set();
for(const c of budgetCases){
 const html=renderToStaticMarkup(React.createElement(EventComic,{title:c.title,category:c.category,caseKey:c.case_key,scene:c.comic_scene,silent:true}));
 assert(html.includes(c.title),'Budget case retains its own title');
 if(html.includes('cinematicRaster')){
  assert(html.includes('data-case="'+c.case_key+'"'),'Artwork belongs to this financial case');
  assert.match(html,/width="1920" height="1080"/);
  const src=html.match(/<img src="([^"]+)"/)[1];
  assert(!budgetArtPaths.has(src),'Financial cases must not share artwork');
  budgetArtPaths.add(src);
 }else{
  assert.match(html,/УЧЕБНОЕ ФИНАНСОВОЕ ДЕЛО/);
  assert(!html.includes('event-art'),'Unillustrated dossier does not borrow another case image');
 }
}
console.log('PASS 14 financial cases retain their identity; '+budgetArtPaths.size+' have individual cinematic artwork');
