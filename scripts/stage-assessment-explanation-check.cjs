const fs=require('node:fs');
const assert=require('node:assert/strict');
const Module=require('node:module');
const ts=require('typescript');
const path='components/game/assessmentPresentation.ts';
const moduleRef=new Module(path,module);
moduleRef.filename=path;moduleRef.paths=module.paths;
moduleRef._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,path);
const {assessmentRationaleParagraphs,assessmentRationaleSections,assessmentRationaleDetail,assessmentDisplaySentence}=moduleRef.exports;
const original=[
 'Критерий 1 · право и правила: пока не подтверждён. НПА 0, процедурных действий 0, голосований по НПА 0, партийных документов 0, иных документов 0, правовых упоминаний 0.',
 'Критерий 2 · стратегия и интересы: пока не подтверждён. Публикаций 0, голосований 0, действий/решений 0, партийных инициатив 0, ответов на партийные приглашения 0.',
 'Критерий 3 · итоговый разбор: пока не подтверждён. Разбор не представлен, аналитических связок в обсуждении 0.',
 'Автооценка: 0/3 — участия на этапе не зафиксировано.',
 'Блиц и правовые знания: 0.08/1. Максимум: кейсы 0,30; действия 0,30; правильность блица 0,30; полнота 0,10. Итоговый автоматический расчёт: 0.08/3.',
 'События: правомерных решений в пределах полномочий 0, нарушений 0.',
 'Правовой критерий: 0.08 балла из 1.'
].join(' ');
const paragraphs=assessmentRationaleParagraphs(original);
assert.equal(paragraphs.join(' '),original,'Saved rationale must be preserved byte-for-byte under paragraph joining');
const sections=assessmentRationaleSections(original);
for(const type of ['law','strategy','debrief','automatic','events','legal','blitz'])
 assert.equal(sections[type].length,1,'Wrong split for '+type);
assert.equal(sections.other.length,0,'No recognized factual explanation is lost');
assert(sections.law[0].includes('НПА 0'),'Legal evidence retained');
assert(sections.strategy[0].includes('публикаций'.replace('п','П')),'Strategy evidence retained');
assert(sections.blitz[0].includes('0.08/1'),'Fractional legal knowledge remains verbatim');
assert(sections.legal[0].includes('0.08 балла'),'Fractional right indicator remains verbatim');
assert(assessmentRationaleDetail(sections.law[0]).startsWith('Пока не подтверждён'),'Capitalizes sentence after machine heading');
assert.equal(assessmentRationaleSections('Неизвестный формат пояснения').other[0],'Неизвестный формат пояснения','Unknown server material remains visible');
assert(assessmentRationaleDetail(sections.strategy[0]).startsWith('Пока'),'Strategy starts with a capital');
assert(assessmentRationaleDetail(sections.debrief[0]).startsWith('Пока'),'Debrief starts with a capital');
assert(assessmentRationaleDetail(sections.events[0]).startsWith('Правомерных решений'),'Event detail begins with a capital');
assert(assessmentRationaleDetail(sections.automatic[0]).startsWith('0/3'),'Numerical scores remain unchanged');
assert(assessmentRationaleDetail(sections.legal[0]).startsWith('0.08 балла'),'Numerical legal score remains unchanged');
assert.equal(assessmentDisplaySentence('«правомерных решений»'),'«Правомерных решений»','Capitalize the first word after quotation marks');
assert.equal(assessmentDisplaySentence('  (пока не подтверждён)'), '(Пока не подтверждён)','Capitalize inside opening punctuation');
assert.equal(assessmentDisplaySentence('пока не подтверждён'),'Пока не подтверждён','Capitalization is idempotent');
assert.equal(assessmentDisplaySentence('Пока не подтверждён'),'Пока не подтверждён','Do not modify already capitalized text');
assert.equal(assessmentDisplaySentence('0.08 балла'), '0.08 балла','Never alter the unit after a numeric score');
assert.equal(sections.events[0],'События: правомерных решений в пределах полномочий 0, нарушений 0.','Original evidence must remain intact');

const ui=fs.readFileSync('components/game/GradesView.tsx','utf8');
const css=fs.readFileSync('app/2026-profile-grade-layout.css','utf8');
assert(ui.includes("assessmentRationaleParagraphs(a.public_rationale)"),'Use original server rationale');
assert(ui.includes("law:a.criterion_law,strategy:a.criterion_strategy,debrief:a.criterion_debrief"),'Criterion statuses reflect server flags');
assert(ui.includes("AssessmentExplanation assessment={a}"),'Explanations appear in assessment');
for(const title of ['Законность решений и соблюдение процедур','Политическая стратегия и участие','Обоснованный анализ результатов этапа','Дополнительные сведения о расчёте'])
 assert(ui.includes(title),'Missing plain-language heading: '+title);
assert(ui.includes('Что зафиксировано системой'),'Original counts remain inspectable');
assert(ui.includes('assessmentRationaleDetail(part)'),'Original details are rendered');
assert(ui.includes('assessmentDisplaySentence(part)'),'Unclassified server explanation also gets an uppercase first letter');
assert(css.includes('.gradeExplanationCriteria')&&css.includes('@media(max-width:600px)'),'Cards fit mobile');
assert(ui.includes('setRows('),'Score query remains intact');
console.log('PASS: all three criteria explained, extra metrics separated, evidence and scores preserved');
