// SQL presence uses one visible-only timer. No extra network subscription.
export function schedulePresenceHeartbeat(options:{readyAt:number;heartbeatMs:number;write:(navigation:boolean)=>void;isVisible:()=>boolean;now:()=>number;schedule:(fn:()=>void,delay:number)=>ReturnType<typeof setTimeout>;cancel:(timer:ReturnType<typeof setTimeout>)=>void}){
 let timer:ReturnType<typeof setTimeout>|undefined;
 let navigationPending=true,disposed=false;
 function clear(){if(timer!==undefined){options.cancel(timer);timer=undefined}}
 function tick(){
  clear();
  if(disposed||!options.isVisible())return;
  const remaining=options.readyAt-options.now();
  if(remaining>0){timer=options.schedule(tick,remaining);return}
  const navigation=navigationPending;
  navigationPending=false;
  options.write(navigation);
  timer=options.schedule(tick,options.heartbeatMs);
 }
 function visibilityChanged(){if(options.isVisible())tick();else clear()}
 function dispose(){disposed=true;clear()}
 tick();
 return {visibilityChanged,dispose};
}
