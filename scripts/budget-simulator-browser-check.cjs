/* The pre-2026-10-09 simulator browser flow assumed seven income rows and
 * legacy tabs. The maintained acceptance test exercises the real five-step
 * interface, regional event requests, detailed income and expense lines, the
 * adopted budget-law annex, money precision, roles and responsive geometry.
 * Keep this entrypoint for historical CI and local scripts. */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const test=spawnSync(process.execPath,[path.join(__dirname,'budget-workflow-browser-check.cjs')],{stdio:'inherit',env:process.env});
if(test.error)throw test.error;
if(test.signal)throw Error('Budget workflow browser test terminated: '+test.signal);
process.exitCode=test.status??1;
