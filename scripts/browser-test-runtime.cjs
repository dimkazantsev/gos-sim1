const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');

function startTestServer(root,port,env={}){
 const detached=process.platform!=='win32';
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','-H','127.0.0.1','-p',String(port)],{cwd:root,detached,stdio:['ignore','pipe','pipe'],env:{...process.env,...env}});
 server.testProcessGroup=detached;
 return server;
}
async function closeTestBrowser(browser){
 if(!browser)return;
 await Promise.all(browser.contexts().map(context=>context.unrouteAll({behavior:'ignoreErrors'})));
 await browser.close();
}
async function stopTestServer(server){
 if(!server)return;
 const signal=name=>{
  try{if(server.testProcessGroup)process.kill(-server.pid,name);else server.kill(name)}
  catch(error){if(error.code!=='ESRCH')throw error}
 };
 const exited=server.exitCode!==null||server.signalCode!==null?Promise.resolve():new Promise(resolve=>server.once('exit',resolve));
 signal('SIGTERM');
 let timer;
 await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,2000)})]);
 clearTimeout(timer);
 if(server.exitCode===null&&server.signalCode===null){signal('SIGKILL');await exited;}
}
function cleanTestRoute(root,route){
 fs.rmSync(route,{recursive:true,force:true});
 fs.rmSync(path.join(root,'.next','dev','types'),{recursive:true,force:true});
}
module.exports={startTestServer,closeTestBrowser,stopTestServer,cleanTestRoute};
