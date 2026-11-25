/* CI-only inventory of emitted Next.js CSS; not a per-route transfer measurement. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const dir=path.join(__dirname,'..','.next','static');
let cssFiles=0,totalRawBytes=0,totalGzipEstimateBytes=0;
function visit(folder){
 if(!fs.existsSync(folder))return;
 for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  const full=path.join(folder,entry.name);
  if(entry.isDirectory())visit(full);
  else if(entry.isFile()&&entry.name.endsWith('.css')){
   const data=fs.readFileSync(full);cssFiles++;totalRawBytes+=data.length;totalGzipEstimateBytes+=zlib.gzipSync(data,{level:6}).length;
  }
 }
}
visit(dir);
if(!cssFiles)console.warn('No built CSS found; do not infer zero transmitted CSS.');
console.log('CSS_BUILD_SIZE '+JSON.stringify({cssFiles,totalRawBytes,totalGzipEstimateBytes,scope:'Entire Next.js build output, not network transfer for a particular screen.'}));
