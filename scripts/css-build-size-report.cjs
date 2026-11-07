/* CI-only, bounded inventory of emitted Next.js CSS, not browser transfer. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const dir=path.join(__dirname,'..','.next','static');
const found=[];
function visit(folder){if(!fs.existsSync(folder))return;for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,entry.name);if(entry.isDirectory())visit(full);else if(entry.isFile()&&entry.name.endsWith('.css'))found.push(full)}}
visit(dir);
let raw=0,gzip=0;
for(const file of found){const data=fs.readFileSync(file);raw+=data.length;gzip+=zlib.gzipSync(data,{level:6}).length}
console.log('CSS_BUILD_SIZE '+JSON.stringify({cssFiles:found.length,totalRawBytes:raw,totalGzipEstimateBytes:gzip,scope:'Entire Next.js build output, not network transfer for a particular screen.'}));
if(!found.length)console.warn('No built CSS found; do not infer zero transmitted CSS.');
