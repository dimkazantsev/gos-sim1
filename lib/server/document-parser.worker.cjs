const {parentPort,workerData}=require('node:worker_threads');
const {inflateRawSync}=require('node:zlib');

// Inspect the ZIP directory and bounded XML before handing DOCX to the parser.
function validateDocx(bytes){
 const data=Buffer.from(bytes);
 let end=-1;
 for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--){
  if(data.readUInt32LE(i)===0x06054b50&&i+22+data.readUInt16LE(i+20)===data.length){end=i;break;}
 }
 if(end<0||data.readUInt16LE(end+4)!==0||data.readUInt16LE(end+6)!==0)throw Error('Unsupported DOCX');
 const count=data.readUInt16LE(end+10),directorySize=data.readUInt32LE(end+12),start=data.readUInt32LE(end+16);
 if(count<1||count>2048||start+directorySize>end)throw Error('DOCX limits');
 let pos=start,total=0,xmlTotal=0,xmlNodes=0,hasDocument=false;
 const names=new Set();
 for(let i=0;i<count;i++){
  if(pos+46>start+directorySize||data.readUInt32LE(pos)!==0x02014b50)throw Error('Invalid DOCX directory');
  const flags=data.readUInt16LE(pos+8),method=data.readUInt16LE(pos+10),compressed=data.readUInt32LE(pos+20),expanded=data.readUInt32LE(pos+24);
  const nameLength=data.readUInt16LE(pos+28),extra=data.readUInt16LE(pos+30),comment=data.readUInt16LE(pos+32),local=data.readUInt32LE(pos+42);
  const next=pos+46+nameLength+extra+comment;
  if(next>start+directorySize||flags&1||![0,8].includes(method)||expanded===0xffffffff||compressed===0xffffffff)throw Error('Unsupported DOCX entry');
  const name=data.subarray(pos+46,pos+46+nameLength).toString('utf8');
  if(names.has(name))throw Error('Duplicate DOCX entry');names.add(name);
  total+=expanded;if(total>32*1024*1024)throw Error('DOCX expanded size');
  if(local+30>start||data.readUInt32LE(local)!==0x04034b50)throw Error('Invalid DOCX entry');
  const contentStart=local+30+data.readUInt16LE(local+26)+data.readUInt16LE(local+28);
  if(contentStart+compressed>start)throw Error('Invalid DOCX entry bounds');
  if(name.endsWith('.xml')||name.endsWith('.rels')){
   xmlTotal+=expanded;
   if(expanded>4*1024*1024||xmlTotal>8*1024*1024)throw Error('DOCX XML limits');
   const entry=data.subarray(contentStart,contentStart+compressed);
   const decoded=method===8?inflateRawSync(entry,{maxOutputLength:4*1024*1024}):entry;
   if(decoded.length!==expanded)throw Error('Invalid DOCX size');
   const xml=decoded.toString('utf8');
   if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsupported XML declarations');
   for(let n=xml.indexOf('<');n!==-1;n=xml.indexOf('<',n+1))if(++xmlNodes>20000)throw Error('DOCX XML complexity');
  }
  if(name==='word/document.xml')hasDocument=true;
  pos=next;
 }
 if(!hasDocument||pos!==start+directorySize)throw Error('Invalid DOCX');
 return data;
}

async function run(){
 let text='',pages;
 if(workerData.kind==='docx'){
  const mammoth=require(workerData.mammothPath||'mammoth');
  text=(await mammoth.extractRawText({buffer:validateDocx(workerData.bytes)})).value;
 }else{
  const bytes=new Uint8Array(workerData.bytes);
  if(!Buffer.from(bytes.subarray(0,1024)).includes(Buffer.from('%PDF-')))throw Error('Invalid PDF');
  const {getDocumentProxy,extractText}=require(workerData.unpdfPath||'unpdf');
  const document=await getDocumentProxy(bytes,{isEvalSupported:false});
  try{
   pages=document.numPages;
   if(pages>200)throw Error('PDF page limit');
   text=(await extractText(document,{mergePages:true})).text;
  }finally{if(typeof document.destroy==='function')await document.destroy();else if(typeof document.cleanup==='function')await document.cleanup();}
 }
 text=text.replace(/\u0000/g,'').replace(/\r\n/g,'\n').trim();
 parentPort.postMessage({ok:true,value:{text:text.slice(0,workerData.textLimit),truncated:text.length>workerData.textLimit,needsManualText:!text,...(pages?{pages}:{})}});
}
if(parentPort)run().catch(()=>parentPort.postMessage({ok:false}));
module.exports={validateDocx};
