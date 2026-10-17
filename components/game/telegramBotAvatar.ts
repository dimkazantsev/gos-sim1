/**
 * Renders the project's approved ID-only mark (app/icon.svg) at 1024×1024.
 * The canvas flattens transparent rounded corners to the brand blue, so the
 * Telegram circular crop never exposes black/white corners.
 *
 * The JPEG is sent only to the authenticated production activation endpoint;
 * the Telegram bot token always stays on the server.
 */
export async function prepareTelegramBotAvatar():Promise<string>{
 if(typeof document==='undefined')throw new Error('Для обновления эмблемы откройте ГОС.ID в браузере.');
 const approvedSvg='<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'+
  '<rect width="128" height="128" rx="29" fill="#2453e6"/>'+
  '<text x="64" y="88" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="76" letter-spacing="-4">ID</text>'+
  '</svg>';
 const blob=new Blob([approvedSvg],{type:'image/svg+xml'});
 const objectUrl=URL.createObjectURL(blob);
 try{
  const logo=new Image();
  await new Promise<void>((resolve,reject)=>{
   logo.onload=()=>resolve();
   logo.onerror=()=>reject(new Error('Не удалось подготовить эмблему ГОС.ID.'));
   logo.src=objectUrl;
  });
  const canvas=document.createElement('canvas');
  canvas.width=1024;canvas.height=1024;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('Браузер не поддерживает создание изображения бота.');
  ctx.fillStyle='#2453e6';
  ctx.fillRect(0,0,1024,1024);
  ctx.drawImage(logo,0,0,1024,1024);
  const data=canvas.toDataURL('image/jpeg',0.93);
  if(!data.startsWith('data:image/jpeg;base64,'))throw new Error('Не удалось создать эмблему в формате JPEG.');
  const base64=data.slice('data:image/jpeg;base64,'.length);
  if(base64.length<1000||base64.length>300000)throw new Error('Неподходящий размер эмблемы Телеграма.');
  return base64;
 }finally{URL.revokeObjectURL(objectUrl)}
}
