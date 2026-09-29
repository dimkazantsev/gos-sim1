/** Browser codec negotiation and upload metadata for persistent chat media. */
export type ChatMediaKind='audio'|'video';
export const CHAT_MAX_FILE_BYTES=25*1024*1024;
export const CHAT_AUDIO_TYPES=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus','audio/ogg'];
export const CHAT_VIDEO_TYPES=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/mp4','video/webm'];

export function preferredRecordingMime(kind:ChatMediaKind, supported:(mime:string)=>boolean):string{
 const choices=kind==='audio'?CHAT_AUDIO_TYPES:CHAT_VIDEO_TYPES;
 return choices.find(supported)||'';
}
export function recordingFileExtension(mime:string,kind:ChatMediaKind):string{
 const type=mime.toLowerCase().split(';')[0].trim();
 if(type==='video/mp4'||type==='audio/mp4'||type==='audio/x-m4a')return kind==='audio'?'m4a':'mp4';
 if(type==='audio/ogg'||type==='application/ogg')return 'ogg';
 if(type==='audio/mpeg')return 'mp3';
 if(type==='audio/wav'||type==='audio/x-wav')return 'wav';
 if(type==='video/quicktime')return 'mov';
 if(type==='video/x-matroska')return 'mkv';
 return 'webm';
}
export function uploadedChatKind(mime:string):ChatMediaKind|'file'{
 const type=mime.trim().toLowerCase();
 return type.startsWith('audio/')?'audio':type.startsWith('video/')?'video':'file';
}
export function recordingFileName(kind:ChatMediaKind,mime:string,date:Date=new Date()):string{
 const stamp=date.toISOString().replace(/[:.]/g,'-');
 return (kind==='audio'?'audio-':'video-')+stamp+'.'+recordingFileExtension(mime,kind);
}
export function formatRecordingDuration(seconds:number):string{
 const safe=Math.max(0,Math.floor(seconds));
 return String(Math.floor(safe/60)).padStart(2,'0')+':'+String(safe%60).padStart(2,'0');
}
