/* Actual game hook, synthetic time and replies; no browser or network load. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),vm=require('node:vm'),ts=require('typescript');
const file=path.join(__dirname,'republic-game-resilience-check.cjs');
let source=fs.readFileSync(file,'utf8');
function replace(before,after){assert(source.includes(before),'Expected game harness found');source=source.replace(before,after)}
replace("let virtualNow=Date.parse('2026-10-26T00:00:00Z')","let perSecondUpdates=0,currentInterval=0;let virtualNow=Date.parse('2026-10-26T00:00:00Z')");
replace('slots[i].value=value;dirty=true;','slots[i].value=value;dirty=true;if(currentInterval===1000)perSecondUpdates++;');
replace("const game={id,current_round:snapshot.revision,title:'revision-'+snapshot.revision};",
 "const game={id,current_round:snapshot.revision,title:'revision-'+snapshot.revision,turn_open:true,turn_ends_at:'2026-10-26T01:00:00.000Z'};");
replace("game:{id:snapshot.gameId,current_round:snapshot.revision,title:'revision-'+snapshot.revision},","game:{id:snapshot.gameId,current_round:snapshot.revision,title:'revision-'+snapshot.revision,turn_open:true,turn_ends_at:'2026-10-26T01:00:00.000Z'},");
replace("if(table==='games')data={id:this.eqs.id||snapshot.gameId,current_round:snapshot.revision,title:'revision-'+snapshot.revision};","if(table==='games')data={id:this.eqs.id||snapshot.gameId,current_round:snapshot.revision,title:'revision-'+snapshot.revision,turn_open:true,turn_ends_at:'2026-10-26T01:00:00.000Z'};");
replace('next[1].fn();await settle();','currentInterval=next[1].interval||0;next[1].fn();currentInterval=0;await settle();');
replace('stats:()=>({requests','stats:()=>({perSecondUpdates,requests');
const loaded=new Module(file,module);loaded.filename=file;loaded.paths=module.paths;loaded._compile(source,file);
function displayClock(){
 let now=Date.parse('2026-10-26T00:00:00Z'),cursor=0,nextId=0,tree;
 const slots=[],effects=[],timers=new Map();
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value}]},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn()})}}
 };
 const compile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'..','components/game',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const countdown={exports:{}};vm.runInNewContext('(function(module,exports){'+compile('turnCountdown.ts')+'})')(countdown,countdown.exports);
 const child={exports:{}},jsx=(type,props)=>({type,props});
 const context={Date:ClockDate,setInterval:(fn,delay)=>{const id=++nextId;timers.set(id,{fn,delay,at:now+delay});return id},clearInterval:id=>timers.delete(id)};
 const req=name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:name==='./turnCountdown'?countdown.exports:{};
 vm.runInNewContext('(function(require,module,exports){'+compile('TurnClock.tsx')+'})',context)(req,child,child.exports);
 function render(name,endAt){cursor=0;tree=child.exports[name]({endAt});while(effects.length)effects.shift()();cursor=0;tree=child.exports[name]({endAt});return tree}
 return {render,advance(ms){const end=now+ms;for(;;){const next=[...timers.values()].filter(t=>t.at<=end).sort((a,b)=>a.at-b.at)[0];if(!next)break;now=next.at;next.at+=next.delay;next.fn()}now=end},dispose(){for(const slot of slots)slot?.cleanup?.();assert.equal(timers.size,0,'Clock timer stops on unmount')}};
}
function words(node){if(Array.isArray(node))return node.map(words).join('');if(node&&typeof node==='object')return words(node.props?.children);return node==null?'':String(node)}
(async()=>{
 const h=loaded.exports.harness({effects:true});
 try{
  await h.settle();await h.render().refresh();await h.settle();assert(h.render().game?.turn_open,'A live turn must be loaded: '+JSON.stringify(h.render().game));
  await h.advance(5000);
  assert.equal(h.stats().perSecondUpdates,0,'A ticking clock must not update the game-wide hook');
  const endAt='2026-10-26T00:01:01Z';
  const pill=displayClock();let view=pill.render('TurnCountdownPill',endAt);
  assert.match(view.props['aria-label'],/2 минуты/);pill.advance(2000);view=pill.render('TurnCountdownPill',endAt);
  assert.match(view.props['aria-label'],/1 минута/);pill.advance(60000);view=pill.render('TurnCountdownPill',endAt);
  assert.match(view.props['aria-label'],/0 минут/);pill.dispose();
  const screen=displayClock();view=screen.render('PublicTurnCountdown',endAt);assert.equal(words(view),'01:01');
  screen.advance(2000);assert.equal(words(screen.render('PublicTurnCountdown',endAt)),'00:59');
  const extended='2026-10-26T00:02:02Z';assert.equal(words(screen.render('PublicTurnCountdown',extended)),'02:00');
  screen.advance(120000);assert.equal(words(screen.render('PublicTurnCountdown',extended)),'00:00');screen.dispose();
  console.log('PASS: live turn does not rerender the shared game hook; both countdowns tick and stop correctly. Synthetic time, no HTTP.');
 }finally{h.dispose()}
})().catch(error=>{console.error(error);process.exitCode=1});
