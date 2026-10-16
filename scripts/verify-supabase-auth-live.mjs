// Read-only Auth/database smoke test. No account is created and no mail is sent.
// /health alone does not prove that GoTrue can query its users table.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../public-client-config.json',import.meta.url),'utf8'));
const probeEmail='gos-id-auth-smoke-'+crypto.randomUUID()+'@example.com';
let failure;
for(let attempt=0;attempt<2;attempt++){
 const started=performance.now();
 try{
  const response=await fetch(config.url+'/auth/v1/token?grant_type=password',{
   method:'POST',cache:'no-store',signal:AbortSignal.timeout(12000),
   headers:{apikey:config.publishableKey,Authorization:'Bearer '+config.publishableKey,'Content-Type':'application/json','X-Client-Info':'GOS-ID-Auth-Smoke/1.0'},
   body:JSON.stringify({email:probeEmail,password:'probe-'+crypto.randomUUID()})
  });
  const body=await response.json();
  assert.equal(response.status,400,'Auth must promptly reject a nonexistent account, not time out');
  assert.equal(body.error_code,'invalid_credentials','The request must reach the account check');
  console.log('PASS live Auth database lookup: invalid_credentials in '+Math.round(performance.now()-started)+' ms; no account or mail created.');
  process.exit(0);
 }catch(error){failure=error;console.error('Auth smoke attempt '+(attempt+1)+': '+error.message);if(attempt===0)await new Promise(resolve=>setTimeout(resolve,1000));}
}
console.error('FAIL live Auth database lookup: '+failure?.message);process.exitCode=1;
