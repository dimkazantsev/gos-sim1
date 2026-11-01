// Spread optional SQL presence/journal writes during a classroom entry burst.
// Authentication, member RLS checks and the initial game screen are unaffected.
// Realtime Presence continues to announce connectivity without this delay.
export function firstPresenceWriteDelay(userId:string):number{
 let hash=2166136261;
 for(let i=0;i<userId.length;i++)
  hash=Math.imul(hash^userId.charCodeAt(i),16777619)>>>0;
 return 2000+(hash%15000);
}
