/* Actual analytics component; synthetic data and instrumented arrays, no network. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.join(__dirname,'profile-results-load-check.cjs');
let source=fs.readFileSync(file,'utf8');
const entry='main().catch(error=>{console.error(error);process.exitCode=1;});';
assert(source.includes(entry),'Expected analytics test harness entry');
source=source.replace(entry,'module.exports={realm,nodes,text};');
const harness=new Module(file,module);harness.filename=file;harness.paths=module.paths;harness._compile(source,file);
const {realm,nodes,text}=harness.exports;
function tracked(items,stats,key){
 return new Proxy(items,{get(target,prop,receiver){
  if(prop==='filter')return predicate=>target.filter((row,index,array)=>{stats[key]++;return predicate(row,index,array)});
  if(prop===Symbol.iterator)return function*(){for(const row of target){stats[key]++;yield row}};
  return Reflect.get(target,prop,receiver);
 }});
}
(async()=>{
 const r=realm('analytics',{teacher:true,fail:['teacher_game_activity_counts']});await r.settle();
 const p=r.props(),n=100,count=10000,stats={posts:0,documents:0,ballots:0,activities:0};
 p.g.members=Array.from({length:n},(_,i)=>({game_id:'game-A',user_id:'student-'+i,full_name:'Участник '+String(i).padStart(3,'0'),kind:'student',team:'Партия'}));
 p.g.politicalPosts=tracked(Array.from({length:count},(_,i)=>({author_id:'student-'+(i%n)})),stats,'posts');
 p.g.formalDocuments=tracked(Array.from({length:count},(_,i)=>({author_id:'student-'+(i%n)})),stats,'documents');
 p.g.ballots=tracked(Array.from({length:count},(_,i)=>({voter_id:'student-'+(i%n)})),stats,'ballots');
 p.g.activities=tracked(Array.from({length:count},(_,i)=>({actor_id:'student-'+(i%n)})),stats,'activities');
 const tree=r.render(p),rows=nodes(tree,node=>node.type==='tr');
 assert.equal(rows.length,101,'All 100 student rows and header are retained');
 const studentRow=rows.find(row=>text(row).includes('Участник 000'));
 const cells=nodes(studentRow,node=>node.type==='td');
 assert.equal(text(cells[4]),'100','Post count retained');assert.equal(text(cells[5]),'100','Document count retained');
 assert.equal(text(cells[6]),'100','Ballot count retained');assert.equal(text(cells[7]),'100','Fallback activity count retained');
 const sum=Array.from({length:16},(_,i)=>i%2===0?i%4:i%3+.5).reduce((a,b)=>a+b,0);
 assert.equal(text(cells[0]),String(sum),'All-stage total retained');assert.equal(text(cells[2]).replaceAll(' ',''),'16/16');assert.equal(text(cells[3]),'8');
 for(const [key,visits] of Object.entries(stats))assert(visits<=count*2,key+' must not rescan 10,000 rows for every student: '+visits);
 const firstRenderVisits={...stats};
 const stage=nodes(tree,node=>node.props?.label==='Этап')[0];stage.props.onChange('2');
 const second=nodes(r.render(p),node=>node.type==='tr').find(row=>text(row).includes('Участник 000'));
 const stageCells=nodes(second,node=>node.type==='td');
 assert.equal(text(stageCells[0]),'1.5','Selected stage keeps its original score');assert.equal(text(stageCells[2]).replaceAll(' ',''),'1/16');assert.equal(text(stageCells[3]),'0');
 r.close();console.log(JSON.stringify({result:'PASS',students:n,recordsPerCategory:count,firstRenderVisits,environment:'Synthetic component render, no HTTP or DB'}));
})().catch(error=>{console.error(error);process.exitCode=1});
