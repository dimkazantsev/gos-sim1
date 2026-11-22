/* Branding guard: an educational descriptor must not appear in displayed UI.
 * Source-only check: no network, runtime requests, database calls or timers. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const sources=['app','components','production-app/app'];
const exceptions=new Set(['components/game/cecOfficialWording.ts','components/game/EventChoicePanel.tsx']); // These two modules reject or replace banned generated text rather than display it.
const failures=[];
function walk(relative){
 const absolute=path.join(root,relative);
 if(!fs.existsSync(absolute))return;
 for(const e of fs.readdirSync(absolute,{withFileTypes:true})){
  if(['node_modules','.next','dist','build','__tests__'].includes(e.name))continue;
  const name=path.posix.join(relative.replace(/\\/g,'/'),e.name);
  if(e.isDirectory()){walk(name);continue}
  if(!/\.(tsx?|jsx?)$/.test(e.name)||exceptions.has(name))continue;
  const lines=fs.readFileSync(path.join(root,name),'utf8').split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
   if(/учебн[а-яё]*/iu.test(lines[i]))failures.push(name+':'+(i+1));
  }
 }
}
sources.forEach(walk);
assert.deepEqual(failures,[],'Forbidden wording in user-facing source: '+failures.join(', '));
const modal=fs.readFileSync(path.join(root,'components/game/StateMetricsDock.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'app/impact-workbench.css'),'utf8');
assert.match(modal,/data-international-financing-explanation/,'Metric history retains foreign finance explanation');
assert.match(modal,/className="stateMetricFinanceFacts"/,'Explanation has compact numeric facts');
assert.match(css,/\.stateMetricFinanceFacts\{display:grid;/,'Responsive metrics use existing styling');
assert.match(css,/var\(--gs-border\)/,'Approved border token retained');
assert.match(css,/@media\(max-width:520px\)\{\.stateMetricFinanceFacts/,'Narrow mobile stacks the values');
console.log('PASS: forbidden wording absent in UI source; branded finance explanation and mobile layout present');
