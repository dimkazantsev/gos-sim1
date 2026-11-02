const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const start=src.indexOf('async function hydrateTeacherWorkspace(');
const end=src.indexOf('async function loadOlderPoliticalPosts(',start);
assert(start>=0&&end>start,'Teacher hydration function must exist');
const body=src.slice(start,end);
function has(value){assert(body.includes(value),'Expected '+value)}
function lacks(value){assert(!body.includes(value),'Unnecessary workspace dependency '+value)}
has("if(workspace==='impact')jobs.push(loadImpactEngine())");
lacks("['impact','analytics'].includes(workspace)");
lacks("['participants','parties','tools'].includes(workspace)");
lacks("['stages','journal','analytics','grades','awards'].includes(workspace)");
lacks("loadPartyDossierRows()");
has("if(workspace==='parties')jobs.push(loadPartyAssets(true))");
has("if(['journal','analytics','tools'].includes(workspace))jobs.push(loadClassroomTelemetry())");
has("if(['parties','tools'].includes(workspace))jobs.push(loadPartyRepresentation(false))");
has("if(workspace==='stages'&&!formalFullVersion.current)await loadFormalDetails()");
const lazy=src.slice(src.indexOf('function passiveSections('),src.indexOf('const initialCoreReads',src.indexOf('function passiveSections(')));
assert(!lazy.includes("['grades','journal','analytics','awards','stages']"),'Do not recover unused evaluations for analytics');
assert(!lazy.includes("['participants','parties'].includes(workspace)"),'Roster must not fetch profiles during passive recovery');
console.log('PASS: teacher workspace scoped reads, event/telemetry dependencies, no redundant dossiers');
