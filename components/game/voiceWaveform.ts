/** Real waveform extraction; failures are nonfatal and preserve plain playback.
 * Normalized RMS peaks represent the recording, not a decorative pattern. */
export const VOICE_BARS=36;
export type VoiceAnalysis={waveform:number[];duration:number};

export function voiceWaveformFromSamples(channels:Float32Array[],count=VOICE_BARS):number[]{
 if(!channels.length||!channels[0]?.length)return Array.from({length:count},()=>18);
 const length=channels[0].length;
 const rms=Array.from({length:count},(_,i)=>{
  const start=Math.floor(i*length/count),end=Math.max(start+1,Math.floor((i+1)*length/count));
  const stride=Math.max(1,Math.floor((end-start)/300));
  let square=0,n=0;
  for(let s=start;s<end;s+=stride){
   for(const channel of channels){const amplitude=channel[s]||0;square+=amplitude*amplitude;n++}
  }
  return Math.sqrt(square/Math.max(n,1));
 });
 const loudest=Math.max(...rms,1e-6);
 return rms.map(v=>Math.round(Math.max(18,Math.min(100,18+82*(v/loudest)**0.65))));
}

export async function analyseVoiceBlob(blob:Blob):Promise<VoiceAnalysis|null>{
 if(typeof window==='undefined'||typeof AudioContext==='undefined'||!blob.size||blob.size>15*1024*1024)return null;
 const ctx=new AudioContext();
 try{
  const bytes=await blob.arrayBuffer();
  const decoded=await ctx.decodeAudioData(bytes);
  if(!Number.isFinite(decoded.duration)||decoded.duration<=0)return null;
  const channels=Array.from({length:Math.min(decoded.numberOfChannels,2)},(_,i)=>decoded.getChannelData(i));
  return{waveform:voiceWaveformFromSamples(channels),duration:decoded.duration};
 }catch{return null}
 finally{void ctx.close().catch(()=>{});}
}

export function normalizeVoiceWaveform(value:unknown):number[]|null{
 if(!Array.isArray(value)||value.length!==VOICE_BARS||!value.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100))return null;
 return value.map(x=>Math.round(Math.max(12,Math.min(100,x))));
}
