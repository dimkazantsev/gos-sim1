import {unpack_cascade,run_cascade,cluster_detections,type Classifier} from '@/lib/vendor/pico';

type Face={x:number;y:number;width:number;height:number};
let classifier:Promise<Classifier>|undefined;
/** The model and pixels stay in the browser. No recognition service receives photos. */
export function preparePortraitDetector(){
 return classifier??=(fetch('/models/facefinder.bin').then(async response=>{
  if(!response.ok)throw new Error('Модель обработки фотографии недоступна.');
  return unpack_cascade(new Int8Array(await response.arrayBuffer()));
 }).catch(error=>{classifier=undefined;throw error}));
}

export function portraitBounds(width:number,height:number,face?:Face){
 const size=Math.min(width,height,face?Math.max(face.width,face.height)*2.15:Infinity);
 const cx=face?face.x+face.width/2:width/2;
 const cy=face?face.y+face.height*.64:height*.4;
 return {x:Math.max(0,Math.min(width-size,cx-size/2)),y:Math.max(0,Math.min(height-size,cy-size/2)),size};
}

async function findFace(image:ImageBitmap):Promise<Face|undefined>{
 type Detector=new(options:{fastMode:boolean;maxDetectedFaces:number})=>{detect:(image:ImageBitmap)=>Promise<{boundingBox:Face}[]>};
 const Native=(globalThis as typeof globalThis&{FaceDetector?:Detector}).FaceDetector;
 if(Native){
  try{
   const faces=await new Native({fastMode:true,maxDetectedFaces:5}).detect(image);
   if(faces.length)return faces.sort((a,b)=>b.boundingBox.width*b.boundingBox.height-a.boundingBox.width*a.boundingBox.height)[0].boundingBox;
  }catch{/* Use the bundled detector when the native implementation is unavailable. */}
 }
 const classify=await preparePortraitDetector();
 const scale=Math.min(1,480/Math.max(image.width,image.height));
 const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return;
 ctx.drawImage(image,0,0,canvas.width,canvas.height);
 const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 const pixels=new Uint8Array(canvas.width*canvas.height);
 for(let i=0;i<pixels.length;i++)pixels[i]=(rgba[i*4]*2+rgba[i*4+1]*7+rgba[i*4+2])/10;
 // A single photograph needs a denser scan than a webcam that accumulates frames.
 const faces=cluster_detections(run_cascade({pixels,nrows:canvas.height,ncols:canvas.width,ldim:canvas.width},classify,{shiftfactor:.06,minsize:28,maxsize:Math.min(canvas.width,canvas.height),scalefactor:1.08}),.2)
  .filter(face=>face[3]>50).sort((a,b)=>b[2]-a[2]);
 if(!faces.length)return;
 const [row,col,size]=faces[0];
 return {x:(col-size/2)/scale,y:(row-size/2)/scale,width:size/scale,height:size/scale};
}

export async function decodePortrait(url:string){
 const image=new Image();image.src=url;await image.decode();
}

/** Decode, detect the largest face, crop and create a truly circular transparent image. */
export async function cropPortrait(file:File):Promise<File>{
 const image=await createImageBitmap(file);
 try{
  const face=await findFace(image);
  const {x,y,size}=portraitBounds(image.width,image.height,face);
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Не удалось обработать изображение.');
  ctx.beginPath();ctx.arc(256,256,256,0,Math.PI*2);ctx.clip();
  ctx.drawImage(image,x,y,size,size,0,0,512,512);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось подготовить фотографию.')),'image/webp',.9));
  return new File([blob],'portrait.webp',{type:'image/webp'});
 }finally{image.close()}
}
