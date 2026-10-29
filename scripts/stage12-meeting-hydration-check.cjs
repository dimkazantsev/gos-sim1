/* Real workspace with deferred React effects: checks the early meeting click. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('components/game/Stage12ReadingWorkspace.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
let cursor=0;const hooks=[],effects=[];
const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const react={
 useState(initial){const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,v=>{hooks[i].value=typeof v==='function'?v(hooks[i].value):v}]},
 useRef(value){const i=cursor++;return hooks[i]||(hooks[i]={current:value})},
 useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!equal(hooks[i].deps,deps)){hooks[i]={deps};effects.push(fn)}}
};
const jsx=(type,props)=>({type,props}),icons=new Proxy({},{get:(_,name)=>name});
const context={exports:{},document:{getElementById:()=>({focus(){}})},require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:name==='lucide-react'?icons:name.endsWith('.css')?{__esModule:true,default:new Proxy({},{get:(_,key)=>key})}:{__esModule:true,default:'stub'}};
vm.runInNewContext('(function(exports,require){'+source+'})(exports,require)',context);
const props={g:{formalDocuments:[],game:{id:'game'},me:{user_id:'user'}},stage:{stage_no:12},subjects:[],readOnly:false,onOpenVotes(){}};
function render(){cursor=0;return context.exports.default(props)}
function find(node,predicate){if(Array.isArray(node)){for(const child of node){const found=find(child,predicate);if(found)return found}}else if(node&&typeof node==='object'){if(predicate(node))return node;return find(node.props?.children,predicate)}}
function meeting(tree){return find(tree,n=>n.type==='button'&&String(n.props?.['aria-controls']||'').startsWith('stage12-meeting-'))}
let tree=render();meeting(tree).props.onClick();tree=render();assert.equal(meeting(tree).props['aria-expanded'],true,'Early click opens the meeting');
while(effects.length)effects.shift()();tree=render();assert.equal(meeting(tree).props['aria-expanded'],true,'Initial effects must not undo an early meeting click');
find(tree,n=>n.type==='button'&&n.props?.id==='reading-tab-2').props.onClick();tree=render();while(effects.length)effects.shift()();tree=render();assert.equal(meeting(tree).props['aria-expanded'],false,'Switching the reading still closes the previous meeting');
console.log('PASS: early meeting click survives initial effects; changing reading closes the meeting. Synthetic React scheduling, no network.');
