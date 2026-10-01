import catalog from '@/data/taxes-2026.json';
export type FiscalRegion={game_id:string;region_code:string;name:string;profile:string;disputed:boolean;budget_year:number;enterprises:number;employees_per_firm:number;monthly_wage:number;profit_per_firm:number;consumption_per_firm:number;expenditure:number;transfer_in:number;debt:number;compliance:number;activity_multiplier:number;cost_multiplier:number;observations:Record<string,number|null>;source_url:string;source_year:number};
export type FiscalRate={region_code:string;tax_key:string;rate:number};
export function fiscalForecast(r:FiscalRegion,rates:FiscalRate[],preview?:{tax:string;rate:number}){
 const a=r.activity_multiplier,employees=r.enterprises*r.employees_per_firm;
 const bases:Record<string,number>={consumption:r.enterprises*r.consumption_per_firm*a,payroll:employees*r.monthly_wage*12/1e6,profit:r.enterprises*r.profit_per_firm*a,corporate_assets:r.enterprises*18,horsepower:r.enterprises*2*120,land_value:r.enterprises*3,housing_value:employees*2.5,tourism_income:r.profile==='tourism'?r.enterprises*3:r.enterprises*.2,oil_income:r.profile==='resources'?r.enterprises*4:0,gambling_income:0};
 const lines=catalog.taxes.map(t=>{
  const scope=t.level==='federal'?'00':r.region_code;
  const rate=preview?.tax===t.key?preview.rate:rates.find(x=>x.tax_key===t.key&&x.region_code===scope)?.rate??t.default_rate;
  const base=t.base_key?bases[t.base_key]??0:null;
  const amount=base===null||rate===null?null:base*rate*(t.key==='transport'?1e-6:.01)*r.compliance;
  // Reduced teaching shares. The legal classification and the receiving budget are separate concepts.
  const fed=t.level==='federal'?(t.key==='income'?0:t.key==='profit'?.32:1):0;
  const reg=t.level==='regional'?1:t.key==='income'?.85:t.key==='profit'?.68:0;
  return {...t,rate,base,amount,federal:amount===null?null:amount*fed,regional:amount===null?null:amount*reg,municipal:amount===null?null:amount*(1-fed-reg)};
 });
 const federal=lines.reduce((s,x)=>s+(x.federal??0),0),regionalTax=lines.reduce((s,x)=>s+(x.regional??0),0),municipal=lines.reduce((s,x)=>s+(x.municipal??0),0);
 const revenue=regionalTax+r.transfer_in,expenditure=r.expenditure*r.cost_multiplier,balance=revenue-expenditure,deficit=Math.max(0,-balance);
 const burden=(lines.find(x=>x.key==='profit')?.rate??25)+(lines.find(x=>x.key==='corporate_property')?.rate??2.2);
 const nextActivity=Math.max(.1,a*(1-Math.max(-.12,Math.min(.12,(burden-27.2)*.003))));
 return {lines,federal,regionalTax,municipal,revenue,expenditure,balance,deficit,debt:r.debt+deficit,employees,coverage:expenditure?revenue/expenditure:null,nextActivity};
}
export function fiscalTotal(regions:FiscalRegion[],rates:FiscalRate[]){
 return regions.reduce((s,r)=>{const f=fiscalForecast(r,rates);return{revenue:s.revenue+f.revenue,expenditure:s.expenditure+f.expenditure,federal:s.federal+f.federal,municipal:s.municipal+f.municipal,transfers:s.transfers+r.transfer_in,enterprises:s.enterprises+r.enterprises};},{revenue:0,expenditure:0,federal:0,municipal:0,transfers:0,enterprises:0});
}
