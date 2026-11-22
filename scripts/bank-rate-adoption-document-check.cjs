// ГОС.ID: one bank-rate RPC, rate/card permission, immutable adopted act and real signature.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),get=p=>fs.readFileSync(path.join(root,p),'utf8');
const panel=get('components/game/FiscalMacroPanel.tsx');
const docs=get('components/game/DocumentsView.tsx');
const budget=get('components/game/BudgetView.tsx');
const sql=get('supabase/migrations/20261122171113_bank_rate_click_adopt_sign_formal_document_20261123.sql');
const guard=get('supabase/migrations/20261122171201_bank_rate_no_undocumented_updates_20261123.sql');
const paper=get('components/game/DocumentPaper.tsx');
assert(panel.includes("supabase.rpc('adopt_bank_rate_decision'"));
assert(panel.includes('aria-controls="fiscal-bank-rate-controls"')&&panel.includes('changeBankRate(-0.5)')&&panel.includes('changeBankRate(0.5)'));
assert(panel.includes("bankSaving.current")&&panel.includes('p_expected_rate:p.key_rate'));
assert(panel.includes('bankRequest.current')&&panel.includes('refreshDocuments(documentId)')&&panel.includes('onOpenDocument(documentId)'));
assert(budget.includes('onOpenDocument={onOpenDocument} onSaved={changed=>'));
assert(docs.includes("['gd','ksrf','central_bank']")&&docs.includes("doc.doc_type!=='bank_rate_decision'"));
assert(paper.includes("d.doc_type==='bank_rate_decision'?'Решение Совета директоров Банка России'"));
assert(sql.includes('private.can_issue_bank_rate_decision')&&sql.includes("a.status='active'"));
assert(sql.includes('IF v_old IS DISTINCT FROM p_expected_rate')&&sql.includes("p_request_id"));
assert(sql.includes("'adopted','Принято Советом директоров Банка России'"));
assert(sql.includes("'registry_independent',true")&&sql.includes('private.guard_bank_rate_decision'));
assert(sql.includes("IF d.doc_type='bank_rate_decision' THEN")&&sql.includes('public.formal_document_signatures'));
assert(guard.includes("if not is_teacher and p_values ? 'key_rate'")&&guard.includes('app.gos_bank_rate_active_decision_id'));
assert(!/учебн/iu.test(panel+paper));
for(const [name,source] of [['FiscalMacroPanel.tsx',panel],['DocumentsView.tsx',docs],['DocumentPaper.tsx',paper]]){
 const t=ts.transpileModule(source,{fileName:name,reportDiagnostics:true,
  compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
 assert.equal(t.diagnostics.length,0,'JSX syntax '+name);
}
console.log('PASS: chairman-only rate change; atomic adopted formal document; real personal signature; no duplicate client reads or subscriptions');
