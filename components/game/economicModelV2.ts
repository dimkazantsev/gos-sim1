/** Proposed v2 economic coefficients. Pure calculation; no I/O, polling or persistence.
 * Not enabled until the authoritative SQL, migration and end-to-end parity checks pass.
 */
type Metrics=Record<string,number>;
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));

export function economicAuxV2(metrics:Metrics,anchors:Metrics){
 const delta=(key:string)=>Number.isFinite(metrics[key])&&Number.isFinite(anchors[key])?metrics[key]-anchors[key]:0;
 const political=clamp(.004*delta('social_stability')+.004*delta('security')+.002*delta('elite_support')+.004*delta('international_standing'),-.25,.25);
 const tension=Number.isFinite(metrics.social_tension)?clamp((metrics.social_tension-60)*.005,0,.20):0;
 return {activity_adjustment:political-tension,collection_adjustment:clamp(.0015*delta('legitimacy')+.001*delta('media_climate'),-.08,.08)};
}

export function economicAutomaticV2(keyRate:number,baseFx:number,economyDelta:number,trustDelta:number,aux:number){
 const fx=baseFx*clamp(1-economyDelta*.001-trustDelta*.001-(keyRate-16)*.0015,.75,1.3);
 return {fx,automatic:clamp(1-(keyRate-16)*.015+economyDelta*.010+trustDelta*.005-(fx/80-1)*.06+aux,.2,2)};
}

export function economicManualV2(automatic:number,override?:number|null,reference?:number|null){
 return override==null?automatic:clamp(override/100*automatic/(reference!=null&&reference>0?reference:automatic),0,10);
}

export function economicCollectionV2(activity:number,reference:number,lawDelta:number,trustDelta:number,aux:number){
 const economic=clamp((activity/Math.max(.01,reference)-1)*.12,-.06,.015);
 return economic+lawDelta*.002+trustDelta*.0015+aux;
}

export function enterpriseFactorsV2(count:number,weighted:number,baseline:number,macro:number){
 const enterprise_factor=count/Math.max(1,baseline);
 const regional_activity=count>0?weighted/count:0;
 return {enterprise_factor,regional_activity,activity:clamp(enterprise_factor*regional_activity*macro,0,10)};
}

// Preserve the linear coefficients in the interior and smoothly
// approach existing limits within a 2.5 percentage-point shoulder.
export function boundedCollectionV2(raw:number,min:number,max:number){
 const h=Math.min(.025,(max-min)/2);
 if(raw>max-h)return max-h*h/(raw-max+2*h);
 if(raw<min+h)return min+h*h/(min+2*h-raw);
 return raw;
}
