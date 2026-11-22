import catalog from '@/data/taxes-2026.json';
export type FiscalRegion={game_id:string;region_code:string;name:string;profile:string;disputed:boolean;budget_year:number;enterprises:number;employees_per_firm:number;monthly_wage:number;profit_per_firm:number;consumption_per_firm:number;expenditure:number;transfer_in:number;budget_credit_cash?:number;debt:number;compliance:number;activity_multiplier:number;cost_multiplier:number;observations:Record<string,number|null>;source_url:string;source_year:number};
export type FiscalRate={region_code:string;tax_key:string;rate:number};
export type FiscalPolicy={budget_aux_anchor?:Record<string,number>;fnb_total?:number;fnb_liquid?:number;fnb_fx_share?:number;monetary_last_settled_on?:string;monetary_last_effect_date?:string|null;monetary_last_daily_effect?:number;monetary_cumulative_effect?:number;monetary_last_day_details?:Array<{date:string;change:number}>;tax_activity_reference?:number;key_rate:number;fx_rate:number;oil_price:number;cutoff_price:number;inflation:number;federal_expenditure:number;municipal_expenditure:number;baseline_economy:number;baseline_trust:number;activity_override?:number|null;activity_reference?:number|null;collection_lawfulness_reference?:number|null;updated_at:string};
export type FiscalContext={policy:FiscalPolicy;metrics:Record<string,number>;can_change_rate:boolean};
/** Model B additional channels: the existing 0.002 activity and 0.0005
 * collection sensitivities, distributed over seven supplementary indicators.
 * Zero effect at the per-game anchor; no historical budget revaluation.
 */
