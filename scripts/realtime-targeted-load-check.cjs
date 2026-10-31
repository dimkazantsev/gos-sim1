/* Actual hook effects with synthetic I/O and virtual time; no server load. */
const assert=require('node:assert/strict'),ts=require('typescript'),{execFileSync}=require('node:child_process');
const {harness}=require('./republic-game-resilience-check.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const vote=id=>({id,game_id:'game-a',stage_no:1,title:'Голосование '+id,status:'open',opened_at:'2026-10-26T00:00:00Z'});
const doc=(id,title=id)=>({id,game_id:'game-a',stage_no:1,title,updated_at:'2026-10-26T00:00:00Z',status_code:'draft',source_file_path:null});
async function steady(compiledCode){
 const clients=Array.from({length:40},(_,i)=>{const h=harness({effects:true,compiledCode});h.setUser('student-'+i);return h});
 await Promise.all(clients.map(async h=>{await h.settle();h.render().setActiveView('votes');await h.settle()}));
 const before=clients.map(h=>h.stats());let writes=0;
 for(let second=0;second<1200;second++){
  // Each of 40 participants offers one vote update every five virtual seconds.
  for(let actor=0;actor<8;actor++){const row=vote('vote-'+((second%5)*8+actor));for(const h of clients)h.emit('game_votes',row,'UPDATE');writes++}
  await Promise.all(clients.map(h=>h.advance(1000)));
 }
 let reads=0,bytes=0,core=0;
 clients.forEach((h,i)=>{const after=h.stats();reads+=Object.values(after.started).reduce((a,b)=>a+b,0)-Object.values(before[i].started).reduce((a,b)=>a+b,0);bytes+=after.responseBytes-before[i].responseBytes;core+=(after.started.games||0)-(before[i].started.games||0);assert(h.render().votes.length<=40,'Unique vote payloads must not duplicate rows');h.dispose()});
 assert.equal(writes,9600);return{offeredWrites:writes,eventDeliveries:writes*40,reads,jsonResponseBytes:bytes,fullGameReads:core};
}
async function checks(){
 const h=harness({effects:true});await h.settle();h.render().setActiveView('documents');await h.settle();
 const rows=[doc('old'),doc('new')],history=[{id:1,document_id:'old',game_id:'game-a',created_at:'2026-10-25T00:00:00Z'}];
 h.fixture('formal_documents',rows);h.fixture('formal_document_history',history);await h.render().refresh();
 rows[1]=doc('new','Исправленный документ');history.push({id:2,document_id:'new',game_id:'game-a',created_at:'2026-10-26T00:00:00Z'});
 const before=h.stats();h.emit('formal_documents',rows[1],'UPDATE');assert.equal(h.render().formalDocuments.find(d=>d.id==='new').title,'Исправленный документ');
 await h.advance(3100);const after=h.stats();
 assert.equal(after.started.games,before.started.games,'A valid document delta cannot reload game identity');
 const registry=after.queryLog.slice(before.queryLog.length).filter(q=>q.table==='rpc:get_formal_registry_projection');
 assert.equal(registry.length,1,'One scoped RPC replaces two direct document/history reads');
 assert.equal(JSON.stringify(registry[0].ins.document_ids),JSON.stringify(['new']),'Fetch only changed document/history rows');
 assert.equal(after.started['rpc:get_formal_registry_projection']-before.started['rpc:get_formal_registry_projection'],1,'Exactly one registry request');
 assert.equal(h.render().formalDocuments.length,2);assert.equal(h.render().formalHistory.length,2,'Unchanged history is retained');
 const old=h.hold('formal_registry');const earlier=h.render().refreshDocuments('new');await tick();
 rows[1]=doc('new','Последняя редакция');h.fixture('formal_documents',rows);h.emit('formal_documents',rows[1],'UPDATE');await h.advance(3100);old.resolve();await earlier;
 assert.equal(h.render().formalDocuments.find(d=>d.id==='new').title,'Последняя редакция','An old register read cannot overwrite an accepted newer document delta');
 history.push({id:3,document_id:'new',game_id:'game-a',created_at:'2026-10-26T00:00:01Z'});h.fixture('formal_document_history',history);
 const pendingHistory=h.hold('formal_registry');const documentB=h.render().refreshDocuments('new');await tick();
 history.push({id:4,document_id:'old',game_id:'game-a',created_at:'2026-10-26T00:00:02Z'});h.fixture('formal_document_history',history);
 await h.render().refreshDocuments('old');pendingHistory.resolve();await documentB;await h.advance(3100);
 assert.equal(h.render().formalHistory.length,4,'Concurrent reads of separate documents requeue stale IDs without losing either history');
 h.emit('formal_documents',{...doc('foreign'),game_id:'game-b'},'UPDATE');assert(!h.render().formalDocuments.some(d=>d.id==='foreign'));
 h.visible('hidden');const hidden=h.stats().responseBytes;h.emit('formal_documents',doc('new','Скрытое обновление'),'UPDATE');await h.advance(5000);assert.equal(h.stats().responseBytes,hidden,'Hidden tab starts no reconciliation');h.visible('visible');await h.advance(3100);h.dispose();
 const q=harness({effects:true});await q.settle();q.ignoreAbort(true);
 // Eleven core tables are now bundled: hold only the independent member GET.
 const heldMember=q.hold('game_members',q.readCount('game_members')+2);
 const beforeBootstrap=q.rpcCount('get_game_bootstrap_v3');
 const refresh=q.render().refresh();for(let n=0;n<4;n++)await tick();
 q.runTimers();await refresh;
 assert(q.stats().aborted>=1,'Stalled personal member read must abort');
 heldMember.resolve();
 await q.render().refresh();
 assert(q.rpcCount('get_game_bootstrap_v3')>beforeBootstrap,'Next bootstrap must not remain blocked');
 q.dispose();
 const c=harness({effects:true});await c.settle();c.render().setChatOpen(true);await c.settle();const initial=c.stats().started['rpc:mark_chat_channel_read']||0;
 for(let i=0;i<80;i++){c.emit('chat_messages',{id:'m'+i,channel_id:'channel-a',text:'Сообщение',created_at:new Date().toISOString()},'INSERT');await c.settle();await c.advance(125)}
 await c.advance(3100);const receipts=(c.stats().started['rpc:mark_chat_channel_read']||0)-initial;
 assert(receipts<=5&&receipts>=3,'Eighty incoming messages coalesce into read receipts, including the trailing receipt: '+receipts);c.dispose();
 const v=harness({effects:true});v.setUser('student-voter');await v.settle();
 const open={...vote('own'),voting_mode:'member',institution_key:'all'};v.fixture('game_votes',[open]);v.fixture('game_ballots',[{vote_id:'own',voter_id:'student-voter',choice:'yes',weight:1}]);
 const ownBefore=v.stats();assert.equal(await v.render().castVoteAllocation(open,1,0,0),true);
 const ownAfter=v.stats();assert.equal(ownAfter.started.games,ownBefore.started.games,'A regular ballot cannot reload the game');assert.equal(v.render().ballots[0].vote_id,'own');
 assert(ownAfter.queryLog.slice(ownBefore.queryLog.length).every(q=>q.eqs.id==='own'||q.eqs.vote_id==='own'),'Ballot confirmation reads only the affected vote');
 v.render().setActiveView('votes');await v.settle();const other={...open,id:'other'};v.fixture('game_votes',[open,other]);v.fixture('game_ballots',[{vote_id:'own',voter_id:'student-voter',choice:'yes',weight:1},{vote_id:'other',voter_id:'student-voter',choice:'no',weight:1}]);
 const delayedTally=v.hold('game_ballots');v.emit('game_votes',other,'UPDATE');await v.advance(3100);await v.render().castVoteAllocation(open,1,0,0);delayedTally.resolve();await v.settle();await v.advance(3100);
 assert(v.render().ballots.some(row=>row.vote_id==='other'),'A concurrent own vote requeues the other vote tally instead of dropping it');
 v.fixture('game_ballots',[{vote_id:'own',voter_id:'student-voter',choice:'yes',weight:1},{vote_id:'other',voter_id:'student-voter',choice:'no',weight:2}]);
 await v.advance(9100);assert.equal(v.render().ballots.find(row=>row.vote_id==='other').weight,2,'An ordinary ballot without a vote-table event arrives through the visible six-second recovery');
 v.visible('hidden');const hiddenBallots=v.stats().started.game_ballots;await v.advance(20000);assert.equal(v.stats().started.game_ballots,hiddenBallots,'Hidden voting screens must not poll ballots');v.visible('visible');
 v.fixture('game_votes',[{...open,status:'closed'}]);const prior=v.readCount('games'),pendingBallots=v.hold('game_ballots');
 const closing=v.render().castVoteAllocation(open,1,0,0);await tick();v.emit('game_votes',{...open,status:'closed'},'UPDATE');v.render();pendingBallots.resolve();await closing;
 assert(v.readCount('games')>prior,'Auto-closing last ballot retains full procedure reconciliation even when its Realtime delta invalidates the ballot read');v.dispose();
 const role=harness({effects:true});await role.settle();const oldDelta=role.callbacks('formal_documents')[0];role.setMemberKind('observer');await role.render().refresh();await role.settle();
 oldDelta({eventType:'INSERT',new:doc('old-role')});assert(!role.render().formalDocuments.some(row=>row.id==='old-role'),'An earlier role-generation payload cannot repopulate cleared private state');role.dispose();
 const pulse=harness({effects:true});await pulse.settle();pulse.render().setActiveView('parties');await pulse.settle();let noticeStart=pulse.stats().notices.length;
 pulse.emit('state_metrics',{id:'metric',value:7},'UPDATE');assert.equal(pulse.render().metrics[0].value,7);
 assert(!pulse.stats().notices.slice(noticeStart).some(row=>row.table==='state_metrics'),'Metric payloads must not invalidate unrelated party-election listeners');
 pulse.render().setActiveView('budget');await pulse.settle();noticeStart=pulse.stats().notices.length;pulse.emit('state_metrics',{id:'metric',value:8},'UPDATE');
 assert(pulse.stats().notices.slice(noticeStart).some(row=>row.table==='state_metrics'),'Visible budget widgets retain their targeted metric invalidation');pulse.dispose();
 console.log('PASS targeted document/history reads, preserved history, late document response, foreign-game rejection, hidden recovery, stalled queue abort/release, coalesced chat receipts, targeted ballot confirmation and auto-closure reconciliation');
 const model=await steady();assert(model.fullGameReads<=280,'Only periodic reconciliation may load game identity');assert(model.reads<20000,'Steady vote updates must not trigger a full game fanout');
 let beforeModel=null;
 if(process.env.PERFORMANCE_BASELINE_REF){const source=execFileSync('git',['show',process.env.PERFORMANCE_BASELINE_REF+':components/game/useRepublicGame.ts'],{encoding:'utf8'});const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;beforeModel=await steady(code);assert(model.reads<beforeModel.reads/2);assert(model.jsonResponseBytes<beforeModel.jsonResponseBytes)}
 console.log(JSON.stringify({model:'40 isolated hook instances, 20 virtual minutes, one vote update per participant/5 seconds; no Auth, network or database load',before:beforeModel,after:model},null,2));
}
const watchdog=setTimeout(()=>{console.error('FAIL targeted effect suite did not finish');process.exitCode=1},120000);
checks().then(()=>clearTimeout(watchdog),error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1});
