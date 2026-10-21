'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const artifacts=fs.readFileSync('components/game/StageArtifacts.tsx','utf8');
const workspace=fs.readFileSync('components/game/GovernanceStageWorkspace.tsx','utf8');
const migration=fs.readFileSync('supabase/migrations/20261021190936_stage10_one_state_program_no_separate_feo.sql','utf8');
assert.match(artifacts,/10:\{title:[^\n]*templates:\[\]\}/,'Stage 10 must not create separate legal forms');
assert.match(artifacts,/stage\.stage_no===10\)/,'Only Stage 10 is modified');
assert.match(artifacts,/programDocs=docs\.filter\(d=>d\.doc_type==='state_program'\)/,'Registry links use real State Program documents');
assert.match(artifacts,/onOpenWork&&<button/,'Work-form link available');
assert.match(workspace,/onOpenWork=\{\(\)=>setTab\('work'\)\}/,'Work tab is reachable');
assert(!/10:\{title:[^\n]*financial_economic/.test(artifacts),'No Stage 10 FEO');
assert(migration.includes('private.stage_required_final_documents'),'Server document obligation must change');
assert(migration.includes('private.stage_readiness_json'),'Server stage readiness must change');
assert(migration.includes('c2<1'),'One State Program must suffice');
assert(migration.includes("status in (''ready'',''government_vote'',''adopted'')"),'A programme must have completed initial agreement');
const registryFix=fs.readFileSync('supabase/migrations/20261021194937_stage10_accept_synchronized_ministry_programme.sql','utf8');
for(const requirement of ["private.stage_required_final_documents","d.metadata->>''auto_synced''=''true''","p.id::text=d.metadata->>''state_program_id''","p.game_id=d.game_id","p.signed_at IS NOT NULL"]) {
 assert(registryFix.includes(requirement),'Work programme must match signed registry document: '+requirement);
}
assert(!registryFix.includes('GRANT ALL'),'Never bypass role protections');
assert(!migration.includes('DELETE FROM public.formal_documents'),'Never delete historical legal documents');
console.log('PASS: Stage 10 single ready programme, Work and registry links, no duplicate FEO, document history preserved');
