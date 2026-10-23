import assert from 'node:assert/strict';
import {fetchGameArchiveBatched} from '../components/game/sessionExportBatches.ts';

const manifest={format:'GOS-SIMS',schema:2,game:{id:'test-session',game_code:'TEST',title:'Тест'},exported_at:'2026-10-23T00:00:00Z',tables:['stage_assessment_runs','channel_members','game_ballots','empty_table']};
const rows={stage_assessment_runs:Array.from({length:251},(_,i)=>({id:i})),channel_members:Array.from({length:100},(_,i)=>({id:i})),game_ballots:[{id:1}],empty_table:[]};
const calls=[];const progress=[];
const result=await fetchGameArchiveBatched('test-session',async(name,args)=>{
 calls.push({name,args});
 if(name==='export_game_manifest')return {data:manifest,error:null};
 assert.ok(args.p_tables.length<=3);
 assert.equal(args.p_limit,100);
 assert.ok(args.p_offset>=0);
 return {data:Object.fromEntries(args.p_tables.map(table=>[table,rows[table].slice(args.p_offset,args.p_offset+args.p_limit)])),error:null};
},(done,total)=>progress.push({done,total}));
assert.deepEqual(Object.fromEntries(Object.entries(result.tables).map(([table,v])=>[table,v.length])),{stage_assessment_runs:251,channel_members:100,game_ballots:1,empty_table:0});
assert.equal(result.tables.stage_assessment_runs[250].id,250);
assert.equal(result.game.game_code,'TEST');
assert.equal(result.schema,2);
assert.equal(progress.at(-1).done,4);
assert.ok(calls.length>=5,'Large datasets must be paginated');
assert.deepEqual(calls.filter(c=>c.name==='export_game_data_batch').map(c=>c.args.p_offset).slice(0,4),[0,100,200,0]);

await assert.rejects(fetchGameArchiveBatched('id',async()=>({data:null,error:{message:'Нет доступа'}})),{message:'Нет доступа'});
await assert.rejects(fetchGameArchiveBatched('id',async(name)=>name==='export_game_manifest'?{data:manifest,error:null}:{data:{},error:null}),/неполные данные/);
await assert.rejects(fetchGameArchiveBatched('id',async()=>({data:{...manifest,tables:['a','a']},error:null})),/некорректный список/);
await assert.rejects(fetchGameArchiveBatched('id',async(name)=>name==='export_game_manifest'?{data:manifest,error:null}:{data:null,error:{message:'Тайм-аут'}}),{message:'Тайм-аут'});
console.log('PASS: batched export, table pagination, empty collections, metadata, progress, strict errors');
