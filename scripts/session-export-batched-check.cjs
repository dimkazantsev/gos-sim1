const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'../components/game/gameArchive.ts'),'utf8');
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert(!js.diagnostics.some(x=>x.category===ts.DiagnosticCategory.Error),'TypeScript syntax');
const db={id:'game-1',title:'Тест',game_code:'X-1'};
const data={};for(let i=0;i<12;i++)data['table_'+i]=Array.from({length:i===3?205:i===4?100:i===7?0:2},(_,j)=>({id:j,n:i}));
const tableNames=Object.keys(data);
let calls=[],fail=false;
const supabase={
 rpc:async(name,args)=>{
  calls.push({name,...args});
  if(name==='export_game_manifest')return {data:{format:'GOS-SIMS',schema:2,game:db,tables:tableNames},error:null};
  if(name==='export_game_data_batch'){
   if(fail)return {data:null,error:{message:'test failure'}};
   const result={};for(const table of args.p_tables)result[table]=data[table].slice(args.p_offset,args.p_offset+args.p_limit);
   return {data:result,error:null};
  }
  throw Error('Unexpected RPC: '+name);
 },
 storage:{from:()=>({list:async()=>({data:[],error:null})})}
};
const exportsObj={};
new Function('require','exports','module',js.outputText)(name=>{
 if(name==='@/lib/userError')return {userError:e=>e?.message||''};
 if(name==='@/lib/supabase')return {supabase};
 if(name==='./portableSession')return {preparePortableSession:async d=>({data:d,html:'<html></html>',server:'server',engine:'engine',readme:'readme'})};
 throw Error('Unexpected module '+name);
},exportsObj,{exports:exportsObj});
(async()=>{
 const progress=[];
 const result=await exportsObj.readFullGameData(db.id,(done,total)=>progress.push({done,total}));
 assert.deepEqual(result.tables,data,'All table data exported, including empty and multi-page tables');
 assert.equal(result.game.id,db.id);
 assert.equal(progress.length,12);assert.deepEqual(progress.at(-1),{done:12,total:12});
 assert.equal(calls.filter(x=>x.name==='export_game_data_batch'&&x.p_tables.length===5).length,2);
 assert(calls.filter(x=>x.name==='export_game_data_batch').every(x=>x.p_tables.length<=5&&x.p_limit<=100));
 assert(calls.some(x=>x.p_tables?.length===1&&x.p_offset===200));
 assert(calls.some(x=>x.p_tables?.length===1&&x.p_offset===100));
 const archive=await exportsObj.downloadFullGameArchive(db.id);
 assert.equal(archive.type,'application/zip');
 const bytes=new Uint8Array(await archive.arrayBuffer());
 assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
 assert(new TextDecoder().decode(bytes).includes('game.json'));
 fail=true;
 await assert.rejects(()=>exportsObj.readFullGameData(db.id),/Не удалось выгрузить таблицы/);
 const ui=fs.readFileSync(path.join(__dirname,'../components/game/SessionManager.tsx'),'utf8');
 assert(ui.includes('readFullGameData(s.id'),'HTML and JSON must use bounded export');
 assert(ui.includes("if(format==='zip'&&me)"),'Failed export cannot unlock deletion');
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261023160000_session_export_batched.sql'),'utf8');
 assert(sql.includes('private.is_game_teacher(p_game)')&&sql.includes('member_login_emails')&&sql.includes('p_limit>100'));
 assert(sql.includes('revoke all on function public.export_game_data_batch'));
 console.log('PASS: session batch export, ZIP, pagination, failures, permissions, deletion guard');
})().catch(e=>{console.error(e);process.exitCode=1});
