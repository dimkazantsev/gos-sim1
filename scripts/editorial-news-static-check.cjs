'use strict';
// Source invariants. This does not replace the PostgreSQL integration assertions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const sql = read('supabase/migrations/20261015060000_verified_editorial_automatic_news.sql');
const wall = read('components/game/PoliticalWallView.tsx');
const css = read('app/editorial-news.css');
const layout = read('app/layout.tsx');
const check = (name,ok) => { assert.ok(ok,name); process.stdout.write('PASS '+name+'\n'); };

check('Stage news never republishes the task summary',
 !sql.includes('s.summary') && !sql.includes('new.summary'));
check('Committee names require actual game-scoped units',
 sql.includes("game_id = p_game AND unit_kind = 'committee'"));
check('Committee leadership requires completed election and named winner',
 sql.includes("e.status = 'finished'") && sql.includes('e.winner_candidate_id') &&
 sql.includes('c.user_id = u.head_user_id'));
check('Votes never silently replace missing counts with zero',
 sql.includes('vote.result_yes IS NOT NULL') && !sql.includes('coalesce(vote.result_yes,0)'));
check('Only public opted-in chats can affect stage reports',
 sql.includes("c.kind='public'") && sql.includes("c.name<>'Вне игры'") &&
 sql.includes("m.text ~* '#сми_gpyasu'") &&
 !sql.includes('string_agg(m.text'));
check('Archived, manually authored or deleted posts are never mass-edited',
 sql.includes("p.context->>'automatic'='true'") &&
 sql.includes("p.deleted_at IS NULL") &&
 sql.includes("p.context->>'source_table'='game_stages'"));
check('No game records deleted or truncated',
 !/\b(?:DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE)\b/i.test(sql));
check('Only verified news gets editorial presentation',
 wall.includes("auto&&(p.context?.editorial_verified||editorialFallback)?' editorialStory':''") &&
 wall.includes('publishedStageReport(p,formalDocuments,votes)'));
check('Responsive scoped visual rules are loaded',
 layout.includes("import './editorial-news.css'") &&
 css.includes('.wallPost.editorialStory') &&
 css.includes('@media(max-width:650px)'));
