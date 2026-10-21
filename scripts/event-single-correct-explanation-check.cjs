/* Event feedback must disclose only the canonical best answer after resolution.
 * Server-side render; no users, Supabase requests or production mutations. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const source=fs.readFileSync('components/game/EventChoicePanel.tsx','utf8');
const workspace=fs.readFileSync('components/game/EventWorkspace.tsx','utf8');
const sf=ts.createSourceFile('EventChoicePanel.tsx',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
assert.equal(sf.parseDiagnostics.length,0,'Result card TSX must parse');
assert(!source.includes('EventDecisionFeedback'),'Do not load selected/alternative feedback RPC after a response');
assert(!source.includes('supabase.rpc'),'Result card never requests alternative answers');
assert(workspace.includes('bestDescription={bestOption?.description} bestLegalBasis={bestOption?.legal_basis}'),
 'Only the canonical best option supplies the explanation and legal basis');
assert(workspace.includes("showCorrectExplanation={!!mineAnswer&&!!outcome&&me.kind==='student'}"),
 'Student feedback must remain hidden until the answer and outcome exist');

const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const mod={exports:{}};
function moduleFor(name){
 if(name==='react/jsx-runtime')return require('react/jsx-runtime');
 if(name==='./ProfileAvatar')return{__esModule:true,default:()=>React.createElement('span',{'data-avatar':'test'})};
 throw Error('Unexpected client dependency: '+name);
}
vm.runInNewContext('(function(require,module,exports){'+js+'})(require,module,exports)',{require:moduleFor,module:mod,exports:mod.exports,Math,Number});
const Panel=mod.exports.default;
const props={
 labels:['Верное решение','Неверный вариант A','Неверный вариант B'],
 decisions:[{actor_id:'student-a',choice:'option_3'}],
 members:[],profiles:[],currentChoice:'option_3',
 canAnswer:false,onAnswer:()=>{},revealResults:true,
 shuffleSeed:'regression',correctIndex:0,showCorrectExplanation:true,
 bestDescription:'Объяснение только правильного решения.',
 bestLegalBasis:'Проверенное правовое основание правильного решения.'
};
function markup(p){return renderToStaticMarkup(React.createElement(Panel,p))}
const html=markup(props);
assert(html.includes('Верное решение'),'The canonical correct option remains visible');
assert(html.includes('Неверный вариант A')&&html.includes('Неверный вариант B'),
 'Original selectable answers remain visible without explanations');
assert(html.includes('Объяснение только правильного решения.'),
 'The correct choice keeps its explanation');
assert(html.includes('Проверенное правовое основание правильного решения.'),
 'The correct choice keeps its legal basis');
assert.equal(html.match(/eventAnswerInlineFeedback/g)?.length||0,1,
 'Exactly one explanation, next to the best option');
assert.equal(html.match(/Наиболее обоснованный вариант/g)?.length||0,1,
 'The best-answer heading must not be duplicated');
assert(!html.includes('Как следовало действовать')&&!html.includes('Уполномоченные лица'),
 'Do not show the explanations of other lawful options or personal alternative outcomes');
const hidden=markup({...props,correctIndex:null,showCorrectExplanation:false,revealResults:false});
assert(!hidden.includes('Объяснение только правильного решения.')&&!hidden.includes('Проверенное правовое основание'),
 'Do not reveal correct answers or their explanation before the outcome');
const deduplicated=markup({...props,bestDescription:'Объяснение только правильного решения. Проверенное правовое основание правильного решения.'});
assert.equal(deduplicated.match(/Проверенное правовое основание правильного решения/g)?.length||0,1,
 'Repeated legal basis must not be printed twice');
console.log('PASS: canonical answer and explanation visible only after resolution; no other-choice feedback, duplicate heading, RPC or premature disclosure.');
