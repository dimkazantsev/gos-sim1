export type ElectoralAllocationMethod='hare'|'droop'|'dhondt'|'sainte_lague'|'imperiali';

// Stage 2 models 100 million voters. A Droop quota's +1 is one ballot,
// so percentage support must first be converted to that common electorate.
const MODEL_ELECTORATE=100_000_000;
const PARLIAMENT_SEATS=450;

function largestRemainder(values:number[],seats:number,quota:number){
 const raw=values.map(value=>value/quota);
 const out=raw.map(value=>Math.floor(value));
 const remaining=seats-out.reduce((sum,value)=>sum+value,0);
 const order=raw.map((value,index)=>({index,remainder:value-Math.floor(value)}))
  .filter(({index})=>values[index]>0)
  .sort((a,b)=>Math.abs(b.remainder-a.remainder)<1e-9?a.index-b.index:b.remainder-a.remainder);
 for(let i=0;i<remaining;i++)out[order[i].index]++;
 return out;
}

export function allocateElectoralSeats(values:number[],seats:number,method:ElectoralAllocationMethod|null):number[]{
 const empty=values.map(()=>0);
 if(!method||!Number.isInteger(seats)||seats<=0||seats>PARLIAMENT_SEATS||
  values.some(value=>!Number.isFinite(value)||value<0))return empty;
 const maximum=values.reduce((max,value)=>Math.max(max,value),0);
 if(maximum===0)return empty;
 // Relative support is scale invariant, including large finite inputs.
 const weights=values.map(value=>value/maximum);
 const total=weights.reduce((sum,value)=>sum+value,0);
 const ballots=largestRemainder(weights,MODEL_ELECTORATE,total/MODEL_ELECTORATE);
 if(method==='hare')return largestRemainder(ballots,seats,MODEL_ELECTORATE/seats);
 if(method==='droop'){
  const quota=Math.floor(MODEL_ELECTORATE/(seats+1))+1;
  return largestRemainder(ballots,seats,quota);
 }
 const out=empty;
 for(let seat=0;seat<seats;seat++){
  let best=-1,bestQuotient=-1;
  for(let i=0;i<ballots.length;i++){
   if(ballots[i]===0)continue;
   const divisor=method==='dhondt'?out[i]+1:method==='sainte_lague'?out[i]*2+1:out[i]+2;
   const quotient=ballots[i]/divisor;
   const tolerance=Number.EPSILON*8*Math.max(1,quotient,bestQuotient);
   if(quotient>bestQuotient+tolerance){bestQuotient=quotient;best=i;}
  }
  out[best]++;
 }
 return out;
}

export function allocateRegionalSeats(values:number[],seats=89):number[]{
 const total=values.reduce((sum,value)=>sum+value,0);
 if(!values.length||values.some(value=>!Number.isFinite(value)||value<0)||!Number.isFinite(total)||total<=0||!Number.isInteger(seats)||seats<=0||seats>89)return values.map(()=>0);
 return largestRemainder(values,seats,total/seats);
}
