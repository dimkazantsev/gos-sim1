const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261017190500_fix_vote_office_execute_for_authenticated.sql','utf8');
for(const helper of ['vote_member_has_office','vote_member_matches']){
 const signature='private.'+helper+'(uuid,uuid,text)';
 assert(sql.includes('to_regprocedure(\''+signature+'\')'),'Migration verifies exact helper signature: '+helper);
 assert(sql.includes('REVOKE EXECUTE ON FUNCTION '+signature+' FROM PUBLIC, anon;'),'Anonymous and PUBLIC cannot call '+helper);
 assert(sql.includes('GRANT EXECUTE ON FUNCTION '+signature+' TO authenticated, service_role;'),'Authenticated voting reads and trusted dispatch need helper execute');
}
assert(!/grant\s+(all|insert|update|delete)\s+on/i.test(sql),'No broad administrative or table grants');
console.log('PASS voting office helper grants: narrow EXECUTE, validated signatures, no anonymous/table access.');
