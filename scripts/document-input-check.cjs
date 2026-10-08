// Source route/auth fixtures use fictional identities and no network. Parser
// compatibility below invokes the real isolated worker on small normal files.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {Worker}=require('node:worker_threads');
const root=path.resolve(__dirname,'..'),origin='https://dimkazantsev.github.io';
const user='00000000-0000-4000-8000-000000000001',game='00000000-0000-4000-8000-000000000002',linkId='00000000-0000-4000-8000-000000000003';
const token='qa-fictional-valid-session';
const active={user_id:user,game_id:game,kind:'student',roster_archived_at:null};
const link={id:linkId,user_id:user,game_id:game,title:'QA saved document',provider:'google',url:'https://docs.google.com/document/d/qa-normal-document/edit'};
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function harness(options={}){
 const authCalls=[],queries=[],fetches=[],modules=new Map();let context;
 const members=options.members??[active],savedLink=options.link??link;
 const client={auth:{getUser:async value=>{authCalls.push(value);return value===token&&!options.expired?{data:{user:{id:user}},error:null}:{data:{user:null},error:{message:'QA expired'}};}},from(table){
  const query={filters:[],select(){return this;},eq(key,value){this.filters.push(row=>row[key]===value);return this;},is(key,value){this.filters.push(row=>row[key]===value);return this;},neq(key,value){this.filters.push(row=>row[key]!==value);return this;},limit(n){this.maximum=n;return this;},single(){this.one=true;return this;},maybeSingle(){this.one=true;return this;},then(resolve){queries.push(table);let rows=table==='game_members'?members:table==='profile_document_links'?[savedLink]:[];rows=rows.filter(row=>this.filters.every(fn=>fn(row)));if(this.maximum)rows=rows.slice(0,this.maximum);return Promise.resolve({data:this.one?rows[0]??null:rows,error:null}).then(resolve);}};return query;
 }};
 const fetchFixture=async input=>{const url=String(input);fetches.push(url);if(options.download)return options.download(url,fetches.length);throw Error('Unexpected fixture network request '+url);};
 function load(relative){
  if(!modules.has(relative)){const module={exports:{}};vm.runInContext('(function(require,module,exports){'+transpile(fs.readFileSync(path.join(root,relative),'utf8'))+'\n})',context)(requireFor,module,module.exports);modules.set(relative,module.exports);}return modules.get(relative);
 }
 function requireFor(request){
  if(request==='@supabase/supabase-js')return{createClient:()=>client};
  if(request==='@/public-client-config.json')return{url:'https://qa.invalid',publishableKey:'qa-fictional-public-key'};
  if(request==='@/lib/server/documentInput')return load('lib/server/documentInput.ts');
  if(request==='next/server')return{NextResponse:{json:(body,options)=>Response.json(body,options)}};
  return require(request);
 }
 requireFor.resolve=require.resolve;
 context=vm.createContext({console,process:{env:{},cwd:()=>root},fetch:fetchFixture,Buffer,Request,Response,Headers,File,FormData,TextDecoder,TextEncoder,Uint8Array,AbortSignal,URL,Date,Error,Promise,setTimeout,clearTimeout});
 return{input:load('lib/server/documentInput.ts'),extract:load('app/api/extract-document/route.ts'),cloud:load('app/api/import-cloud-document/route.ts'),authCalls,queries,fetches};
}
function jsonRequest(){return new Request('https://qa.invalid/api/import-cloud-document',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:origin},body:JSON.stringify({linkId})});}
function unreadRequest(authorization){let read=0;return{request:{url:'https://qa.invalid/api/document',headers:new Headers({...authorization?{Authorization:authorization}:{},Origin:origin}),get body(){read++;throw Error('Body must not be touched');}},reads:()=>read};}
function fileRequest(bytes,name,type){const form=new FormData();form.set('file',new File([bytes],name,{type}));return new Request('https://qa.invalid/api/extract-document',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin},body:form});}
async function normalDocx(){
 const JSZip=require('jszip'),zip=new JSZip();
 zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Normal DOCX fixture — Дума</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
function normalPdf(){
 const stream='BT /F1 12 Tf 40 100 Td (Normal PDF fixture) Tj ET',objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream'];
 let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+object+'\nendobj\n';});const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(pdf);
}
async function workerResult(bytes,kind,textLimit){
 const worker=new Worker(path.join(root,'lib/server/document-parser.worker.cjs'),{workerData:{bytes,kind,textLimit,mammothPath:require.resolve('mammoth'),unpdfPath:require.resolve('unpdf')},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{void worker.terminate();reject(Error('Normal parser fixture timed out'));},10000);worker.once('error',error=>{clearTimeout(timer);reject(error);});worker.once('message',value=>{clearTimeout(timer);void worker.terminate();resolve(value);});});
}
async function checkTraces(){
 const {nodeFileTrace}=require('next/dist/compiled/@vercel/nft');
 const trace=await nodeFileTrace([path.join(root,'lib/server/document-parser.worker.cjs')],{base:root,processCwd:root});
 const closure=[...trace.fileList].filter(file=>!file.endsWith('.d.ts'));
 for(const route of ['extract-document','import-cloud-document']){
  const manifest=path.join(root,'.next/server/app/api',route,'route.js.nft.json');
  const files=new Set(JSON.parse(fs.readFileSync(manifest,'utf8')).files.map(file=>path.resolve(path.dirname(manifest),file)));
  const missing=closure.filter(file=>!files.has(path.join(root,file)));
  assert.deepEqual(missing,[],route+' runtime worker closure is absent from the production trace');
  console.log('PASS production '+route+' trace includes '+closure.length+' worker runtime files');
 }
}
async function main(){
 const failures=[];async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+': '+error.stack);}}
 await check('Unauthenticated and expired requests return 401 before body reads',async()=>{
  for(const expired of [false,true])for(const route of ['extract','cloud']){const h=harness({expired}),unread=unreadRequest(expired?'Bearer '+token:undefined);assert.equal((await h[route].POST(unread.request)).status,401);assert.equal(unread.reads(),0);assert.equal(h.fetches.length,0);}
 });
 await check('Observers, archived members and outsiders are rejected before request data',async()=>{
  for(const members of [[{...active,kind:'observer'}],[{...active,roster_archived_at:'2026-10-08'}],[]])for(const route of ['extract','cloud']){const h=harness({members}),unread=unreadRequest('Bearer '+token);assert.equal((await h[route].POST(unread.request)).status,403);assert.equal(unread.reads(),0);assert.equal(h.fetches.length,0);}
 });
 await check('Cloud links must belong to caller and an active exact-game membership',async()=>{
  const outsider=harness({link:{...link,user_id:'qa-other-user'}});assert.equal((await outsider.cloud.POST(jsonRequest())).status,404);assert.equal(outsider.fetches.length,0);
  const mismatch=harness({link:{...link,game_id:'00000000-0000-4000-8000-000000000099'}});assert.equal((await mismatch.cloud.POST(jsonRequest())).status,403);assert.equal(mismatch.fetches.length,0);
 });
 await check('Both Node routes support Authorization in allowed-origin CORS preflight',async()=>{
  const h=harness();for(const route of ['extract','cloud']){assert.equal(h[route].runtime,'nodejs');const good=await h[route].OPTIONS(new Request('https://qa.invalid',{headers:{Origin:origin}}));assert.equal(good.status,204);assert.equal(good.headers.get('access-control-allow-origin'),origin);assert.match(good.headers.get('access-control-allow-headers'),/Authorization/);assert.match(good.headers.get('access-control-allow-headers'),/Content-Type/);assert.equal(good.headers.get('vary'),'Origin');const bad=await h[route].OPTIONS(new Request('https://qa.invalid',{headers:{Origin:'https://qa.invalid'}}));assert.equal(bad.headers.get('access-control-allow-origin'),null);assert.equal(bad.headers.get('vary'),'Origin');}
 });
 await check('Actual streamed body reader accepts boundary and cancels a small over-limit stream',async()=>{
  const {readDocumentBody,DocumentInputError}=harness().input;const ok=await readDocumentBody(new Request('https://qa.invalid',{method:'POST',body:'12345678'}),8);assert.equal(Buffer.from(ok).toString(),'12345678');
  let canceled=false;const parts=[new Uint8Array(5),new Uint8Array(4)];const stream=new ReadableStream({pull(controller){if(parts.length)controller.enqueue(parts.shift());},cancel(){canceled=true;}});
  await assert.rejects(readDocumentBody(new Request('https://qa.invalid',{method:'POST',body:stream,duplex:'half'}),8),error=>error instanceof DocumentInputError&&error.status===413);assert.equal(canceled,true);
  let read=false;await assert.rejects(readDocumentBody({headers:new Headers({'content-length':'9'}),get body(){read=true;throw Error('Unexpected read');}},8),error=>error.status===413);assert.equal(read,false);await assert.rejects(readDocumentBody(new Request('https://qa.invalid'),8),error=>error.status===400);
 });
 await check('Ordinary TXT normalization, output cap, empty text and no-store responses',async()=>{
  const h=harness(),response=await h.extract.POST(fileRequest('\0 Normal\r\nДума','normal.txt','text/plain'));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).text,'Normal\nДума');assert.equal(h.authCalls[0],token);
  const capped=await h.input.parseDocument(Buffer.from('A'.repeat(120001)),'txt');assert.equal(capped.text.length,120000);assert.equal(capped.truncated,true);assert.equal((await h.input.parseDocument(Buffer.from(' \r\n'),'txt')).needsManualText,true);
 });
 await check('Actual parser worker and multipart routes accept small normal DOCX and PDF',async()=>{
  const h=harness(),docx=await normalDocx(),pdf=normalPdf();for(const [bytes,kind,type,text] of [[docx,'docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','Normal DOCX fixture — Дума'],[pdf,'pdf','application/pdf','Normal PDF fixture']]){
   const parsed=await h.input.parseDocument(bytes,kind);assert.equal(parsed.text,text);assert.equal(parsed.truncated,false);if(kind==='pdf')assert.equal(parsed.pages,1);
   const response=await h.extract.POST(fileRequest(bytes,'normal.'+kind,type));assert.equal(response.status,200);assert.equal((await response.json()).text,text);
   const limited=await workerResult(bytes,kind,8);assert.equal(limited.ok,true);assert.equal(limited.value.text.length,8);assert.equal(limited.value.truncated,true);
  }
 });
 await check('Unsupported files and ordinary invalid renamed documents are rejected',async()=>{
  const h=harness();assert.equal((await h.extract.POST(fileRequest('{\\rtf1 normal}','normal.rtf','application/rtf'))).status,415);for(const kind of ['docx','pdf'])assert.equal((await h.extract.POST(fileRequest('ordinary text','invalid.'+kind,'application/octet-stream'))).status,422);
 });
 await check('Mocked Google TXT export remains compatible with bounded body reader',async()=>{
  const h=harness({download:()=>new Response('Normal Google TXT — Дума',{headers:{'Content-Type':'text/plain; charset=utf-8'}})});const response=await h.cloud.POST(jsonRequest());assert.equal(response.status,200);assert.equal((await response.json()).text,'Normal Google TXT — Дума');assert.equal(h.fetches.length,1);
 });
 await check('Mocked ordinary Yandex PNG is unsupported rather than binary text',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nHsAAAAASUVORK5CYII=','base64');const h=harness({link:{...link,provider:'yandex',url:'https://disk.yandex.ru/d/qa-normal-image'},download:(url,n)=>n===1?Response.json({href:'https://downloader.disk.yandex.ru/qa-normal-image'}):new Response(png,{headers:{'Content-Type':'image/png'}})});assert.equal((await h.cloud.POST(jsonRequest())).status,415);assert.equal(h.fetches.length,2);
 });
 if(process.argv.includes('--check-traces'))await check('Built production traces include the complete isolated parser closure',checkTraces);
 if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
