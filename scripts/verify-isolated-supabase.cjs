// Physical Supabase boundary verification for GOS.ID (NO network, NO writes).
// For use after QWIZ project has been created and before/after cutover.
'use strict';
const fs=require('node:fs'),path=require('node:path');
function origin(value){
 let u;try{u=new URL(value)}catch{throw Error('An absolute Supabase URL is required')}
 if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)
  throw Error('Must use a plain HTTPS API origin');
 return u.origin.toLowerCase();
}
function check({gosRuntime,gosPublicConfig,qwizTarget}){
 const gos=origin(gosRuntime),publicUrl=origin(gosPublicConfig),qwiz=origin(qwizTarget);
 if(gos!==publicUrl)throw Error('GOS client configuration does not match public-client-config.json');
 if(gos===qwiz)throw Error('QWIZ and GOS are still using the same Supabase backend; not isolated');
 return {gos_project:new URL(gos).host,qwiz_project:new URL(qwiz).host,independent:true};
}
function inspect(){
 const base=path.resolve(__dirname,'..');
 const lib=fs.readFileSync(path.join(base,'lib','supabase.ts'),'utf8');
 const fallback=lib.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i)?.[0];
 if(!fallback)throw Error('Missing known GOS fallback URL in lib/supabase.ts');
 const local=JSON.parse(fs.readFileSync(path.join(base,'public-client-config.json'),'utf8'));
 const target=process.env.QWIZ_NEW_SUPABASE_URL;
 if(!target)throw Error('QWIZ_NEW_SUPABASE_URL must be set; no production check performed');
 return check({gosRuntime:process.env.NEXT_PUBLIC_SUPABASE_URL||fallback,gosPublicConfig:local.url,qwizTarget:target});
}
if(require.main===module){
 try{console.log(JSON.stringify(inspect(),null,2))}
 catch(error){console.error('GOS boundary check failed:',error.message);process.exitCode=1}
}
module.exports={origin,check,inspect};
