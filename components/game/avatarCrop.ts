/** Centre a profile photo on the largest detected face when supported.
 * Safari/Firefox fall back to an upper-centre portrait crop, never stretching an image.
 * No photo bytes are sent to an external recognition service.
 */
export async function cropPortrait(file:File):Promise<File>{
 const image=await createImageBitmap(file);
 try{
  const w=image.width,h=image.height,size=Math.min(w,h);
  let centerX=w/2,centerY=h*.40;
  type Detector={detect:(image:ImageBitmap)=>Promise<{boundingBox:{x:number;y:number;width:number;height:number}}[]>};
  type DetectorCtor=new (options:{fastMode:boolean;maxDetectedFaces:number})=>Detector;
  const available=(globalThis as typeof globalThis&{FaceDetector?:DetectorCtor}).FaceDetector;
  if(available){
   try{
    const faces=await new available({fastMode:true,maxDetectedFaces:5}).detect(image);
    if(faces.length){
     const face=faces.sort((a,b)=>b.boundingBox.width*b.boundingBox.height-a.boundingBox.width*a.boundingBox.height)[0].boundingBox;
     centerX=face.x+face.width/2;
     centerY=face.y+face.height*.7;
    }
   }catch{/* Browser unsupported: conservative portrait fallback. */}
  }
  const sx=Math.max(0,Math.min(w-size,centerX-size/2));
  const sy=Math.max(0,Math.min(h-size,centerY-size/2));
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Не удалось обработать изображение.');
  ctx.drawImage(image,sx,sy,size,size,0,0,512,512);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось подготовить фотографию.')),'image/webp',.88));
  return new File([blob],'portrait.webp',{type:'image/webp'});
 }finally{image.close()}
}
