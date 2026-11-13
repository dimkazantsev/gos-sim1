'use strict';
/* Synthetic geometry: no browser, network, database or user accounts. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const module={exports:{}};
vm.runInNewContext('(function(exports){'+ts.transpileModule(
 fs.readFileSync('components/game/chatScrollPosition.ts','utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText+'})',{})(module.exports);
const {captureChatScroll,restoreChatScroll}=module.exports;
function container(heights,scrollTop=0,viewport=200){
 const box={scrollTop,scrollHeight:heights.reduce((a,b)=>a+b,0),clientHeight:viewport};
 box.getBoundingClientRect=()=>({top:0,bottom:viewport});
 box.querySelectorAll=()=>heights.map((h,i)=>{
  const start=heights.slice(0,i).reduce((a,b)=>a+b,0);
  return{dataset:{messageId:'message-'+i},getBoundingClientRect:()=>({top:start-box.scrollTop,bottom:start+h-box.scrollTop})};
 });
 return box;
}
const compact=container([120,100,150,190,130,200,160,140],260);
const reading=captureChatScroll(compact,false);
assert.equal(reading.atBottom,false);assert.equal(reading.messageId,'message-2');
const expanded=container([80,70,110,160,90,140,120,100],200);
restoreChatScroll(expanded,reading);
const visible=expanded.querySelectorAll()[2].getBoundingClientRect().top;
assert(Math.abs(visible-reading.offset)<1,'Visible message stays at its old viewport offset');
const collapsedAgain=container([120,100,150,190,130,200,160,140],300);
restoreChatScroll(collapsedAgain,reading);
assert.equal(collapsedAgain.querySelectorAll()[2].getBoundingClientRect().top,reading.offset);
const bottom=captureChatScroll(compact,true);
const latest=container([150,200,240,320,360],10);
restoreChatScroll(latest,bottom);
assert.equal(latest.scrollTop,latest.scrollHeight,'An active latest-message view stays pinned to bottom');
const changedHistory=container([200,220,170,180],0);
restoreChatScroll(changedHistory,{atBottom:false,messageId:'missing',offset:0,previousTop:123});
assert.equal(changedHistory.scrollTop,123,'Unknown message safely falls back to previous scroll position');
console.log('PASS chat scroll anchor: compact/expanded geometry, bottom pin, missing anchor');
