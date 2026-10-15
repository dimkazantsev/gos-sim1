/* Read-only, repository-wide JSX audit of literal English-facing interface text.
 * Reports candidate labels; technical identifiers in code are never renamed. */
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const candidates=[];
const roots=['app','components'];
const uiAttributes=new Set(['title','label','placeholder','aria-label','alt']);
const allowed=/Goust Voting|ГОС\.ID|\b(?:PDF|DOCX|XLSX|URL|HTTP|HTTPS|HTML|CSS|SVG|PNG|JPG|CSV|API|НПА)\b/gi;
function inspect(file){
 const content=fs.readFileSync(file,'utf8');
 const source=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function report(node,value){
  const cleaned=String(value).replace(allowed,'').trim();
  const words=cleaned.match(/[A-Za-z][A-Za-z_]{2,}/g);
  if(!words)return;
  const {line}=source.getLineAndCharacterOfPosition(node.getStart(source));
  candidates.push({path:path.relative(root,file).replaceAll('\\','/'),line:line+1,words:[...new Set(words)].join(', ')});
 }
 function visit(node){
  if(ts.isJsxText(node)){report(node,node.getText(source));}
  if(ts.isJsxAttribute(node)&&uiAttributes.has(node.name.text)&&node.initializer&&ts.isStringLiteral(node.initializer))report(node,node.initializer.text);
  ts.forEachChild(node,visit);
 }
 visit(source);
}
function walk(dir){
 if(!fs.existsSync(dir))return;
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  if(['node_modules','.next','.git'].includes(item.name))continue;
  const full=path.join(dir,item.name);
  if(item.isDirectory())walk(full);
  else if(item.isFile()&&full.endsWith('.tsx'))inspect(full);
 }
}
for(const dir of roots)walk(path.join(root,dir));
for(const result of candidates.slice(0,60))console.log('RU-AUDIT '+result.path+':'+result.line+' — '+result.words);
console.log('RU-AUDIT: Обнаружено '+candidates.length+' фрагментов с латиницей в статическом тексте интерфейса. Требуется содержательная проверка, включая допустимые имена и марки.');

const blockingExamples=[
 ['components/game/GhostPolicyLab.tsx',/Ghost voting/],
 ['components/game/ParticipantsAnalytics.tsx',/Источник баллов: stage_assessments/],
 ['components/game/SystemDebriefLab.tsx',/ИЗМЕНЕНИЯ KPI/],
 ['components/game/ScoreFormula.tsx',/ВСН = max\(/],
 ['components/game/DocumentPaper.tsx',/<h1>\{titleSlot\|\|d\.title\}<\/h1>/]
];
for(const [file,expression] of blockingExamples){
 const content=fs.readFileSync(path.join(root,file),'utf8');
 if(expression.test(content))throw new Error('Непереведённая подпись в '+file+': '+expression.source);
}
console.log('RU-AUDIT: Проверка известных утечек технических и английских названий пройдена.');
