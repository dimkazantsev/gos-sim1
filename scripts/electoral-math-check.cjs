const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {allocateElectoralSeats:allocate,allocateRegionalSeats:allocateRegional}=require('../components/game/electoralMath');
const methods=['hare','droop','dhondt','sainte_lague','imperiali'];

assert.deepEqual(allocate([100,0],450,'droop'),[450,0]);
assert.deepEqual(allocate([90,10],450,'droop'),[405,45]);
assert.deepEqual(allocate([60,30,10],450,'droop'),[270,135,45]);
assert.deepEqual(allocate([90,10],225,'droop'),[203,22]);
for(const values of [[90000,10000],[.9,.1]])assert.deepEqual(allocate(values,450,'droop'),allocate([90,10],450,'droop'));
for(const method of methods){
 assert.deepEqual(allocate([100,80,30,20],10,method),method==='dhondt'||method==='imperiali'?[5,4,1,0]:[4,4,1,1]);
 assert.deepEqual(allocate([1,1],3,method),[2,1]);
 for(const seats of [2,450])assert.deepEqual(allocate([.3,.1],seats,method),allocate([3,1],seats,method));
 assert.deepEqual(allocate([0,0],450,method),[0,0]);assert.deepEqual(allocate([],450,method),[]);
 assert.deepEqual(allocate([50,30,20],450,method),method==='imperiali'?[226,135,89]:[225,135,90]);
 for(const values of [[100,0],[0,100,0],[99.9,.1,0],[33.3,33.3,33.4],[45.1,31.2,17.4,6.3]]){
  for(const seats of [1,7,225,450]){
   const result=allocate(values,seats,method);
   assert.equal(result.reduce((a,b)=>a+b,0),seats);
   result.forEach((v,i)=>{assert.ok(Number.isInteger(v)&&v>=0);if(values[i]===0)assert.equal(v,0);});
   assert.deepEqual(result,allocate(values.map(v=>v*1000),seats,method));
  }
 }
 for(const values of [[NaN,10],[Infinity,10],[-1,10]])assert.deepEqual(allocate(values,450,method),[0,0]);
 for(const seats of [0,-1,1.5,Infinity,451])assert.deepEqual(allocate([60,40],seats,method),[0,0]);
}
assert.deepEqual(allocate([30,30,20,20],7,'hare'),[2,2,2,1]);
assert.deepEqual(allocate([60,40],450,null),[0,0]);

assert.deepEqual(allocateRegional([450,0]),[89,0]);
assert.deepEqual(allocateRegional([270,135,45]),[53,27,9]);
assert.deepEqual(allocateRegional([225,225]),[45,44]);
assert.deepEqual(allocateRegional([150,150,150]),[30,30,29]);
assert.deepEqual(allocateRegional([90,90,90,90,90]),[18,18,18,18,17]);
assert.deepEqual(allocateRegional([30,30,20,20],7),[2,2,2,1]);
assert.deepEqual(allocateRegional([.3,.1]),allocateRegional([3,1]));
for(const values of [[450,0],[270,135,45],[225,225],[150,150,150],[90,90,90,90,90]]){
 const result=allocateRegional(values);assert.equal(result.reduce((a,b)=>a+b,0),89);
 result.forEach(v=>assert.ok(Number.isInteger(v)&&v>=0));
 assert.deepEqual(result,allocateRegional(values.map(v=>v*10)));
}
for(const values of [[0,0],[NaN,10],[Infinity,10],[-1,10]])assert.deepEqual(allocateRegional(values),[0,0]);
assert.deepEqual(allocateRegional([]),[]);
for(const seats of [0,-1,1.5,Infinity,90])assert.deepEqual(allocateRegional([60,40],seats),[0,0]);
console.log('PASS: Droop model electorate, scale invariance, zero support, completed totals, stable ties, mixed 225 pool and five allocation methods; regional 89-seat Hare allocation.');
