/* Contract for the existing official paper standard (screen + print). */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
const institutions=read('components/game/formalInstitutions.ts');
const compiled=ts.transpileModule(institutions,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const m={exports:{}};
vm.runInNewContext(compiled,{module:m,exports:m.exports});
const title=m.exports.formalDocumentTitle;
const examples=[
 ['Повестка заседания · ksrf · этап 3','meeting_agenda','Повестка заседания КСРФ'],
 ['Протокол заседания Координационного совета регионов и фракций','minutes','Протокол заседания КСРФ'],
 ['Повестка заседания Государственной Думы — этап 4','meeting_agenda','Повестка заседания Государственной Думы'],
 ['Протокол заседания · government · этап 9','minutes','Протокол заседания Правительства Российской Федерации'],
 ['Повестка заседания · sf · этап 8','meeting_agenda','Повестка заседания Совета Федерации Федерального Собрания Российской Федерации'],
 ['Постановление Государственной Думы — этап 4','gd_resolution','Постановление Государственной Думы'],
 ['Указ Президента Российской Федерации','president_decree','Указ Президента Российской Федерации'],
 ['Название, указанное автором','other','Название, указанное автором']
];
for(const [original,kind,expected] of examples){
 assert.equal(title(original,kind),expected,'Official document heading: '+original);
}
const paper=read('components/game/DocumentPaper.tsx');
assert(paper.includes('formalDocumentTitle(d.title,d.doc_type)'),'Existing paper title helper preserved');
assert(paper.includes('<span>{footerInstitution}</span>{footerSlot}'),'Paper and print footer must name an issuing public authority');
assert(paper.includes("d.subject_key==='gd_deputy'")&&paper.includes("d.subject_key==='sf_member'"),'Bills cite the relevant chamber rather than the country in their footer');
assert(!paper.includes('Учебный документ'),'Paper must not present itself as educational');
assert(paper.includes('className="formalPaperInstitution">{issuer}'),'The same authority remains in masthead');
const view=read('components/game/DocumentsView.tsx');
assert(!view.includes('Этап игры:')&&!view.includes('Документы игры'),'The document workspace must not advertise simulation metadata');
assert(view.includes('<DocumentPaper document={selected}'),'Central paper used in main document viewer');
assert(view.includes('printOfficialDocument()'),'Printing isolates the same approved paper markup on A4, not dashboard panels');
assert(!view.includes('{selected.registry_no} · Этап {selected.stage_no}'),'Internal stage not shown in paper heading');
const sql=read('supabase/migrations/20261017204000_official_meeting_document_titles.sql');
assert(sql.includes("v_title:=case when v_org_gen is null"),'Future meeting titles from official institution');
assert(!/v_title\s*:=.*этап/i.test(sql),'Stage not included in future title');
assert(sql.includes("d.metadata->>'document_kind' IN ('institution_meeting_agenda','institution_meeting_minutes')"),'Legacy backfill limited to system documents');
assert(sql.includes("WHEN 'ksrf' THEN 'Координационный Совет Российской Федерации'"),'Historical migration is not rewritten');
const correction=read('supabase/migrations/20261024041000_ksrf_documents_abbreviation.sql');
assert(correction.includes("WHEN 'ksrf' THEN 'КСРФ'"),'Current protocol generator uses only КСРФ');
assert(correction.includes("'Координационного совета регионов и фракций','КСРФ'"),'Existing protocols corrected without re-signing');
assert.equal(m.exports.formalSubjectDisplayLabel('ksrf','Координационного совета регионов и фракций'),'КСРФ');
console.log('PASS official papers: no stage captions or educational footer; issuer, metadata, editor and printing preserved.');
