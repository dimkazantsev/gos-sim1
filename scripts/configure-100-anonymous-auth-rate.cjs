'use strict';
// Only modifies the hourly per-IP anonymous sign-in limit. No user, password,
// RLS, other Auth setting or database content is changed.
const https=require('node:https');
const {URL}=require('node:url');
const TOKEN=process.env.SUPABASE_ACCESS_TOKEN||'';
const REF=process.env.GOS_SUPABASE_PROJECT_REF||'';
const TARGET=Number(process.env.GOS_ANONYMOUS_RATE_TARGET||150);
if(!/^[a-z0-9]{20}$/.test(REF)||!Number.isInteger(TARGET)||TARGET<110||TARGET>250)
 throw Error('Invalid project ref or bounded anonymous rate target');
if(!TOKEN)throw Error('SUPABASE_ACCESS_TOKEN is not configured. Production Auth rate limit was NOT updated.');
function request(method,data){
 return new Promise((resolve,reject)=>{
  const u=new URL('https://api.supabase.com/v1/projects/'+REF+'/config/auth');
  const req=https.request(u,{method,timeout:12000,headers:{
   Authorization:'Bearer '+TOKEN,Accept:'application/json',
   ...(data?{'Content-Type':'application/json'}:{})
  }},res=>{
   let content='';
   res.setEncoding('utf8');
   res.on('data',x=>{content+=x;if(content.length>500000)req.destroy(Error('Response too large'))});
   res.on('end',()=>{
    if(res.statusCode<200||res.statusCode>=300)
     return reject(Error('Supabase Management API responded HTTP '+res.statusCode+'; no retry'));
    try{resolve(JSON.parse(content))}catch{reject(Error('Invalid configuration response'))}
   });
  });
  req.on('timeout',()=>req.destroy(Error('Management API timeout; not retrying')));
  req.on('error',reject);
  req.end(data?JSON.stringify(data):undefined);
 });
}
async function main(){
 const before=await request('GET');
 const current=Number(before.rate_limit_anonymous_users);
 if(!Number.isFinite(current)||current<0)throw Error('Cannot verify existing anonymous rate limit; stopping safely');
 if(current<TARGET)await request('PATCH',{rate_limit_anonymous_users:TARGET});
 const after=await request('GET');
 const updated=Number(after.rate_limit_anonymous_users);
 if(!Number.isFinite(updated)||updated<TARGET)throw Error('Anonymous rate setting not confirmed');
 console.log(JSON.stringify({project:'GOS.ID',setting:'rate_limit_anonymous_users',
  before:current,after:updated,minTarget:TARGET,otherAuthSettingsChanged:false,
  authUsersChanged:0,databaseRowsChanged:0}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
