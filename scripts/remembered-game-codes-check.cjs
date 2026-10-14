const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');

const source=fs.readFileSync('lib/rememberedGameCodes.ts','utf8');
const transpiled=ts.transpileModule(source,{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const m=new Module('rememberedGameCodes.ts',module);
m.filename='rememberedGameCodes.ts';m.paths=module.paths;m._compile(transpiled,m.filename);
const {readRememberedGameCodes,rememberGameCode,forgetRememberedGameCode}=m.exports;
const data=new Map();
const store={
 getItem:key=>data.has(key)?data.get(key):null,
 setItem:(key,value)=>data.set(key,value),
 removeItem:key=>data.delete(key)
};
assert.deepEqual(readRememberedGameCodes(store),[],'First-time visitor has no code');
assert.deepEqual(rememberGameCode(' 8.414 ',store),['8.414'],'Trimmed game code is saved');
assert.deepEqual(readRememberedGameCodes(store),['8.414'],'Saved code survives an independent read');
assert.deepEqual(rememberGameCode('OTHER',store),['OTHER','8.414'],'Additional games retained');
assert.deepEqual(rememberGameCode('8.414',store),['8.414','OTHER'],'Rejoining moves game to top without duplication');
for(const code of ['G3','G4','G5','G6','G7'])rememberGameCode(code,store);
assert.equal(readRememberedGameCodes(store).length,5,'Only five recent games kept');
assert.deepEqual(forgetRememberedGameCode('G7',store).slice(0,2),['G6','G5'],'Selected code can be forgotten');
assert(!JSON.stringify([...data.values()]).includes('password'),'Storage never adds credentials');
data.set('gos-id:recent-game-codes:v1','invalid json');
assert.deepEqual(readRememberedGameCodes(store),[],'Corrupt storage must not block login');
data.set('gos-id:recent-game-codes:v1',JSON.stringify([' 8.414 ','',null,20,'A','A','G2']));
assert.deepEqual(readRememberedGameCodes(store),['8.414','G2'],'Invalid or duplicate entries ignored');
const denied={
 getItem:()=>{throw new Error('Storage disabled')},
 setItem:()=>{throw new Error('Storage disabled')},
 removeItem:()=>{throw new Error('Storage disabled')}
};
assert.deepEqual(readRememberedGameCodes(denied),[],'Private mode cannot block reading');
assert.deepEqual(rememberGameCode('8.414',denied),[],'Private mode cannot block signing in');
assert.deepEqual(rememberGameCode('8.414',null),[],'SSR does not access window');
const home=fs.readFileSync('app/page.tsx','utf8');
const css=fs.readFileSync('app/entry-qr.css','utf8');
assert(home.includes('setLoginGameCode(current=>current||codes[0]||\'\')'),'Returning users see last game code');
assert(home.includes("supabase.rpc('resume_member_game'"),'Existing secure resume RPC preserved');
assert(home.includes('saveSuccessfulGameCode(loginGameCode);'),'Personal login records game on successful resume');
assert.equal((home.match(/saveSuccessfulGameCode\(code\);router\.push/g)||[]).length,2,'Creation and invitation paths also remember game');
assert(home.includes('forgetRememberedGameCode(loginGameCode)'),'Shared devices can forget remembered code');
assert(home.includes('savedGameCodes.map(code=>'),'A user with multiple games can choose remembered code');
assert(!source.includes('loginPassword')&&!source.includes('invite'),'Never store personal password or invitation in utility');
assert(css.includes('@media(max-width:420px)')&&css.includes('.entryRememberedGameField'),'Mobile input layout styled');
console.log('PASS: game code persistence, multiple games, restricted storage and no stored secrets');
