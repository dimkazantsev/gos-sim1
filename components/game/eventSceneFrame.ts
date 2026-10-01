/** Exact panel bounds, keyed by the immutable case key rather than list position. */
export function eventSceneFrame(caseKey:string,sceneId?:string){
 const legal=Number(caseKey.match(/^bank-legal-2026-(\d{3})$/)?.[1]||0);
 if(legal>=1&&legal<=150)return{number:legal+50,atlas:'individual',x:0,y:0,width:1920,height:1080};
 const number=Number(caseKey.match(/^bank-curated-v2-(\d+)$/)?.[1]||sceneId?.match(/^scene-(\d+)$/)?.[1]||0);
 if(number<1||number>50)return null;
 if(number>=42&&number<=46)return{number,atlas:'extra',x:(number-42)*434.4+4,y:4,width:426.4,height:716};
 const index=number<=41?number-1:number-6;
 const row=Math.floor(index/5),column=index%5;
 return{number,atlas:'main',x:column*307.2+4,y:row*109+4,width:299.2,height:row===8?148:101};
}
