/* Story disclosure: actual component effects with fake RPC and Chromium CSS geometry.
   No live Auth, database queries, writes or quotas are consumed. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'components/game/TeacherStoryCampaign.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'components/game/TeacherStoryCampaign.module.css'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(){
 const slots=[],effects=[],calls=[];let cursor=0,tree;
 const status={prepared:true,enabled:true,auto_mode:true,automation_error:null,current_episode:1,
  approved_episodes:2,published_episodes:1,loaded_episodes:24,total_episodes:24,
  metrics_enabled:true,publication_enabled:true,
  episodes:Array.from({length:24},(_,i)=>({episode_no:i+1,stage_no:4,title:'Выпуск '+(i+1),loaded:true,approved:false,published:false}))};
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,change=>{slots[i].value=typeof change==='function'?change(slots[i].value):change}]},
  useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial})},
  useEffect(callback,deps){const i=cursor++,old=slots[i];if(!old||!equal(old.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=callback()})}}
 };
 const jsx=(type,props)=>({type,props});
 const supabase={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='get_story_campaign_teacher')return {data:status,error:null};
  if(name==='get_story_episode_preview_teacher')return {data:{
   episode_no:args.p_episode_no,stage_no:4,title:'Выпуск '+args.p_episode_no,body:'Текст выпуска',
   evidence_rule:'',editor_note:'',approved:false,published:false},error:null};
  throw Error('Unexpected story RPC '+name);
 }};
 const styles=new Proxy({},{get:(_,property)=>String(property)});
 const load=name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};
  if(name==='lucide-react')return {ChevronDown:'icon'};
  if(name==='@/lib/supabase')return {supabase};
  if(name==='@/lib/userError')return {userError:error=>String(error?.message||error)};
  if(name==='./TeacherStoryCampaign.module.css')return {__esModule:true,default:styles};
  if(['./TeacherStorySupplementPanel','./TeacherStoryBranchesPanel','./StoryNewsIllustration'].includes(name))return {__esModule:true,default:name};
  throw Error('Unexpected import: '+name);
 };
 const module={exports:{}};
 vm.runInNewContext('(function(require,module,exports){'+js+'})',{console,Map,Set,Math,Object,Number,Promise,window:{confirm:()=>false}})(load,module,module.exports);
 const walk=(item,predicate,out=[])=>{
  if(Array.isArray(item)){item.forEach(child=>walk(child,predicate,out));return out}
  if(!item||typeof item!=='object')return out;
  if(predicate(item))out.push(item);
  walk(item.props?.children,predicate,out);return out;
 };
 const render=()=>{cursor=0;tree=module.exports.default({gameId:'fixture-game'});for(const effect of effects.splice(0))effect();return tree};
 const settle=async()=>{for(let i=0;i<14;i++){await Promise.resolve();render()}};
 const toggle=()=>walk(tree,item=>item.type==='button'&&item.props?.['aria-controls']==='story-campaign-content')[0];
 const content=()=>walk(tree,item=>item.props?.id==='story-campaign-content')[0];
 const close=()=>{for(const slot of slots)slot?.cleanup?.()};
 render();
 return {render,settle,toggle,content,calls,close};
}
(async()=>{
 const closed=Array.from({length:100},harness);
 assert.equal(closed.reduce((sum,h)=>sum+h.calls.length,0),0,'100 unopened panels use zero story RPCs');
 for(const item of closed)item.close();
 const h=harness();
 assert.equal(h.toggle().props['aria-expanded'],false,'Campaign is collapsed by default');
 assert(h.content()?.props.hidden,'Accessible disclosure target remains mounted and hidden');
 assert.equal(h.calls.length,0,'No campaign requests on Events entry');
 h.toggle().props.onClick();h.render();await h.settle();
 assert.equal(h.toggle().props['aria-expanded'],true);
 assert.equal(h.calls.filter(c=>c.name==='get_story_campaign_teacher').length,1);
 assert.equal(h.calls.filter(c=>c.name==='get_story_episode_preview_teacher').length,1);
 assert.equal(h.content().props.hidden,false);
 h.toggle().props.onClick();h.render();
 assert.equal(h.toggle().props['aria-expanded'],false);
 assert.equal(h.content().props.hidden,true,'Editor remains mounted so unsaved content is not lost');
 assert.equal(h.calls.length,2,'Closing does not refetch');
 h.toggle().props.onClick();h.render();await h.settle();
 assert.equal(h.calls.length,2,'Reopening cached campaign does not refetch');
 h.close();
 const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
 if(!chrome)throw Error('Chromium required for responsive browser check');
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox']});
 try{
  for(const width of [320,390,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:800}});
   await page.setContent('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
    '*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}.surfaceHead{display:flex;justify-content:space-between;gap:14px}'+
    'section.surface{padding:18px;border:1px solid #dce5f0;border-radius:16px}'+css+'</style>'+
    '<section class="surface root"><div class="surfaceHead header"><div class="headerText"><small>ПРЕПОДАВАТЕЛЬ · СОБЫТИЯ</small><h2>Сюжетная кампания</h2><p>24 эпизода · этапы 4–14. Новости и реакции автоматически публикуются по подтверждённым событиям. Преподаватель может исправлять тексты.</p></div><div class="headerControls"><span class="automationStatus">Настройки и выпуски</span><button class="collapseButton" type="button" aria-expanded="false">Развернуть <svg width="18" height="18"></svg></button></div></div></section>');
   const d=await page.evaluate(()=>{
    const root=document.querySelector('section.root'),head=root.querySelector('.header'),button=root.querySelector('button');
    return {rootRight:root.getBoundingClientRect().right,headRight:head.getBoundingClientRect().right,
      buttonRight:button.getBoundingClientRect().right,scrollWidth:document.documentElement.scrollWidth,
      viewport:innerWidth,height:button.getBoundingClientRect().height};
   });
   assert(d.rootRight<=width+1&&d.headRight<=width+1&&d.buttonRight<=width+1&&d.scrollWidth<=width+1,
    'Header overflows at '+width+'px: '+JSON.stringify(d));
   assert(d.height>=44,'Toggle too short at '+width+'px');
   await page.close();
  }
 }finally{await browser.close()}
 console.log(JSON.stringify({result:'PASS',initialRPCsBefore:2,initialRPCsAfter:0,firstExpansionRPCs:2,reopenRPCs:0,closedSyntheticPanels:100,screenWidths:[320,390,768,1024,1440],scope:'Synthetic RPC instrumentation and real Chromium CSS fixture; not a live 100-player test'}));
})().catch(error=>{console.error(error);process.exitCode=1});
