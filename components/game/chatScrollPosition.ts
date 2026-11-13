/* Local-only chat scroll anchoring. No storage, network or message mutation. */
export type ChatScrollPosition=
 |{atBottom:true}
 |{atBottom:false;messageId:string|null;offset:number;previousTop:number};

export function captureChatScroll(container:HTMLElement,followLatest:boolean):ChatScrollPosition{
 if(followLatest)return{atBottom:true};
 const top=container.getBoundingClientRect().top;
 const first=[...container.querySelectorAll<HTMLElement>('[data-message-id]')]
  .find(node=>node.getBoundingClientRect().bottom>top+1);
 return{atBottom:false,messageId:first?.dataset.messageId||null,
  offset:first?first.getBoundingClientRect().top-top:0,previousTop:container.scrollTop};
}

export function restoreChatScroll(container:HTMLElement,position:ChatScrollPosition):void{
 if(position.atBottom){container.scrollTop=container.scrollHeight;return}
 const anchor=position.messageId
  ?[...container.querySelectorAll<HTMLElement>('[data-message-id]')]
    .find(node=>node.dataset.messageId===position.messageId):null;
 if(anchor){
  container.scrollTop+=anchor.getBoundingClientRect().top
   -container.getBoundingClientRect().top-position.offset;
 }else container.scrollTop=position.previousTop;
}
