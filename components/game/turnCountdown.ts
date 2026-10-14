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
