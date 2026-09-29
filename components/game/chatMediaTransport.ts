/** Idempotent two-stage chat media transport.
 * A recording is never discarded when either Storage or message insertion fails.
 * Retrying after a successful upload reuses the same object and message UUID. */
export type MediaKind='file'|'audio'|'video';
export type MediaUploadPhase='idle'|'uploading'|'saving';
export type PendingMediaUpload={path:string;messageId:string};
export type MediaRecord={
 id:string;game_id:string;channel_id:string;author_id:string;
 kind:MediaKind;text:string;storage_path:string;mime_type:string|null;voice_meta?:{duration?:number;waveform?:number[]}|null;
};
type RequestResult={error:null|{message:string;code?:string}};
export type MediaTransport={
 upload:(path:string,blob:Blob,contentType:string)=>Promise<RequestResult>;
 insert:(record:MediaRecord)=>Promise<RequestResult>;
 exists:(messageId:string)=>Promise<boolean>;
};
export type MediaSendInput={
 blob:Blob;fileName:string;mime:string;kind:MediaKind;voiceMeta?:{duration?:number;waveform?:number[]}|null;
 gameId:string;channelId:string;userId:string;
 pending?:PendingMediaUpload;generateId:()=>string;
 onPhase?:(phase:MediaUploadPhase)=>void;
 transport:MediaTransport;
};
export type MediaSendResult=
 |{ok:true;pending:PendingMediaUpload}
 |{ok:false;stage:'validation'|'upload'|'message';error:string;pending?:PendingMediaUpload};

export async function sendChatMedia(input:MediaSendInput):Promise<MediaSendResult>{
 const {blob,fileName,mime,kind,gameId,channelId,userId,transport}=input;
 if(!blob.size)return{ok:false,stage:'validation',error:'Запись пуста. Запишите сообщение ещё раз.'};
 if(blob.size>25*1024*1024)return{ok:false,stage:'validation',error:'Запись превышает 25 МБ. Сохраните её на устройство или запишите более короткий фрагмент.'};
 if(!gameId||!channelId||!userId)return{ok:false,stage:'validation',error:'Канал недоступен. Повторно откройте чат.'};
 const ext=(fileName.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'')||'bin';
 let pending=input.pending;
 if(!pending){
  pending={messageId:input.generateId(),path:gameId+'/'+channelId+'/'+userId+'/'+input.generateId()+'.'+ext};
  input.onPhase?.('uploading');
  try{
   // Storage content type is a bare MIME. The full codec string is retained
   // in the chat_messages row so playback metadata is not lost.
   const result=await transport.upload(pending.path,blob,mime.split(';')[0].trim()||'application/octet-stream');
   if(result.error)return{ok:false,stage:'upload',error:'Не удалось загрузить медиа: '+result.error.message};
  }catch(e){
   return{ok:false,stage:'upload',error:'Соединение при загрузке прервалось: '+(e instanceof Error?e.message:'повторите попытку.')};
  }
 }
 input.onPhase?.('saving');
 const record:MediaRecord={
  id:pending.messageId,game_id:gameId,channel_id:channelId,author_id:userId,
  kind,text:fileName,storage_path:pending.path,mime_type:mime||null,...(kind==='audio'&&input.voiceMeta?{voice_meta:input.voiceMeta}:{})
 };
 try{
  const result=await transport.insert(record);
  if(result.error){
   // A network failure after a committed insertion can leave the client
   // uncertain whether it was saved. UUID + SELECT prevents duplicates.
   if(result.error.code==='23505'&&await transport.exists(pending.messageId))
    return{ok:true,pending};
   return{ok:false,stage:'message',error:'Файл загружен, но сообщение не опубликовано: '+result.error.message,pending};
  }
  return{ok:true,pending};
 }catch(e){
  try{if(await transport.exists(pending.messageId))return{ok:true,pending}}catch{}
  return{ok:false,stage:'message',error:'Сбой публикации после загрузки. Повторите отправку: '+(e instanceof Error?e.message:'ошибка сети.'),pending};
 }
}
