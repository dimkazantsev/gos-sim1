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
const secondBatch=fs.readFileSync('supabase/migrations/20261021194700_event_four_official_cases_20261022.sql','utf8');
for(const key of ['bank-bus','bank-curated-serious-03','bank-curated-serious-06','bank-curated-serious-23']) {
 assert(secondBatch.includes("c.case_key='"+key+"'"),'Missing official event '+key);
}
const fourDescriptions=[...secondBatch.matchAll(/situation='((?:''|[^'])*)'/g)];
assert.equal(fourDescriptions.length,4,'Four event texts must be present');
for(const [,body] of fourDescriptions){
 assert(body.trim().split(/\s+/u).length>=200,'Official case must have at least 200 meaningful words');
 assert(!/учебная модель|срок учебного задания|GOS\/\/SIMS/iu.test(body),'No fabricated provenance');
}
for(const law of ['№ 220-ФЗ','№ 181-ФЗ','№ 35-ФЗ','№ 323-ФЗ'])assert(secondBatch.includes(law),'Missing law '+law);
for(const guard of ['event_assignments','event_decisions','event_case_outcomes','event_collaboration_invites','event_discussion_messages','event_authority_evidence','budget_transfer_requests'])assert(secondBatch.includes(guard),'Missing assigned-case protection '+guard);
assert(secondBatch.includes('WITH ORDINALITY'),'Preserve option order and scores');
assert(secondBatch.includes("effect_plan->>'best_option_key'"),'Do not change correct answer key');
assert(!/DELETE FROM public.event_cases/i.test(secondBatch),'Do not delete any cases');
const thirdBatch=fs.readFileSync('supabase/migrations/20261021200838_event_six_real_official_incidents_20261022.sql','utf8');
const sixKeys=['bank-expanded-serious-05-01','bank-expanded-serious-22-01','bank-curated-serious-02','bank-expanded-serious-07-01','bank-curated-serious-18','bank-expanded-serious-01-01'];
const storyMatches=[...thirdBatch.matchAll(/situation='((?:''|[^'])*)'/g)];
assert.equal(storyMatches.length,6,'Six source-backed situations must be stored in the migration');
for(const [,body] of storyMatches){
 assert(body.trim().split(/\s+/u).length>=200,'Each grounded situation must have >=200 words');
 assert(!/учебная модель|игровое досье|срок учебного задания|GOS\/\/SIMS/iu.test(body),'Do not claim fictional provenance');
}
for(const key of sixKeys)assert(thirdBatch.includes("c.case_key='"+key+"'"),'Missing revised case '+key);
for(const guard of ['event_assignments','event_decisions','event_case_outcomes','event_collaboration_invites','event_discussion_messages','event_authority_evidence','budget_transfer_requests'])
 assert(thirdBatch.includes(guard),'Do not mutate past assignments or results: '+guard);
for(const law of ['№ 273-ФЗ','№ 52-ФЗ','№ 68-ФЗ','№ 257-ФЗ','Жилищный кодекс'])assert(thirdBatch.includes(law),'Missing checked legal authority '+law);
assert(thirdBatch.includes('WITH ORDINALITY'),'Keep existing order and best answer key');
assert(thirdBatch.includes("effect_plan->>'best_option_key'"),'Require pre-existing answer key');
assert(!/DELETE FROM public.event_cases|UPDATE\s+public\.event_decisions|SET\s+verified\s*=\s*true/i.test(thirdBatch),'Do not erase games or bypass editorial acceptance');

assert(!/SET\s+status\s*=|UPDATE\s+public\.event_decisions/i.test(secondBatch),'Do not change decisions or status');
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
