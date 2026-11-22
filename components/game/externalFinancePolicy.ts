import baseline from '@/data/federal-budget-2026.json';
/** Game-year external financing allowance; money is measured in millions of roubles. */
export type ExternalFinanceContract={id?:string;source_key:string;principal:number;status:string;maturity_month:number;issued_month?:number|null;issued_rubles?:number|null};
export function externalFinancingTerms(standing:number,month=0,contracts:ExternalFinanceContract[]=[],gdp=baseline.gdp){
 const score=Number.isFinite(standing)?Math.min(100,Math.max(0,standing)):0;
 const year=Math.floor(month/12);
 const annualLimit=Math.round(gdp*.03*score/100*1e8)/1e8;
 const used=contracts.reduce((n,c)=>n+(c.source_key==='external'&&c.issued_month!=null&&Math.floor(c.issued_month/12)===year?Number(c.issued_rubles||0):0),0);
 return {score,annualLimit,used,available:Math.max(0,Math.round((annualLimit-used)*1e8)/1e8),rate:7.5+Math.min(4,Math.max(0,3-score)*.5),year};
}
