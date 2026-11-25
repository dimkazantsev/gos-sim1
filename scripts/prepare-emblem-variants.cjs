'use strict';
// Build-time only: Next already provides locked sharp. No external image API,
// extra production compute or paid image optimizer. Original artwork is unchanged.
const {mkdir,stat}=require('node:fs/promises'),{join}=require('node:path');
const sharp=require('sharp');
const names=["interior-user","finance","economy","education","health","foreign","russia"];
async function main(){
 const dir=join(process.cwd(),'public','emblems'),out=join(dir,'optimized');
 await mkdir(out,{recursive:true});
 sharp.concurrency(1);sharp.cache(false);
 let before=0,after=0;
 const details=[];
 for(const name of names){
  const source=join(dir,name+'.png'),target=join(out,name+'-256.webp');
  const sourceBytes=(await stat(source)).size;
  const meta=await sharp(source).metadata();
  if(meta.width<256)throw Error('Unexpected original emblem width: '+name);
  const info=await sharp(source).resize({width:256,withoutEnlargement:true}).webp({lossless:true,effort:4}).toFile(target);
  if(info.width!==256||info.size>=sourceBytes)throw Error('Invalid emblem variant: '+name);
  before+=sourceBytes;after+=info.size;
  details.push({name,sourceBytes,variantBytes:info.size,width:info.width,height:info.height});
 }
 console.log('GOS_ID_EMBLEM_VARIANTS '+JSON.stringify({before,after,details,productionRequests:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