export const MODEL_B_AUX_KEYS=['social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate'] as const;
export function modelBAdditionalChannels(metrics:Record<string,number>,anchors?:Record<string,number>|null){
 const delta=(key:typeof MODEL_B_AUX_KEYS[number])=>{
  const current=metrics[key],reference=anchors?.[key];
  return Number.isFinite(current)&&typeof reference==='number'&&Number.isFinite(reference)?current-reference:0;
 };
 const activityPoints=(delta('social_stability')+delta('security')+delta('elite_support')+delta('international_standing')-delta('social_tension'))/5;
 const collectionPoints=(delta('legitimacy')+delta('media_climate'))/2;
 return {activity_adjustment:Math.max(-.03,Math.min(.03,activityPoints*.002)),collection_adjustment:Math.max(-.01,Math.min(.01,collectionPoints*.0005))};
}
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export function fiscalEnvironment(c?:FiscalContext|null){
 if(!c)return {activity:1,cost:1,fx:80,uncertainty:.04};
 const aux=modelBAdditionalChannels(c.metrics,c.policy.budget_aux_anchor);
 const p=c.policy,economy=(c.metrics.economy??p.baseline_economy)-p.baseline_economy,trust=(c.metrics.public_trust??p.baseline_trust)-p.baseline_trust;
 const fx=p.fx_rate*clamp(1-economy*.001-trust*.001-(p.key_rate-16)*.0015,.75,1.3);
 // A manual value is a new starting level, not a permanent freeze.
 // The reference factor is captured when the teacher sets that level.
 const automatic=clamp(1-(p.key_rate-16)*.007+economy*.002+trust*.001-(fx/80-1)*.06+aux.activity_adjustment,.65,1.4);
 const reference=p.activity_reference!=null&&p.activity_reference>0?p.activity_reference:automatic;
 const activity=p.activity_override!=null?clamp(p.activity_override/100*automatic/reference,0,10):automatic;
 const cost=clamp(1+(p.inflation-6)*.004+(fx/80-1)*.02,.7,1.6);
 const uncertainty=clamp(.04+Math.abs(economy)*.001+Math.abs(trust)*.001+Math.abs(p.inflation-6)*.003,.025,.2);
 return {activity,cost,fx,uncertainty};
}
export function fiscalForecast(r:FiscalRegion,rates:FiscalRate[],preview?:{tax:string;rate:number},context?:FiscalContext|null){
 const macro=fiscalEnvironment(context),a=r.activity_multiplier*macro.activity,employees=r.enterprises*r.employees_per_firm;
 const economyShift=context?(context.metrics.economy??context.policy.baseline_economy)-context.policy.baseline_economy:0;
 const fixedBaseFactor=clamp(1+economyShift*.002,.7,1.3);
 const oilFactor=context?context.policy.oil_price/75*macro.fx/80*fixedBaseFactor:1;
 const bases:Record<string,number>={consumption:r.enterprises*r.consumption_per_firm*a,payroll:employees*r.monthly_wage*12/1e6*macro.activity,profit:r.enterprises*r.profit_per_firm*a,corporate_assets:r.enterprises*18*fixedBaseFactor,horsepower:r.enterprises*2*120*fixedBaseFactor,land_value:r.enterprises*3*fixedBaseFactor,housing_value:employees*2.5*fixedBaseFactor,tourism_income:(r.profile==='tourism'?r.enterprises*3:r.enterprises*.2)*macro.activity,oil_income:r.profile==='resources'?r.enterprises*4*oilFactor:0,gambling_income:0};
 const law=context?.metrics.lawfulness,ref=context?.policy.collection_lawfulness_reference;
 const trust=context?.metrics.public_trust,trustRef=context?.policy.baseline_trust;
 // Limit the total regional collection adjustment to +/-1 percentage point.
 const adjustment=clamp((law!=null&&ref!=null?(law-ref)*.0003:0)+(trust!=null&&trustRef!=null?(trust-trustRef)*.0005:0)+(context?modelBAdditionalChannels(context.metrics,context.policy.budget_aux_anchor).collection_adjustment:0),-.01,.01);
 const economicCollectionShift=clamp(
 (macro.activity/Math.max(.01,context?.policy.tax_activity_reference??macro.activity)-1)*.12,-.06,.015);
 const effectiveCollection=clamp(r.compliance+adjustment+economicCollectionShift,0,1);
 const lines=catalog.taxes.map(t=>{
  const scope=t.level==='federal'?'00':r.region_code;
  const rate=preview?.tax===t.key?preview.rate:rates.find(x=>x.tax_key===t.key&&x.region_code===scope)?.rate??t.default_rate;
  const base=t.base_key?bases[t.base_key]??0:null;
  const amount=base===null||rate===null?null:base*rate*(t.key==='transport'?1e-6:.01)*effectiveCollection;
  // Reduced teaching shares. The legal classification and the receiving budget are separate concepts.
  const fed=t.level==='federal'?(t.key==='income'?0:t.key==='profit'?.32:1):0;
  const reg=t.level==='regional'?1:t.key==='income'?.85:t.key==='profit'?.68:0;
  return {...t,rate,base,amount,federal:amount===null?null:amount*fed,regional:amount===null?null:amount*reg,municipal:amount===null?null:amount*(1-fed-reg)};
 });
 const federal=lines.reduce((s,x)=>s+(x.federal??0),0),regionalTax=lines.reduce((s,x)=>s+(x.regional??0),0),municipal=lines.reduce((s,x)=>s+(x.municipal??0),0);
 const rateCost=context?r.debt*(context.policy.key_rate-16)*.0005:0;
 const revenue=regionalTax+r.transfer_in,expenditure=Math.max(0,r.expenditure*r.cost_multiplier*macro.cost+rateCost),balance=revenue-expenditure,deficit=Math.max(0,-balance);
 const burden=(lines.find(x=>x.key==='profit')?.rate??25)+(lines.find(x=>x.key==='corporate_property')?.rate??2.2);
 const nextActivity=Math.max(.1,a*(1-Math.max(-.12,Math.min(.12,(burden-27.2)*.003))));
 const rateDeviation=lines.reduce((sum,t)=>sum+(t.rate!==null&&t.default_rate!==null?Math.abs(t.rate-t.default_rate)/Math.max(1,t.default_rate):0),0)/Math.max(1,lines.filter(t=>t.default_rate!==null).length);
 const spread=clamp(macro.uncertainty+Math.abs(burden-27.2)*.003+rateDeviation*.02,.025,.24);
 return {lines,federal,regionalTax,municipal,revenue,expenditure,balance,deficit,financing:r.budget_credit_cash??0,debt:r.debt+Math.max(0,deficit-(r.budget_credit_cash??0)),employees,coverage:expenditure?revenue/expenditure:null,nextActivity,spread,revenueLow:revenue*(1-spread),revenueHigh:revenue*(1+spread),expenditureLow:expenditure*(1-macro.uncertainty),expenditureHigh:expenditure*(1+macro.uncertainty)};
}
export function fiscalTotal(regions:FiscalRegion[],rates:FiscalRate[],context?:FiscalContext|null){
 return regions.reduce((s,r)=>{const f=fiscalForecast(r,rates,undefined,context);return{revenue:s.revenue+f.revenue,expenditure:s.expenditure+f.expenditure,federal:s.federal+f.federal,municipal:s.municipal+f.municipal,transfers:s.transfers+r.transfer_in,enterprises:s.enterprises+r.enterprises,revenueLow:s.revenueLow+f.revenueLow,revenueHigh:s.revenueHigh+f.revenueHigh,federalLow:s.federalLow+f.federal*(1-f.spread),federalHigh:s.federalHigh+f.federal*(1+f.spread),municipalLow:s.municipalLow+f.municipal*(1-f.spread),municipalHigh:s.municipalHigh+f.municipal*(1+f.spread)};},{revenue:0,expenditure:0,federal:0,municipal:0,transfers:0,enterprises:0,revenueLow:0,revenueHigh:0,federalLow:0,federalHigh:0,municipalLow:0,municipalHigh:0});
}
