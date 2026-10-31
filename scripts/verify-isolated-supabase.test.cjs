const test=require('node:test'),assert=require('node:assert/strict');
const {check,origin}=require('./verify-isolated-supabase.cjs');
const baseline={gosRuntime:'https://gos-main.supabase.co',gosPublicConfig:'https://gos-main.supabase.co',qwizTarget:'https://qwiz-only.supabase.co'};
test('independent Supabase projects pass',()=>assert.equal(check(baseline).independent,true));
test('same URL fails',()=>assert.throws(()=>check({...baseline,qwizTarget:baseline.gosRuntime}),/same/));
test('GOS environment and client public config cannot disagree',()=>assert.throws(()=>check({...baseline,gosPublicConfig:'https://different.supabase.co'}),/does not match/));
test('plain HTTPS URLs are required',()=>{
 for(const u of ['http://qwiz-only.supabase.co','https://user:pass@qwiz-only.supabase.co','https://qwiz-only.supabase.co/auth/v1'])
  assert.throws(()=>check({...baseline,qwizTarget:u}),/HTTPS/);
});
test('URL normalization does not consider trailing slash a distinct project',()=>assert.throws(()=>check({...baseline,qwizTarget:baseline.gosRuntime+'/'}),/same/));
