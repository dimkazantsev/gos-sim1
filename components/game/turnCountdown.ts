/** Whole days, hours and minutes remaining. Seconds are intentionally hidden. */
function ending(n:number,one:string,few:string,many:string){
 const remainder=n%100;
 if(remainder>=11&&remainder<=14)return many;
 const last=n%10;
 return last===1?one:last>=2&&last<=4?few:many;
}
export function turnCountdown(seconds:number){
 const safeSeconds=Number.isFinite(seconds)?Math.max(0,seconds):0;
 // Round up so a live turn never displays zero minutes before it ends.
 const totalMinutes=Math.ceil(safeSeconds/60);
 const days=Math.floor(totalMinutes/1440);
 const hours=Math.floor(totalMinutes%1440/60);
 const minutes=totalMinutes%60;
 const ariaLabel=`До конца хода: ${days} ${ending(days,'день','дня','дней')}, ${hours} ${ending(hours,'час','часа','часов')}, ${minutes} ${ending(minutes,'минута','минуты','минут')}`;
 return {days,hours,minutes,ariaLabel};
}

/** Keep the existing whole-second rounding, but wake only when the displayed minute changes. */
export function turnMinuteSnapshot(remainingMs:number){
 const seconds=Number.isFinite(remainingMs)?Math.max(0,Math.floor(remainingMs/1000)):0;
 const minutes=Math.ceil(seconds/60);
 // The old display changes when floor(remainingMs/1000) reaches the next minute.
 const delay=minutes>0?Math.max(1,Math.ceil(remainingMs-(minutes-1)*60000-999)):0;
 return {seconds:minutes*60,delay};
}
