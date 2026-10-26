// ГОС.ID. Verify macro policy saves remain responsive and do not add write retries.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const form=fs.readFileSync('components/game/FiscalMacroPanel.tsx','utf8');
const parent=fs.readFileSync('components/game/BudgetView.tsx','utf8');
for(const [name,src] of [['FiscalMacroPanel.tsx',form],['BudgetView.tsx',parent]]){
 const r=ts.transpileModule(src,{fileName:name,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
 assert.equal(r.diagnostics.length,0,name+' should transpile');
}
assert(form.includes("supabase.rpc('set_fiscal_policy'"),'Preserve server-authorized policy RPC');
assert(form.includes('.abortSignal(abort.signal)')&&form.includes('18000'),'Bound connection wait');
assert(form.includes("saving.current")&&form.includes('finally{'),'Prevent duplicate submissions and always release button');
assert(form.includes('onSaved(changed)')&&!form.includes('await onSaved()'),'Never block save confirmation on budget recalculation');
assert(form.includes('Решение сохранено.')&&form.includes('role="status"'),'Show confirmed writes');
assert(form.includes('Результат сохранения неизвестен'),'Ambiguous server timeout must not be called failure');
assert(!form.includes('retry('),'Do not re-submit non-idempotent RPC');
assert(parent.includes("sequence.current++;")&&parent.includes('setContext(previous=>'),
 'Discard stale reads and locally show server-confirmed macro policy');
assert(parent.includes('void g.refreshBudgetPulse?.()')&&!parent.includes('await g.refreshBudgetPulse?.()'),
 'Forecast is synchronized without locking the form');
assert(form.includes("g.teacher||key==='key_rate'"),'Preserve Bank of Russia-only rate permissions');
assert(form.includes("!draft[key]?.trim()||Number(draft[key])!==Number(context.policy[key])"),
 'Cleared numeric inputs must not be silently skipped');
const changed=(draft,previous)=>draft!==undefined&&(!draft.trim()||Number(draft)!==Number(previous));
assert(!changed('60','60'));
assert(!changed('60.0','60'));
assert(changed('70','60'));
assert(changed('','60'));
console.log('PASS fiscal save: confirmed update, bounded timeout, no duplicate write, independent refresh');
