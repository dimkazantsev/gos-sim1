/* Actual game hook with a synthetic PostgREST projection; no server or Auth load. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const fixture=path.join(__dirname,'republic-game-resilience-check.cjs');
let source=fs.readFileSync(fixture,'utf8');
function replace(before,after){assert(source.includes(before),'Expected fixture found');source=source.replace(before,after)}
replace('select(){return this;}',"select(fields){this.selection=fields;return this;}");
replace('const result=failures.has(table)?',"if(table==='game_office_assignments'&&Array.isArray(data)&&this.selection&&this.selection!=='*'){const fields=this.selection.split(',');data=data.map(row=>Object.fromEntries(fields.filter(key=>key in row).map(key=>[key,row[key]])))}\n     const result=failures.has(table)?");
const loaded=new Module(fixture,module);loaded.filename=fixture;loaded.paths=module.paths;loaded._compile(source,fixture);
const {harness}=loaded.exports;
function client(role){
 const h=harness();h.setMemberKind(role);
 h.fixture('game_office_assignments',[{id:'office-1',game_id:'game-a',user_id:'teacher-a',role_title:'Председатель Государственной Думы',status:'active',created_at:'2026-10-27T00:00:00Z',legal_basis:'СИНТЕТИЧЕСКИЙ ТЕКСТ '.repeat(5000),approved_by:'other',educational_exception:false}]);
 return h;
}
(async()=>{
 for(const role of ['teacher','student','observer']){
  const h=client(role);
  await h.render().refresh();const offices=h.render().officeAssignments;
  assert.equal(offices.length,1,role+' still sees the authorized assignment');
  assert.equal(offices[0].role_title,'Председатель Государственной Думы');assert.equal(offices[0].status,'active');
  assert(!JSON.stringify(offices).includes('СИНТЕТИЧЕСКИЙ ТЕКСТ'),'Unused long legal text must not travel in the common roster');
  assert(h.stats().responseBytes<12000,'Large unused legal text must not inflate the response');h.dispose();
 }
 const sessions=Array.from({length:40},(_,i)=>client(['teacher','student','observer'][i%3]));
 await Promise.all(sessions.map(h=>h.render().refresh()));
 const bytes=sessions.reduce((sum,h)=>{assert.equal(h.render().officeAssignments.length,1);const n=h.stats().responseBytes;h.dispose();return sum+n},0);
 assert(bytes<480000,'40 clients do not each download the long legal text');
 console.log(JSON.stringify({result:'PASS',clients:40,synthetic_response_bytes:bytes,checks:['three roles','large omitted text','retained role/status','40 isolated clients'],environment:'Synthetic hook and PostgREST projection; no HTTP, real Auth or database load'}));
})().catch(error=>{console.error(error);process.exitCode=1});
