// Browser navigation is UI state only. No credentials, permissions or server calls.
export type PositionedScreen={browserPosition?:number};
export type SectionHistory<T extends PositionedScreen>={entries:T[];index:number;chain?:string};
export type BrowserScreen<T extends PositionedScreen>={scope:string;chain:string;position:number;screen:T};
export const BROWSER_SECTION_KEY='gosSectionV1';
const position=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export function readBrowserScreen<T extends PositionedScreen>(value:unknown,scope:string,valid:(value:unknown)=>boolean):BrowserScreen<T>|null{
 if(!value||typeof value!=='object')return null;
 const marker=(value as Record<string,unknown>)[BROWSER_SECTION_KEY] as BrowserScreen<T>|undefined;
 if(!marker||marker.scope!==scope||typeof marker.chain!=='string'||!marker.chain||marker.chain.length>100||!position(marker.position)||!valid(marker.screen))return null;
 return marker;
}
export function startHistory<T extends PositionedScreen>(screen:T,chain:string):SectionHistory<T>{
 return {chain,index:0,entries:[{...screen,browserPosition:0}]};
}
export function browserMarker<T extends PositionedScreen>(history:SectionHistory<T>,scope:string):BrowserScreen<T>{
 const screen=history.entries[history.index];
 if(!history.chain||!position(screen?.browserPosition))throw Error('Invalid section history');
 return {scope,chain:history.chain,position:screen.browserPosition,screen};
}
export function restoreHistory<T extends PositionedScreen>(history:SectionHistory<T>|null,marker:BrowserScreen<T>,screen:T=marker.screen):SectionHistory<T>{
 const entries=history?.chain===marker.chain?history.entries.filter(e=>position(e.browserPosition)&&e.browserPosition!==marker.position):[];
 entries.push({...screen,browserPosition:marker.position});
 entries.sort((a,b)=>a.browserPosition!-b.browserPosition!);
 // Keep the current entry and up to 60 known neighbors, even after long histories.
 const index=entries.findIndex(e=>e.browserPosition===marker.position);
 const first=Math.max(0,Math.min(index-30,entries.length-60));
 const bounded=entries.slice(first,first+60);
 return {chain:marker.chain,entries:bounded,index:index-first};
}
export function appendHistory<T extends PositionedScreen>(history:SectionHistory<T>,screen:T,same:(a:T,b:T)=>boolean):SectionHistory<T>{
 const current=history.entries[history.index];
 if(same(current,screen))return history;
 const entries=[...history.entries.slice(0,history.index+1),{...screen,browserPosition:current.browserPosition!+1}].slice(-60);
 return {...history,entries,index:entries.length-1};
}
export function historyDistance<T extends PositionedScreen>(history:SectionHistory<T>,index:number):number{
 if(!Number.isInteger(index)||index<0||index>=history.entries.length)return 0;
 const a=history.entries[history.index].browserPosition,b=history.entries[index].browserPosition;
 return position(a)&&position(b)?b-a:0;
}
