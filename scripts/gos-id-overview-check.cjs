/* ГОС.ID branding and political-process overview source contract. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const blue=read('public/brand/gos-id-blue.svg');
const pink=read('public/brand/gos-id-pink.svg');
for(const [name,content,background,idColor] of [
 ['blue',blue,'#2354E6','#F29BC4'],['pink',pink,'#F29BC4','#2354E6']
]){
 assert(content.includes('ГОС')&&content.includes('.ID'),name+' logo must spell ГОС.ID');
 assert(content.includes('<rect width="256" height="256" rx="56" fill="'+background+'"'),name+' background incorrect');
 assert(content.includes('fill="'+idColor+'">.ID</text>'),name+' ID color incorrect');
 console.log('PASS ГОС.ID '+name+' SVG logo');
}
const layout=read('app/layout.tsx'),entry=read('app/page.tsx'),client=read('components/GameClient.tsx'),publicScreen=read('components/PublicScreen.tsx');
assert(layout.includes("applicationName:'ГОС.ID'"));
assert(layout.includes("Цифровая платформа Российской Федерации"));
assert(layout.includes("'./gos-id-brand.css'"));
assert(entry.includes('/brand/gos-id-blue.svg')&&entry.includes('ГОС<span>.ID</span>'));
assert(client.includes('/brand/gos-id-blue.svg')&&client.includes('/brand/gos-id-pink.svg'));
assert(publicScreen.includes('/brand/gos-id-pink.svg'));
assert(client.includes("'gos-sims-sidebar:'"),'Do not break existing sidebar preferences');
assert(client.includes("'gos-sims-dock:'"),'Do not break existing mobile dock preferences');
assert(read('components/game/useRepublicGame.ts').includes("'gos-sims:last-chat:'"),'Do not reset last active chat');
for(const file of ['app/page.tsx','app/loading.tsx','app/poll/page.tsx','app/layout.tsx','components/GameClient.tsx','components/PublicScreen.tsx','components/game/PoliticalWallView.tsx','components/game/RepublicComic.tsx','components/game/TelegramConnection.tsx','components/game/PublisherAvatar.tsx','components/game/DocumentPaper.tsx','components/game/Achievements.tsx','components/game/useRepublicGame.ts','app/api/telegram/webhook/route.ts','components/game/portableSession.ts']){
 assert(!/GOS\/\/SIMS/.test(read(file)),'Old visible brand remains in '+file);
}
console.log('PASS common game, login, public and Telegram brand');
const dash=read('components/game/DashboardView.tsx');
assert(dash.includes("from('political_posts')"),'Overview must use the actual political process');
assert(dash.includes(".is('deleted_at',null)"),'Overview must exclude deleted posts');
assert(dash.includes(".order('pinned',{ascending:false}).order('created_at',{ascending:false}).limit(4)"),'Overview must preserve wall order and use a small query');
assert(!dash.includes('events.slice(')&&!dash.includes("from('game_events')"),'Legacy game_events must not be queried or rendered in the political-process overview');
assert(dash.includes('document.visibilityState')&&dash.includes("window.addEventListener('focus',onReturn)"),'Overview should update after returning to tab');
assert(dash.includes('30000'),'Polling must be bounded; no high frequency requests');
assert(dash.includes('Публикаций пока нет'),'Empty political feed must not show old game events');
console.log('PASS political overview: active posts only, light query, focus sync and empty state');
