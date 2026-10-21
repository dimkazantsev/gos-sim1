'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const migration=fs.readFileSync('supabase/migrations/20261021192001_event_case_three_verified_real_incidents.sql','utf8');
const answers=fs.readFileSync('components/game/EventChoicePanel.tsx','utf8');
const legal=fs.readFileSync('supabase/migrations/20261021193035_event_three_best_options_federal_law_basis.sql','utf8');
const bank=fs.readFileSync('components/game/EventAutopilotPanel.tsx','utf8');
const caseKeys=['bank-budget-bridge','bank-budget-health','bank-budget-school'];
for(const key of caseKeys)assert(migration.includes("case_key='"+key+"'"),'Missing grounded event: '+key);
const entries=[...migration.matchAll(/situation='((?:''|[^'])*)'/g)];
assert.equal(entries.length,3,'Three events need complete source-backed situations');
for(const [,description] of entries){
 const words=description.trim().split(/\s+/u);
 assert(words.length>=200,'A situation is shorter than 200 words: '+words.length);
 assert(!/учебная модель|срок учебного задания|GOS\/\/SIMS/u.test(description),'No fabricated provenance in real situations');
}
for(const fragment of ['NOT EXISTS (SELECT 1 FROM public.event_assignments','NOT EXISTS (SELECT 1 FROM public.event_decisions','source_url=','source_note=']){
 assert(migration.includes(fragment),'Missing preservation/source guard: '+fragment);
}
assert(!/DELETE FROM public.event_cases/i.test(migration),'Do not delete events');
for(const clause of ['Федеральный закон от 08.11.2007 № 257-ФЗ','Федеральный закон от 21.11.2011 № 323-ФЗ','Федеральный закон от 29.12.2012 № 273-ФЗ'])assert(legal.includes(clause),'Missing actual statutory basis');
assert(legal.includes("o.item->>'key'=c.effect_plan->>'best_option_key'"),'Only best-option explanation changes');
assert(legal.includes('WITH ORDINALITY'),'Preserve option order');
assert(!/SET\s+status\s*=|DELETE\s+FROM/i.test(legal),'Do not alter event status or historical decisions');
assert(!/SET[\s\S]{0,160}effect_plan=/i.test(migration),'Keep scoring untouched');
assert(answers.includes('publishedLegalBasis'),'Filter unsupported legal references');
assert(answers.includes('showCorrectExplanation&&i===correctIndex'),'Disclose only the canonical outcome');
assert(bank.includes('source_url,comic_scene'),'Load official source URLs with the bank');
assert(bank.includes('Документальный источник события не подтверждён'),'Unsourced events must remain explicitly unverified');
console.log('PASS: three documented long events with source URLs, no changed answers/scores or live assignments');
