const assert=require('node:assert/strict');
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
function imported(path,mocks={}){
 const mod=new Module(path,module);mod.filename=path;mod.paths=module.paths;
 const original=mod.require.bind(mod);
 mod.require=id=>mocks[id]||original(id);
 mod._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText,path);
 return mod.exports;
}
const presentation=imported('lib/server/telegramPresentation.ts');
const html=presentation.telegramMessageHtml('🏛 ГОС.ID · Настройки\\n\\nТекст настройки\\n✅ Документы');
assert.ok(html.startsWith('<b>🏛 ГОС.ID · Настройки</b>\n\nТекст настройки\n✅ Документы'));
assert.ok(!html.includes('\\n'),'Visible backslash-n sequences must be converted to real newlines');
assert.equal((html.match(/<b>/g)||[]).length,1,'Only the title can be bold');
assert.ok(!html.includes('━━━━━━━━'),'No unnecessary divider');
const injection=presentation.telegramMessageHtml('Заголовок\n<важные> & "данные"');
assert.ok(injection.includes('&lt;важные&gt; &amp; &quot;данные&quot;'),'Telegram HTML must be escaped');
const hook=fs.readFileSync('app/api/telegram/webhook/route.ts','utf8');
assert.ok(hook.includes('Код обращения: '),'Human-friendly reference on creation');
assert.ok(hook.includes("Код: '+code"),'Human-friendly reference in list');
assert.ok(!hook.includes('/reply UUID'),'Never expose a technical UUID placeholder');
assert.ok(hook.includes("if(actor.kind!=='teacher')query=query.eq('recipient_id',game.user_id)"));
assert.ok(hook.includes("matching?.length!==1"),'Reject unknown or ambiguous codes');
assert.ok(hook.includes("config.db.rpc('telegram_reply_official_appeal'"),'Keep authoritative permission check in existing RPC');

const calls=[];
let postRows=[];
function from(table){
 const rules=[],orders=[];let limit=Infinity;
 const select=()=> {
  let rows=table==='game_members'?[{game_id:'g1',user_id:'u1',kind:'student',full_name:'Петров',roster_archived_at:null}]
   :table==='games'?[{id:'g1',title:'Республика',current_round:1,turn_open:true}]
   :table==='political_posts'?postRows.slice():[];
  for(const [type,key,val] of rules){
   if(type==='eq')rows=rows.filter(row=>row[key]===val);
   if(type==='is'&&val===null)rows=rows.filter(row=>row[key]===null);
  }
  for(const [field,ascending] of orders.slice().reverse()){
   rows.sort((a,b)=>{
    if(a[field]===b[field])return 0;
    return (a[field]>b[field]?1:-1)*(ascending?1:-1);
   });
  }
  return {data:rows.slice(0,limit),error:null};
 };
 const query={
  select(){return this},
  eq(k,v){rules.push(['eq',k,v]);return this},
  is(k,v){rules.push(['is',k,v]);return this},
  or(){return this},
  order(k,{ascending=true}={}){orders.push([k,ascending]);return this},
  limit(v){limit=v;return this},
  single(){const r=select();return Promise.resolve({...r,data:r.data[0]||null})},
  maybeSingle(){const r=select();return Promise.resolve({...r,data:r.data[0]||null})},
  then(resolve,reject){return Promise.resolve(select()).then(resolve,reject)}
 };
 if(table==='political_posts')calls.push({rules,orders,get limit(){return limit}});
 return query;
}
const db={from};
const card=imported('lib/server/telegramCabinet.ts',{
 './telegram':{runtimeConfig:()=>({db})},
 './telegramPresentation':{
  telegramSectionButtons:(section)=>({section}),
  telegramTaskButtons:()=>({}),
  telegramDocumentButtons:()=>({})
 }
});
async function main(){
 postRows=[
  ...Array.from({length:7},(_,i)=>({
   title:'Публикация '+i,created_at:new Date(Date.UTC(2026,9,13,7,i)).toISOString(),
   game_id:'g1',deleted_at:null,process_type:i%2?'event':'crisis_response',pinned:false
  })),
  {title:'Удалённая публикация',created_at:new Date().toISOString(),game_id:'g1',
   deleted_at:'2026-10-13T10:00:00Z',process_type:'crisis_response',pinned:true},
  {title:'Чужая республика',created_at:new Date().toISOString(),game_id:'g2',
   deleted_at:null,process_type:'crisis_response',pinned:true}
 ];
 const news=await card.telegramCabinetCard(db,'g1','u1','news');
 assert.ok(news.text.includes('Публикация 6'));
 assert.ok(!news.text.includes('Удалённая публикация')&&!news.text.includes('Чужая республика'));
 assert.equal((news.text.match(/Публикация [0-9]+/g)||[]).length,5);
 assert.ok(calls.at(-1).rules.some(x=>x[0]==='is'&&x[1]==='deleted_at'&&x[2]===null));
 assert.equal(calls.at(-1).limit,5);
 const crises=await card.telegramCabinetCard(db,'g1','u1','crises');
 assert.ok(!crises.text.includes('Удалённая публикация'));
 assert.ok(crises.text.includes('Публикация 6')&&!crises.text.includes('Публикация 5'));
 postRows=postRows.map(x=>({...x,deleted_at:'2026-10-13T10:00:00Z'}));
 const empty=await card.telegramCabinetCard(db,'g1','u1','news');
 assert.ok(empty.text.includes('пока нет публикаций'));
 assert.ok(!empty.text.includes('Публикация 0'));
 const settings=await card.telegramCabinetCard(db,'g1','u1','settings');
 const formatted=presentation.telegramMessageHtml(settings.text);
 assert.ok(!formatted.includes('\\n'));
 assert.ok(formatted.includes('\n\nНажмите на категорию'));
 assert.equal((formatted.match(/<b>/g)||[]).length,1);
 console.log('PASS Telegram: clean formatting, only title bold, safe short appeal codes, current-wall news (max 5) and no deleted posts');
}
main().catch(e=>{console.error(e);process.exitCode=1});
