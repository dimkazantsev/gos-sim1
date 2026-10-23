import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';

// These are disposable in-memory PostgreSQL tables, NOT the linked Supabase project.
// They reproduce the real NO ACTION chains: referral -> complaint -> game.
const db=new PGlite();
await db.exec(`
 create table games(id integer primary key,title text);
 create table presidential_cec_complaints(
  id integer primary key,game_id integer not null references games(id),title text);
 create table presidential_cec_court_referrals(
  id integer primary key,game_id integer not null references games(id),
  complaint_id integer references presidential_cec_complaints(id));
 insert into games values(1,'archive to remove'),(2,'unrelated active game');
 insert into presidential_cec_complaints values(10,1,'preserve in backup'),(20,2,'unrelated');
 insert into presidential_cec_court_referrals values(100,1,10),(200,2,20);
`);
let blocked=false;
try{await db.exec('delete from games where id=1;')}catch(error){blocked=/foreign key constraint|foreign key/i.test(String(error));}
assert.equal(blocked,true,'Deleting games directly must reproduce the FK failure');
let still=await db.query('select count(*)::int as n from games where id=1');
assert.equal(still.rows[0].n,1,'Failed delete does not remove game');

await db.exec(`
 begin;
 delete from presidential_cec_court_referrals where game_id=1;
 delete from presidential_cec_complaints where game_id=1;
 delete from games where id=1;
 commit;
`);
for(const table of ['games','presidential_cec_complaints','presidential_cec_court_referrals']){
 const removed=await db.query('select count(*)::int as n from '+table+' where '+(table==='games'?'id':'game_id')+'=1');
 const unrelated=await db.query('select count(*)::int as n from '+table+' where '+(table==='games'?'id':'game_id')+'=2');
 assert.equal(removed.rows[0].n,0,'Target game records cleared from '+table);
 assert.equal(unrelated.rows[0].n,1,'Unrelated game records preserved in '+table);
}
await db.close();
console.log('PASS PostgreSQL FK reproduction: child-first cleanup works and other sessions remain untouched');
