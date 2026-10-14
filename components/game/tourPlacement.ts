/** Pure placement math for navigation walkthrough cards (viewport CSS pixels). */
export type TourRect={left:number;top:number;right:number;bottom:number;width:number;height:number};
export type TourPlacement={left:number;top:number;width:number;maxHeight:number;side:'left'|'right'|'above'|'below'|'center'};
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

export function placeTourCard(target:TourRect|null,viewport:{width:number;height:number},measured:{width:number;height:number}):TourPlacement{
 const {width:w,height:h}=viewport,margin=12,gap=16;
 const preferredWidth=Math.max(0,Math.min(420,w-2*margin));
 const fullHeight=Math.max(0,h-2*margin);
 if(!target)return {left:(w-preferredWidth)/2,top:margin,width:preferredWidth,maxHeight:fullHeight,side:'center'};
 const rightSpace=Math.max(0,w-target.right-gap-margin);
 const leftSpace=Math.max(0,target.left-gap-margin);
 // A side panel is preferable to covering the desktop sidebar; never put it
 // alongside a mobile dock button, where the other dock items would be covered.
 if(w>=600&&Math.max(rightSpace,leftSpace)>=248){
  const side=rightSpace>=leftSpace?'right':'left';
  const width=Math.min(preferredWidth,side==='right'?rightSpace:leftSpace);
  const left=side==='right'?target.right+gap:target.left-gap-width;
  const height=Math.min(measured.height,fullHeight);
  return {left:clamp(left,margin,w-margin-width),top:clamp(target.top+target.height/2-height/2,margin,h-margin-height),width,maxHeight:fullHeight,side};
 }
 const aboveSpace=Math.max(0,target.top-gap-margin),belowSpace=Math.max(0,h-target.bottom-gap-margin);
 const side=aboveSpace>=belowSpace?'above':'below';
 const available=side==='above'?aboveSpace:belowSpace;
 const height=Math.min(measured.height,available);
 return {left:clamp(target.left+target.width/2-preferredWidth/2,margin,w-margin-preferredWidth),
  top:side==='above'?target.top-gap-height:target.bottom+gap,
  width:preferredWidth,maxHeight:available,side};
}
