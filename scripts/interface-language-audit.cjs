/* Check visible literals and captions, including dynamic strings outside JSX. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),findings=[];
const attributes=new Set(['title','label','placeholder','aria-label','alt','unit','heading','description','button','caption','helper','notice','error']);
const allowed=/Goust Voting|ГОС[./\u200B]*ID|\b(?:PDF|DOCX?|XLSX?|TXT|URL|HTTP|HTTPS|HTML|CSS|SVG|PNG|JPE?G|WEBP|CSV|API|QR|JSON|ZIP|XML|I|II|III|IV|V|VI|VII|VIII|IX|X|S1A1)\b/gi;
function words(value){
 return String(value)
  .replace(/node\s+server\.mjs|\bmedia\b|(?:docs|slides)\.google\.com(?:\/[^\s'\"<>]*)?/gi,'')
  .replace(/https?:\/\/[^\s'"<>]+|[\w.+-]+@[\w.-]+|(?:[\w-]+\/)*[\w.-]+\.(?:html|json|mjs|cjs|txt|pdf|docx?|csv|zip)\b/gi,'')
  .replace(/\/(?:start|game|games|status|stages|votes|docs|channels|chat|appeal|appeal_test|appeals|reply|menu|help)\b/g,'')
  .replace(/node\s+server\.mjs|Node\.js|GOS_(?:TEACHER|STUDENT)_CODE|\bGOS-2026\b/g,'')
  .replace(allowed,'').match(/[A-Za-z][A-Za-z_]{1,}/g);
}
function inspect(file){
 const content=fs.readFileSync(file,'utf8');
 const source=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const relative=path.relative(root,file).replaceAll('\\','/');
 function report(node,value){
  if(/^#?[а-яё_]+_gpyasu$/i.test(value))return; // Stored routing tags; captions are localized at render.
  const found=words(value);if(!found)return;
  const line=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
  findings.push(relative+':'+line+' — '+[...new Set(found)].join(', '));
 }
 function visit(node){
  if(ts.isJsxText(node))report(node,node.getText(source));
  if(ts.isStringLiteralLike(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){
   const parent=node.parent;
   const property=ts.isPropertyAssignment(parent)&&parent.initializer===node&&attributes.has(parent.name.getText(source).replace(/['"]/g,''));
   const attribute=ts.isJsxAttribute(parent)&&attributes.has(parent.name.getText(source));
   const mixed=/[А-Яа-яЁё]/.test(node.text)&&/[A-Za-z]{2}/.test(node.text);
   // A quoted property key describes storage, rather than a visible caption.
   const key=ts.isPropertyAssignment(parent)&&parent.name===node;
   if(!key&&(property||attribute||mixed))report(node,node.text);
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
}
function walk(dir){
 if(!fs.existsSync(dir))return;
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  if(['node_modules','.next','.git'].includes(item.name))continue;
  const file=path.join(dir,item.name);
  if(item.isDirectory())walk(file);
  else if(/\.(?:ts|tsx|js|mjs)$/.test(file))inspect(file);
 }
}
for(const dir of ['app','components','lib','production-app','supabase/functions'])walk(path.join(root,dir));
function scanAssets(dir){
 if(!fs.existsSync(dir))return;
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);
  if(entry.isDirectory()){scanAssets(file);continue;}
  if(!/\.(?:svg|html)$/.test(file))continue;
  const content=fs.readFileSync(file,'utf8'),svg=file.endsWith('.svg');
  const values=svg?[...content.matchAll(/<(text|title|desc)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m=>m[2].replace(/<[^>]+>/g,'')):
   [...content.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<code\b[^>]*>[\s\S]*?<\/code>/gi,'').matchAll(/>([^<>]+)</g)].map(m=>m[1]);
  for(const value of values){
   if(file.endsWith(path.join('app','icon.svg'))&&value==='ID')continue;
   const text=value.replace(/&[a-zA-Z#0-9]+;|\b[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\b/g,'');
   const found=words(text);if(found)findings.push(path.relative(root,file)+' — '+found.join(', '));
  }
 }
}
scanAssets(path.join(root,'public'));scanAssets(path.join(root,'demo'));
const achievementNames=fs.readFileSync(path.join(root,'content/achievements.tsv'),'utf8').split('\n').map(line=>line.split('|').slice(0,2).join(' '));
for(const name of achievementNames)if(words(name))findings.push('content/achievements.tsv — '+name);
const leaks=[
 ['components/game/ImpactRulesPanel.tsx',/rule\.event_type\.replaceAll|JSON\.stringify\(rule\.conditions|\|\|entry\.rule_key/],
 ['components/game/stageComicModel.ts',/ruleLabels\[s\]\|\|labels\[s\]\|\|s/],
 ['components/game/ClassroomJournal.tsx',/VIEW_NAMES\[[^\]]+\]\|\|(?:a\.view_key|v|p\.current_view)/],
 ['components/game/GradesView.tsx',/x\.channel\|\|x\.action/],
 ['components/game/TeacherOverview.tsx',/Открыть Event|\bUSD\b|\bGV\b/],
 ['components/game/GhostPolicyLab.tsx',/Ghost voting/],
 ['components/game/ParticipantsAnalytics.tsx',/Источник баллов: stage_assessments/],
 ['components/game/SystemDebriefLab.tsx',/ИЗМЕНЕНИЯ KPI/],
 ['components/game/ScoreFormula.tsx',/ВСН = max\(/]
];
for(const [file,expression]of leaks)if(expression.test(fs.readFileSync(path.join(root,file),'utf8')))findings.push(file+' — технический код в интерфейсе');
if(findings.length)throw Error('Непереведённые подписи ('+findings.length+'):\n'+findings.slice(0,60).join('\n'));
console.log('PASS: Russian static and dynamic captions; approved brand, file formats, links and commands preserved.');
