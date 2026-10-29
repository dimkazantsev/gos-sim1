/* Actual load runner against isolated in-memory transport and virtual clock, not a load test. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'../supabase/tests/gos_40_authenticated_20min.cjs');
let source=fs.readFileSync(file,'utf8');
function replace(before,after){assert(source.includes(before),'Runner harness expects its known entry');source=source.replace(before,after)}
replace('const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));','const sleep=async ms=>__advance(ms);');
replace('main().catch(e=>{console.error(e);process.exit(1)});','globalThis.__done=main();');
async function verifyGuardSql(){
 const {PGlite}=require('@electric-sql/pglite'),guard=fs.readFileSync(path.join(__dirname,'../supabase/tests/blitz_disposable_guard.sql'),'utf8');
 for(const scenario of ['empty','existingUser','existingGame']){
  const db=new PGlite();
  try{
   await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id integer); create table public.games(id integer);');
   if(scenario==='existingUser')await db.exec('insert into auth.users values (1)');
   if(scenario==='existingGame')await db.exec('insert into public.games values (1)');
   if(scenario==='empty'){
    await db.exec(guard);await db.exec('set role authenticated');await assert.rejects(db.query('select * from public.qa_blitz_disposable_guard'));
    await db.exec('reset role; set role service_role');const result=await db.query('select marker from public.qa_blitz_disposable_guard');assert.equal(result.rows[0].marker,'gos-id-disposable-blitz-v1');
   }else{
    await assert.rejects(db.exec(guard),/must be empty/);const result=await db.query("select to_regclass('public.qa_blitz_disposable_guard') as name");assert.equal(result.rows[0].name,null);
   }
  }finally{await db.close()}
 }
}
async function run(clients,scenario='healthy'){
 let time=0,subscriptions=0,removed=0;const rows=[],out=[],realtimeChannels=[];
 const id=email=>'user-'+Number(email.match(/blitz-qa-(\d+)@/)[1]);
 function createClient(_,key){
  let user=null;
  const client={auth:{admin:{async listUsers(){return {data:{users:scenario==='existingUser'?[{id:'existing'}]:[]},error:null}},async createUser({email}){if(scenario!=='healthy')throw Error('Write attempted before isolation check');return {data:{user:{id:id(email)}},error:null}}},
   async signInWithPassword({email}){user=id(email);return {data:{user:{id:user},session:{access_token:'synthetic'}},error:null}}},
   realtime:{async setAuth(){}},channel(){
    const channel={
     active:false,handler:null,
     on(type,filter,fn){assert.equal(type,'broadcast');assert.equal(filter.event,'qa_probe');this.handler=fn;return this},
     subscribe(fn){subscriptions++;this.active=true;realtimeChannels.push(this);fn('SUBSCRIBED')},
     async send(message){
      assert.equal(message.event,'qa_probe');
      for(const receiver of realtimeChannels){
       if(receiver.active&&receiver.handler)receiver.handler({payload:message.payload});
      }
      return 'ok';
     }
    };
    return channel;
   },
   async removeChannel(channel){removed++;channel.active=false;return 'ok'},
   from(table){const filters=[];const builder={
    async insert(data){if(table==='blitz_assignments')rows.push(...(Array.isArray(data)?data:[data]));return {error:null}},
    select(){return this},eq(field,value){filters.push([field,value]);return this},limit(){return this},
    async maybeSingle(){return {data:scenario==='missingGuard'?null:{marker:'gos-id-disposable-blitz-v1'},error:null}},
    then(resolve,reject){let data=table==='blitz_assignments'?rows.filter(x=>(key==='service'||x.user_id===user)&&filters.every(([k,v])=>x[k]===v)):table==='games'&&scenario==='existingGame'?[{id:'existing'}]:[];return Promise.resolve({data,error:null}).then(resolve,reject)}
   };return builder},
   async rpc(name,args){
    if(name==='blitz_open')return {data:rows.find(x=>x.user_id===user&&!x.answered_at)||null,error:null};
    if(name==='blitz_answer'){const row=rows.find(x=>x.id===args.p_id&&x.user_id===user);if(!row)return {data:null,error:{message:'forbidden'}};row.answered_at='answered';row.is_correct=true;row.chosen_index=0;return {data:{is_correct:true,chosen_index:0},error:null}}
    throw Error('Unexpected RPC '+name);
   }};
  return client;
 }
 const context={require:name=>name==='@supabase/supabase-js'?{createClient}:require(name),process:{env:{SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',QA_CLIENTS:String(clients)},exit(code){throw Error('Unexpected exit '+code)}},
  console:{log(...args){out.push(args.join(' '))},error:console.error},URL,Buffer,Date,Math,Promise,performance:{now:()=>time},__advance(ms){time+=Math.max(0,ms)},setTimeout(){return 1},clearTimeout(){}};
 vm.runInNewContext(source,context,{filename:file});
 if(scenario!=='healthy'){await assert.rejects(context.__done,/disposable|empty/i,'The runner must reject unsafe local data before a write');return}
 await context.__done;
 const line=out.find(x=>x.startsWith('{"environment"'));assert(line,'A structured summary is required');
 const metrics=JSON.parse(line);assert.equal(metrics.clients,clients,'Runner uses the requested number of clients');
 assert.equal(metrics.subscriptions,clients);assert.equal(metrics.reconnects,clients/2);assert.equal(metrics.second_round_writes,clients);
 assert.equal(removed,clients+clients/2,'Half the channels must be removed during the outage, and every final channel must be removed');
 assert.equal(subscriptions,clients+clients/2,'Removed channels must really subscribe again');
 assert.equal(metrics.reads,clients*19,'Two outage minutes omit half the clients');assert.equal(metrics.latency_samples,metrics.reads);
 assert.equal(metrics.latency_scope,'Blitz assignment REST reads');
 assert.match(metrics.realtime_scope,/public local Realtime channels/);
 assert.equal(metrics.received_broadcasts,clients*2,'One Broadcast reaches every client before and after reconnect');
 assert.equal(typeof metrics.p50_ms,'number');
 assert.equal(metrics.duration_seconds,1200);assert.equal(typeof metrics.p95_ms,'number');assert.equal(typeof metrics.p99_ms,'number');
 return {clients,subscriptions,removed,reads:metrics.reads};
}
(async()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/local-40-auth-20min.yml'),'utf8');
 assert.match(workflow,/^  pull_request:\s*\n    paths:/m,'100-client acceptance runs only on explicitly scoped PR paths');
 assert.match(workflow,/^  workflow_dispatch:/m,'40/100 manual test option must remain');
 assert.match(workflow,/github\.event_name == 'pull_request' && '100'/,'PR must select exactly 100 clients');
 assert.doesNotMatch(workflow,/^  (?:push|schedule):/m,'No broad automatic 20-minute load');
 assert.match(workflow,/blitz_disposable_guard\.sql/,'The manual job must install the disposable marker');
 const invalid={require:name=>name==='@supabase/supabase-js'?{createClient(){throw Error('No connection should be created for invalid input')}}:require(name),process:{env:{SUPABASE_URL:'http://localhost:54321',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',QA_DURATION_SECONDS:'invalid'}},URL};
 assert.throws(()=>vm.runInNewContext(source,{...invalid}),/20 real minutes/,'Invalid duration must fail before creating a client');
 invalid.process.env.QA_DURATION_SECONDS='1200';invalid.process.env.SUPABASE_URL='http://user:password@localhost:54321/';
 assert.throws(()=>vm.runInNewContext(source,{...invalid}),/bare local/,'Credential-bearing URL must fail before creating a client');
 invalid.process.env.SUPABASE_URL='https://example.invalid';
 assert.throws(()=>vm.runInNewContext(source,{...invalid}),/non-local/,'Remote URL must fail before creating a client');
 invalid.process.env.SUPABASE_URL='http://localhost:54321';invalid.process.env.QA_CLIENTS='101';
 assert.throws(()=>vm.runInNewContext(source,{...invalid}),/40 or 100/,'Unexpected classroom size must fail before creating a client');
 await verifyGuardSql();for(const scenario of ['missingGuard','existingUser','existingGame'])await run(40,scenario);
 const out=[];for(const n of [40,100])out.push(await run(n));console.log(JSON.stringify({status:'PASS',checks:out,environment:'synthetic Auth/Realtime/REST, virtual clock, no server load'}))
})().catch(e=>{console.error(e);process.exitCode=1});
