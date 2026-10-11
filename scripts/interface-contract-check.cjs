const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
require.extensions['.css']=module=>{module.exports={}};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const EventComic=require('../components/game/EventComic').default;
const {resolveSituationIcon,SITUATION_ICON_COMBINATIONS}=require('../components/game/SituationIcon');
const cases=['events-v3-authority.json','events-legal-2026.json'].flatMap(file=>JSON.parse(fs.readFileSync(path.join(root,'content',file),'utf8')));
assert.equal(cases.length,200,'Expected authored 200-case fixture');
assert.equal(SITUATION_ICON_COMBINATIONS,324,'18 thematic groups by 18 modifiers');
const fingerprints=new Set();
function assertLocalIcon(c){
 const html=renderToStaticMarkup(React.createElement(EventComic,{title:c.title,category:c.category,caseKey:c.case_key,scene:c.comic_scene,silent:true}));
 assert.match(html,/class="eventComic eventPanelIllustration situationSymbol/,c.case_key+': local icon');
 assert(html.includes('data-case="'+c.case_key+'"'),c.case_key+': icon belongs to this case');
 assert(!/<(?:img|image|video|source)\\b/i.test(html),c.case_key+': no bitmap or external imagery');
 assert(!/event-art|event-comics|cinematicRaster|srcSet|<use\\b|href=/.test(html),c.case_key+': no illustration fetch');
 assert.equal((html.match(/<svg\\b/g)||[]).length,2,c.case_key+': local primary and modifier glyphs');
 assert(resolveSituationIcon(c.case_key,c.title,c.category).key,c.case_key+': stable topic mapping');
 const signature=html.match(/data-icon-fingerprint="([^"]+)"/)?.[1];
 assert(signature,c.case_key+': stable fingerprint');
 return signature;
}
for(const c of cases){
 const signature=assertLocalIcon(c);
 assert(!fingerprints.has(signature),c.case_key+': unique stable identity');
 fingerprints.add(signature);
}
console.log('PASS 200 authored cases use locally rendered vector symbols without image requests');
const budgetCases=require('../content/budget-cases-2026.json');
for(const c of budgetCases)assertLocalIcon(c);
console.log('PASS '+budgetCases.length+' budget scenarios also use local vectors');
