/* Regression for the chat header showing a room while the composer says "Выберите чат". */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const file='components/game/chatChannelSelection.ts';
const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const {visibleChatChannels,resolveChatChannelId}=mod.exports;
const channels=[
 {id:'public',name:'Публичная политика',kind:'public'},
 {id:'team',name:'Фракция · Север',kind:'team'},
 {id:'archive',name:'Архив заседаний',kind:'public'},
 {id:'dup',name:'Иванов · Иванов',kind:'private'}
];
const overview=[
 {channel_id:'public',last_sent_at:'2026-10-12T13:00:00Z'},
 {channel_id:'team',last_sent_at:'2026-10-13T03:00:00Z'}
];
const available=visibleChatChannels(channels,overview);
assert.deepEqual(available.map(c=>c.id),['public','team']);
assert.equal(resolveChatChannelId(available,'team','public',overview),'team','valid manual selection must stay selected');
assert.equal(resolveChatChannelId(available,'','public',overview),'public','restore remembered conversation first');
assert.equal(resolveChatChannelId(available,'','',overview),'team','otherwise choose most recently active channel');
assert.equal(resolveChatChannelId(available,'deleted','deleted',overview),'team','deleted channel must not remain selected');
assert.equal(resolveChatChannelId(available,'','',[]),'public','fresh channel without messages must be selectable');
assert.equal(resolveChatChannelId([], 'old','old',overview),'','no visible channels cannot send');
assert.deepEqual(visibleChatChannels(channels,[overview[0]]).map(c=>c.id),['public'],'restrict visible options to overview when present');

const dropdown=fs.readFileSync('components/game/ChatChannelDropdown.tsx','utf8');
const game=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const panel=fs.readFileSync('components/game/ChatPanel.tsx','utf8');
assert.ok(dropdown.includes('const current=visibleChannels.find(c=>c.id===value);'),'header must not display an unselected fallback');
assert.ok(!dropdown.includes('||orderedChannels[0]'),'header must not silently show a different chat');
assert.ok(game.includes('resolveChatChannelId(available,channelId,saved,chatOverview)'),'actual chat ID must be resolved from visible options');
assert.ok(game.includes('recalledChatChannel(visibleMe.user_id,available)'),'persisted chat must be restored');
assert.ok(game.includes('rememberChatChannel(next,visibleMe.user_id)'),'selected chat must be remembered even without sending');
assert.ok(!game.includes('if(lastSent&&lastSent!==channelRef.current'),'opening chat must not override manual choice');
assert.ok(panel.includes('value={channelId}'),'dropdown must show active messaging channel');
assert.ok(panel.includes('placeholder={channelId?'),'composer must use the same active channel');
console.log('PASS chat selection/header/composer agree; restore, last activity, filtering and manual choice regressions.');
