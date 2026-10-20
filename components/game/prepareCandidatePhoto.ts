/** Optimise only new candidate photos before upload; existing Storage objects stay untouched. */
export async function prepareCandidatePhoto(file:File):Promise<File>{
 if(file.size<350_000||!['image/jpeg','image/png','image/webp'].includes(file.type)
  ||typeof document==='undefined'||typeof createImageBitmap!=='function')return file;
 let bitmap:ImageBitmap|undefined;
 try{
  bitmap=await createImageBitmap(file);
  if(!bitmap.width||!bitmap.height)return file;
  const factor=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*factor));
  canvas.height=Math.max(1,Math.round(bitmap.height*factor));
  const ctx=canvas.getContext('2d');
  if(!ctx)return file;
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',0.82));
  if(!blob||blob.type!=='image/webp'||blob.size>=file.size)return file;
  const basename=file.name.replace(/\.[^.]+$/,'')||'candidate-photo';
  return new File([blob],basename+'.webp',{type:'image/webp',lastModified:file.lastModified});
 }catch{return file}
 finally{bitmap?.close()}
}
