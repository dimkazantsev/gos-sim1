// Targeted no-network contract check: oil cutoff changes only after lawful publication.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const base=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(base,p),'utf8');
const sql=read('supabase/migrations/20261122174156_cutoff_price_law_workflow_20261123.sql');
const sfSql=read('supabase/migrations/20261124213000_teacher_models_federation_council.sql');
const panel=read('components/game/FiscalMacroPanel.tsx');
const editor=read('components/game/CutoffPriceProposalEditor.tsx');
const votes=read('components/game/proceduralVoting.ts');
const docs=read('components/game/DocumentsView.tsx');
const game=read('components/GameClient.tsx');
assert(sql.includes("a.role_title='Министерство по экономической политике'"));
assert(sql.includes("a.status='active'")&&sql.includes('private.role_is_available(p_game,p_user)'));
assert(sql.includes('p_expected_price')&&sql.includes("v_old IS DISTINCT FROM p_expected_price"));
assert(sql.includes('UNIQUE(game_id,author_id,request_id)'));
assert(sql.includes("current_setting('app.gos_cutoff_bill_create_id',true)"));
assert(sql.includes("v_steps:=jsonb_insert(private.formal_workflow('bill'),'{1}'"));
assert(sql.includes("p_document.status_code in ('government','sf')")||sql.includes("p_document.status_code IN ('government','sf')"));
assert(sql.includes("d.status_code='reading3'")&&sql.includes("cutoff_price_proposal','false')<>'true'"));
assert(sql.includes("OLD.status_code NOT IN ('president','veto_overridden')"));
assert(sql.includes("v.procedure_key='cutoff_government_submission'"));
assert(sql.includes("v.procedure_key='cutoff_sf_review'"));
assert(sql.includes("v.result_code='passed' AND v.result_quorum_met"));
assert(sql.includes("p.sf_confirmed_at IS NOT NULL"));
assert(sql.includes("cutoff_price=p.new_price")&&sql.includes("INSERT INTO public.fiscal_change_ledger"));
assert(editor.includes("supabase.rpc('propose_cutoff_price_bill'"));
assert(editor.includes('p_expected_price:price')&&editor.includes('readOnly'));
assert(editor.includes('disabled={busy||!canSubmit}')&&editor.includes('await g.refreshDocuments(id)'));
assert(panel.includes('label===\'Цена отсечения\'&&canViewCutoff'));
assert(panel.includes('readOnly={readOnly} onClose={()=>setCutoffOpen(false)}'));
// The later teacher-model migration replaces the former student SF vote.
const compiled=ts.transpileModule(votes,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const presets={};
require('node:vm').runInNewContext(compiled,{exports:presets,require:name=>{assert.equal(name,'./votingBodies');return {VOTING_BODIES:[]}}});
const bill={workflow_key:'bill',doc_type:'fz_bill',title:'Цена отсечения',metadata:{cutoff_price_proposal:true}};
assert.equal(presets.votePresetForDocument({...bill,status_code:'government'}).procedureKey,'cutoff_government_submission');
assert.equal(presets.votePresetForDocument({...bill,status_code:'sf'}),null,'SF is modeled by teacher; no separate student vote');
for(const status of ['reading1','reading2','reading3'])assert.equal(presets.votePresetForDocument({...bill,status_code:status}).procedureKey,'bill_'+status);
const sf=sfSql.split('CREATE OR REPLACE FUNCTION public.confirm_cutoff_sf_review(')[1].split('CREATE OR REPLACE FUNCTION public.advance_formal_document(')[0];
assert(sf.includes('NOT private.is_game_teacher(d.game_id)')&&sf.includes("d.status_code<>'sf'")&&sf.includes("d.current_owner_key IS DISTINCT FROM 'sf'"));
assert(sf.includes("v.formal_document_id=d.id AND v.status='open'")&&sf.includes('sf_confirmed_by=v_uid,sf_confirmed_at=now()'));
assert(sf.includes("status_code='president'")&&sf.includes("status_code='rejected'"));
assert(sfSql.includes('Отдельное процедурное голосование сенаторов не проводится.'));
assert(docs.includes("supabase.rpc(selected.workflow_key==='budget'?'confirm_budget_sf_review':'confirm_cutoff_sf_review'"));
assert(docs.includes("selected.status_code!=='sf'||readOnly||!teacher||busy"));
assert(docs.includes("selected.metadata?.cutoff_price_proposal!==true"));
assert(docs.includes("teacher&&!readOnly")&&docs.includes("linkedOpenVote"));
assert(game.includes('readOnly={previewMode||observer}'));
for(const file of ['components/game/FiscalMacroPanel.tsx','components/game/CutoffPriceProposalEditor.tsx','components/game/proceduralVoting.ts','components/game/DocumentsView.tsx']){
 const tree=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,
  compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
 assert.equal(tree.diagnostics.length,0,file+' has a JSX/TypeScript parse error');
}
console.log('PASS: appointed minister, non-writing teacher preview, Government/Duma/Senate/President route, unique law effect, no polling');
