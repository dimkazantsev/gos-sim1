/** Square, non-destructive geometry for party insignia; the same values drive preview and exported WebP. */
export type PartyLogoPlacement={zoom:number;x:number;y:number};

export function partyLogoRect(width:number,height:number,placement:PartyLogoPlacement,size=640){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||
    !Number.isFinite(size)||size<=0||!Number.isFinite(placement.zoom)||placement.zoom<1||placement.zoom>6||
    !Number.isFinite(placement.x)||!Number.isFinite(placement.y)||Math.abs(placement.x)>100||Math.abs(placement.y)>100)
  throw new Error('Неверные параметры изображения.');
 const scale=size/Math.max(width,height)*placement.zoom;
 const w=width*scale,h=height*scale;
 return {x:(size-w)/2+size*placement.x/100,y:(size-h)/2+size*placement.y/100,width:w,height:h};
}

export async function preparePartyLogo(file:File,placement:PartyLogoPlacement):Promise<File>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024||file.size===0)
  throw new Error('Выберите PNG, JPEG или WebP размером не более 8 МБ.');
 const bitmap=await createImageBitmap(file);
 try{
  if(bitmap.width*bitmap.height>30_000_000)
   throw new Error('Слишком большое разрешение исходного изображения.');
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=640;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Не удалось подготовить изображение.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,640,640);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  const rect=partyLogoRect(bitmap.width,bitmap.height,placement);
  ctx.drawImage(bitmap,rect.x,rect.y,rect.width,rect.height);
  const blob=await new Promise<Blob>((resolve,reject)=>
   canvas.toBlob(out=>out?resolve(out):reject(new Error('Не удалось сохранить изображение.')),'image/webp',.91));
  return new File([blob],'party-logo.webp',{type:'image/webp'});
 }finally{bitmap.close()}
}
