'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261119173820_reviewed_crisis_responses_teacher_approved_news_20261120.sql','utf8');
const view=fs.readFileSync('components/game/CrisisRoom.tsx','utf8');
const css=fs.readFileSync('components/game/CrisisRoom.module.css','utf8');
const journalistic=fs.readFileSync('supabase/migrations/20261119174740_crisis_news_journalistic_editorial_and_existing_article_20261120.sql','utf8');
const rejected=fs.readFileSync('supabase/migrations/20261119175402_crisis_news_reject_publication_and_resubmit_20261120.sql','utf8');
assert(rejected.includes('publication_rejected_at timestamptz'),'Rejection must persist');
assert(rejected.includes('private.is_game_teacher(r.game_id)'),'Only teacher may decline publication');
assert(rejected.includes('IF r.published_post_id IS NOT NULL THEN'),'Already published articles cannot be declined');
assert(rejected.includes('IF r.publication_rejected_at IS NOT NULL THEN'),'Duplicate rejection is idempotent');
assert(rejected.includes("SET publication_rejected_at=clock_timestamp()"),'Rejection must be recorded once');
assert(rejected.includes('publication_rejected_at=null'),'New review or resubmission clears rejection');
assert(rejected.includes('Публикация отклонена. Для повторного рассмотрения'),'Declined response cannot be published');
assert(view.includes("supabase.rpc('reject_reviewed_crisis_news',{p_response_id:id})"),'Client calls exactly one rejection RPC');
assert(view.includes('Отклонить публикацию')&&view.includes('Подтвердить публикацию'),'Both actions appear together');
assert(view.includes('publication_rejected_at:new Date().toISOString()'),'Optimistic rejection needs no extra data fetch');
assert(css.includes('.approvalActions')&&css.includes('.rejectNewsButton'),'Matching project style');

assert(journalistic.includes('Президент поручил начать переговоры на фоне массовых протестов'),'Existing news gets an editorial headline');
const article=journalistic.split('-- Repair the one already-published item in place, preserving post identity.')[1]||'';
for(const forbidden of ['Ответ преподавателя:','Предложения опубликованы после преподавательского разбора','Правовое обоснование участника:','Публичное обращение участника:','Ресурсы и ограничения, указанные участником:']){
 assert(!article.includes(forbidden),'Classroom wording must not appear in news: '+forbidden);
}
assert(journalistic.includes("ON CONFLICT(game_id,source_key)"),'Publisher still prevents duplicates');
assert(journalistic.includes("id='14d4ef8c-4cad-491f-b391-a6d07fb8405e'::uuid"),'Existing article updated by stable ID');
assert(view.includes('Материал о мерах реагирования на кризис'), 'Teacher preview must describe news, not classroom fields');
const editorial=fs.readFileSync('supabase/migrations/20261119174140_crisis_news_editorial_neutral_russian_20261120.sql','utf8');
assert(editorial.includes('предложения участника — %s'), 'Headline must remain grammatically neutral');
assert(editorial.includes('Автор предложения: %s'), 'Author must be attributed without inventing enacted actions');
assert(sql.includes('ADD COLUMN IF NOT EXISTS published_post_id uuid'),'Publication state must be in existing response');
assert(sql.includes('private.is_game_teacher(r.game_id)'),'Only teacher can publish');
assert(sql.includes("r.status<>'reviewed'")&&sql.includes('length(btrim(coalesce(r.teacher_note'), 'Teacher response required before approval');
assert(sql.includes("v_key:='crisis-response:'||r.id::text"),'News must have stable source key');
assert(sql.includes('ON CONFLICT(game_id,source_key) WHERE source_key IS NOT NULL DO NOTHING'),'Approval must be idempotent');
assert(sql.includes("c.stage_no,'stage_source','explicit'"),'News must retain crisis stage, not last-opened stage');
assert(sql.includes("Факт исполнения предложенных мер этой публикацией не подтверждается"),'No invented effects');
assert(sql.includes("Решение уже опубликовано как новость; изменить его нельзя"),"Published student decision must be immutable");
assert(sql.includes("Новость уже опубликована; ответ больше не изменяется"),'Published teacher answer must be immutable');
assert(sql.includes("REVOKE ALL ON FUNCTION public.publish_reviewed_crisis_response(uuid) FROM PUBLIC,anon"),'Guest cannot publish');
assert(view.includes("supabase.rpc('publish_reviewed_crisis_response',{p_response_id:id})"),'One deliberate RPC, no background publication');
assert(view.includes('Подтвердить публикацию')&&view.includes('Сохранить ответ'),'Two explicit teacher steps');
assert(view.includes('disabled={readOnly||busy||plan.trim().length<20||!!myResponse?.published_post_id}'),
 'Read-only student previews and published decisions must both block submission');
assert(view.includes("active.crisis_type"),'Existing crisis data is reused');
assert(css.includes('.crisisNewsApproval')&&css.includes('@media(max-width:700px)'),'Responsive publisher controls');
console.log('PASS: crisis news is teacher-answered, explicitly approved, game-scoped, idempotent and network-sparing');
