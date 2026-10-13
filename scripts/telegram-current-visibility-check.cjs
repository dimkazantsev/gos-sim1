const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const load=(path,mocks={})=>{const m=new Module(path,module);m.filename=path;m.paths=module.paths;const old=m.require.bind(m);m.require=name=>mocks[name]||old(name);m._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,path);return m.exports};
const game=load('components/game/chatChannelSelection.ts');
const helper=load('lib/server/telegramVisibleChatChannels.ts',{'@/components/game/chatChannelSelection':game});
const rooms=[
{id:'p',game_id:'g',kind:'public',name:'Публичная политика'},
{id:'a',game_id:'g',kind:'team',name:'Архив фракции'},
{id:'t',game_id:'g',kind:'team',name:'Фракция'},
{id:'priv',game_id:'g',kind:'private',name:'А · Б'},
{id:'incomplete',game_id:'g',kind:'private',name:'А · В'},
{id:'foreign',game_id:'other',kind:'public',name:'Чужой канал'}];
const memberships=[{channel_id:'a',user_id:'u'},{channel_id:'t',user_id:'u'},{channel_id:'priv',user_id:'u'},{channel_id:'priv',user_id:'v'},{channel_id:'incomplete',user_id:'u'}];
const source={game_members:[{game_id:'g',user_id:'u',kind:'student',roster_archived_at:null}],chat_channels:rooms,channel_members:memberships};
const db={from(table){let filters=[];const run=()=>({error:null,data:(source[table]||[]).filter(r=>filters.every(([op,key,val])=>op==='in'?val.includes(r[key]):r[key]===val))});return{select(){return this},eq(k,v){filters.push(['eq',k,v]);return this},is(k,v){filters.push(['is',k,v]);return this},in(k,v){filters.push(['in',k,v]);return this},maybeSingle(){const x=run();return Promise.resolve({...x,data:x.data[0]||null})},then(resolve,reject){return Promise.resolve(run()).then(resolve,reject)}}}};
(async()=>{
const list=await helper.telegramVisibleChatChannels(db,'g','u');
assert.deepEqual(list.map(c=>c.id).sort(),['p','priv','t']);
const hook=fs.readFileSync('app/api/telegram/webhook/route.ts','utf8');
const queue=fs.readFileSync('app/api/telegram/dispatch/route.ts','utf8');
assert.equal((hook.match(/telegramVisibleChatChannels\(config\.db,game\.game_id,game\.user_id\)/g)||[]).length,3);
assert.ok(hook.includes(".in('channel_id',ids)"));
assert.ok(queue.includes('Chat message deleted'));
assert.ok(queue.includes("from('chat_mentions')"));
assert.ok(queue.includes("is('deleted_at',null)"));
assert.ok(queue.includes('Delivery document deleted'));
console.log('PASS Telegram visible chat parity and queued stale-content guards');
})().catch(e=>{console.error(e);process.exitCode=1});