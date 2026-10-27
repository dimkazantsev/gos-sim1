/* The real VotesView effects with synthetic replies and virtual time; no server load. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.join(__dirname,'election-panels-load-check.cjs');
let fixture=fs.readFileSync(file,'utf8');
function replace(before,after){assert(fixture.includes(before),'Fixture matches: '+before);fixture=fixture.replace(before,after)}
replace("ghost:'GhostPolicyLab'","ghost:'GhostPolicyLab',votes:'VotesView'");
replace("kind==='deadline'&&i===8","kind==='deadline'&&i===8");
replace("institution_session_registrations:[{user_id:'student-A',stage_no:4,institution_key:'gd',present_mandates:15}]","institution_session_registrations:[{user_id:'student-A',stage_no:4,institution_key:'gd',present_mandates:rev?25:15}]");
replace("const api={errors,starts,failures,","const api={errors,starts,failures,revision(value){revision=value},connection(value){sync.setGameRealtimeConnection('game-A',value)},");
replace("name==='./useGameTableSync'?sync:","name==='./useGameTableSync'?sync:name==='./useSavedGameState'?{useSavedGameState:(_game,_user,_key,value)=>react.useState(value),savedChoice:()=>()=>true}:name==='./votingBodies'?{VOTING_BODIES:[]}:");
replace("profiles:[],partyInvitations:[],votes:[]","profiles:[],partyInvitations:[],formalDocuments:[],ballots:[],votes:[]");
replace("main().catch(error=>{console.error(error);process.exitCode=1});","module.exports={realm,tick,find};");
const compiled=new Module(file,module);compiled.filename=file;compiled.paths=module.paths;compiled._compile(fixture,file);
const {realm,tick,find}=compiled.exports;
async function panelMutations(){
 const ts=require('typescript'),text=fs.readFileSync(path.join(__dirname,'../components/game/InstitutionRegistrationPanel.tsx'),'utf8');
 const source=ts.createSourceFile('InstitutionRegistrationPanel.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions={};
 function visit(node){if(ts.isFunctionDeclaration(node)&&['register','saveGdPresence'].includes(node.name?.text))functions[node.name.text]=node.getText(source);ts.forEachChild(node,visit)}visit(source);
 assert(functions.register&&functions.saveGdPresence);
 const js=ts.transpileModule(Object.values(functions).join('\n')+'\nreturn {register,saveGdPresence}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const name of ['register','saveGdPresence'])for(const fail of [false,true]){
  let callbacks=0,loads=0;
  const supabase={rpc:async()=>({error:fail?{message:'denied'}:null})},g={game:{id:'game-A'}},canAttend=true,agendaReady=true,readOnly=false,meetingActionsLocked=false,busy=false,gdPresence={my_capacity:20},presenceDraft='12',stage=4,body='gd';
  const setMeetingError=()=>{},setNotice=()=>{},setBusy=()=>{},meetingErrorMessage=value=>String(value),userError=e=>e.message,onRegistrationChange=()=>callbacks++,load=async()=>{loads++};
  const make=new Function('supabase','g','canAttend','agendaReady','readOnly','meetingActionsLocked','busy','gdPresence','presenceDraft','stage','body','setMeetingError','setNotice','setBusy','meetingErrorMessage','userError','onRegistrationChange','load',js);
  await make(supabase,g,canAttend,agendaReady,readOnly,meetingActionsLocked,busy,gdPresence,presenceDraft,stage,body,setMeetingError,setNotice,setBusy,meetingErrorMessage,userError,onRegistrationChange,load)[name]();
  assert.equal(callbacks,fail?0:1,name+' notifies only after a successful write');assert.equal(loads,fail?0:1,name+' refreshes the panel only after success');
 }
}
async function main(){
 async function model(old){const sessions=Array.from({length:40},()=>realm('votes',old));await tick();for(const r of sessions)await r.settle();for(let second=0;second<12;second++){for(const r of sessions)for(let i=0;i<8;i++)r.local('institution_session_registrations');for(const r of sessions)await r.advance(1000)}const reads=sessions.reduce((n,r)=>n+r.metrics().reads,0);for(const r of sessions)r.close();return reads}
 async function idle(old){const sessions=Array.from({length:40},()=>realm('votes',old));await tick();for(const r of sessions)await r.settle();for(const r of sessions)await r.advance(20*60000);const reads=sessions.reduce((n,r)=>n+r.metrics().reads,0);for(const r of sessions)r.close();return reads}
 const before=process.env.PERFORMANCE_BASELINE_REF?await model(true):null,reads=await model(false);
 const idleBefore=process.env.PERFORMANCE_BASELINE_REF?await idle(true):null,idleAfter=await idle(false);
 assert(reads<=240,'40 clients should coalesce frequent registration signals into at most one read per three seconds: '+reads);
 const r=realm('votes');await r.settle();r.hold();r.local('institution_session_registrations');await r.advance(3100);
 r.local('institution_session_registrations');await r.advance(3100);
 assert.equal(r.metrics().maxInflight,1,'Registration reads must not overlap');
 const own=find(r.render(),n=>typeof n.props?.onRegistrationChange==='function');assert(own,'VotesView passes the own-registration callback');r.revision(1);own.props.onRegistrationChange();r.release();await r.settle();await r.advance(3100);await r.settle();
 assert.equal(r.state(14).rows[0].present_mandates,25,'A later own registration replaces an older held snapshot without Realtime');
 const old=JSON.stringify(r.state(14));r.failures.add('institution_session_registrations');own.props.onRegistrationChange();await r.settle();assert.equal(JSON.stringify(r.state(14)),old,'A read error preserves confirmed data');r.failures.clear();r.close();
 const immediate=realm('votes');await immediate.settle();const callback=find(immediate.render(),n=>typeof n.props?.onRegistrationChange==='function');const prior=immediate.metrics().reads;immediate.revision(1);callback.props.onRegistrationChange();await tick();assert.equal(immediate.metrics().reads,prior+1,'Successful own change starts a read immediately without Realtime');await immediate.settle();assert.equal(immediate.state(14).rows[0].present_mandates,25);immediate.close();
 const hidden=realm('votes',false,{hidden:true});await tick();hidden.local('institution_session_registrations');await hidden.advance(10000);assert.equal(hidden.metrics().reads,0,'Hidden tabs do not poll');hidden.visible(true);await hidden.advance(3100);await hidden.settle();assert.equal(hidden.metrics().reads,1,'Returning to the tab reconciles attendance');hidden.close();
 const offline=realm('votes');await offline.settle();offline.connection(false);offline.revision(1);await offline.advance(38000);await offline.settle();assert.equal(offline.state(14).rows[0].present_mandates,25,'Lost WebSocket recovers through the short fallback without a focus event');assert.equal(offline.metrics().reads,2);offline.close();
 const timeout=realm('votes');await timeout.settle();timeout.hold();timeout.local('institution_session_registrations');await timeout.advance(3100);await timeout.advance(12001);const stalled=timeout.metrics().reads;await timeout.advance(10000);assert.equal(timeout.metrics().reads,stalled,'A timeout does not trigger a retry loop');timeout.hold(false);timeout.revision(1);find(timeout.render(),n=>typeof n.props?.onRegistrationChange==='function').props.onRegistrationChange();await timeout.settle();timeout.release();await timeout.settle();assert.equal(timeout.state(14).rows[0].present_mandates,25,'An aborted late response cannot overwrite a newer registration');timeout.close();
 const switched=realm('votes');await switched.settle();switched.hold();switched.local('institution_session_registrations');await switched.advance(3100);switched.render(switched.props('game-B','student-B'));await switched.settle();switched.release();await switched.settle();assert.equal(JSON.parse(switched.state(14).scope)[0],'game-B','A late read cannot restore a previous game');assert.equal(JSON.parse(switched.state(14).scope)[1],'student-B','A late read cannot restore a previous user');switched.close();
 const role=realm('votes');await role.settle();role.render(role.props('game-A','student-A','teacher'));await role.settle();assert.equal(JSON.parse(role.state(14).scope)[2],'teacher','Changing roles reloads the snapshot under current permissions');role.close();
 await panelMutations();
 console.log(JSON.stringify({environment:'40 isolated component realms; 12 virtual seconds, 8 signals/s each; idle: 20 virtual minutes; synthetic responses without Auth, HTTP or database',before,after:reads,idleBefore,idleAfter,checks:['single-flight','latest own registration without Realtime','failure preserves result','12s timeout and late response','hidden recovery','game, user and role switch','callbacks on successful writes only']}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
