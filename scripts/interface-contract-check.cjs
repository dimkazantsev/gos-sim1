const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),EventComic=require('../components/game/EventComic').default;
const cases=JSON.parse(fs.readFileSync(path.join(root,'content/events-v2.json'),'utf8'));
const clipIds=new Set();
for(const c of cases){
 const html=renderToStaticMarkup(React.createElement(EventComic,{title:c.title,category:c.category,caseKey:c.case_key,scene:c.comic_scene,silent:true}));
 assert.match(html,/<clipPath[^>]*>[\s\S]*?<rect/,c.case_key+': artwork must explicitly clip its own scene');
 assert.match(html,/clip-path="url\(#/,c.case_key+': clipping must be applied to the image');
 assert.match(html,/viewBox="0 0 /,c.case_key+': independent case viewport');
 clipIds.add(html.match(/<clipPath id="([^"]+)/)[1]);
}
assert.equal(clipIds.size,50,'Different case clips cannot collide');
console.log('PASS All 50 illustrations have independent clipped case viewports');
