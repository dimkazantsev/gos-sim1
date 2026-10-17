const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const exported={};
new Function('exports',ts.transpileModule(fs.readFileSync(path.join(root,'lib/gameLabels.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exported);
const {gameValueLabel:label,gameViewLabel:view,impactConditionText:conditions}=exported;
for(const [raw,ru]of Object.entries({teacher:'Преподаватель',submitted:'На рассмотрении',yes:'За',no_quorum:'Нет кворума',formal_transition:'Движение документа',economy:'Экономика',party_statistics_adjusted:'Корректировка статистики партии'}))assert.equal(label(raw),ru);
assert.equal(view('actions'),'Политический процесс');
assert.equal(view('future_view_key'),'Раздел игры');
assert.equal(label('future_enum_key','Результат не зафиксирован'),'Результат не зафиксирован');
assert.equal(label('Одобрено'),'Одобрено');
assert.equal(label('toString'),'Не указано');
assert.equal(label(null),'Не указано');
assert.equal(label('Ghost voting'),'Goust Voting');
const rules=[
 {intensity:'high'},
 {to_status:['published','signed','adopted']},
 {actor_key:['president','government','gd','sf','ministry','municipality']},
 {result_code:'no_quorum'},
 {stage_no:0,unknown_condition:false}
];
const original=JSON.stringify(rules);
for(const rule of rules)assert.doesNotMatch(conditions(rule),/[A-Za-z_]/);
assert.equal(conditions(rules[0]),'Интенсивность: Высокая');
assert.equal(conditions(rules[1]),'Новая стадия документа: Опубликовано, Подписано, Принято');
assert(conditions(rules[4]).includes('Этап: 0')&&conditions(rules[4]).includes('Нет'));
assert.equal(JSON.stringify(rules),original,'Rendering must not alter stored rule JSON');
const userErrors={};
new Function('exports',ts.transpileModule(fs.readFileSync(path.join(root,'lib/userError.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(userErrors);
for(const error of ['Не найден internal_document_key','Candidate dossier is incomplete: consent, passport','Unknown server failure'])assert.doesNotMatch(userErrors.userError(error),/[A-Za-z_]/);
assert.equal(userErrors.userError('Проверьте обязательное поле.'),'Проверьте обязательное поле.');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const Module=require('node:module'),m=new Module(path.join(root,'components/game/RichPostText.tsx'),module);m.paths=module.paths;
m._compile(ts.transpileModule(fs.readFileSync(path.join(root,'components/game/RichPostText.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,'RichPostText.js');
for(const text of ['[Материалы этапа](gos:stages?stage=3)','[Протокол](gos:votes?id=vote-1)','[Документ](gos:documents?id=doc-1)']){
 const calls=[];
 const props={text,onNavigate:(...args)=>calls.push(['stage',...args]),onOpenDocument:id=>calls.push(['document',id]),onOpenVotes:id=>calls.push(['vote',id])};
 const html=renderToStaticMarkup(React.createElement(m.exports.default,props));
 const element=m.exports.default(props);
 element.props.children.find(child=>child&&child.type==='button').props.onClick();
 assert.deepEqual(calls,text.includes('gos:stages')?[['stage','stages',{stageNo:3}]]:text.includes('gos:votes')?[['vote','vote-1']]:[['document','doc-1']]);
 assert.match(html,/<button/);assert.doesNotMatch(html,/gos:|\?stage=/);
}
console.log('PASS: persisted enum captions, Russian conditions and errors, immutable data and stage/document/vote links.');
