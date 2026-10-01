import type {ReactNode} from 'react';
import type {View} from './types';
const views=new Set(['dashboard','stages','parties','votes','documents','actions','grades','profile','teacher','events']);
export default function RichPostText({text,onNavigate,onOpenDocument}:{text:string;onNavigate:(view:View)=>void;onOpenDocument:(id:string)=>void}){
 const nodes:ReactNode[]=[];let last=0;
 const pattern=/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|gos:[a-z]+(?:\?id=[a-zA-Z0-9_-]+)?)\)|https?:\/\/[^\s<>]+/g;
 for(const m of text.replace(/\\n/g,'\n').matchAll(pattern)){
  if(m.index!>last)nodes.push(text.replace(/\\n/g,'\n').slice(last,m.index));
  const href=m[2]||m[0],label=m[1]||href;
  if(href.startsWith('gos:')){
   const [view,query]=href.slice(4).split('?'),id=new URLSearchParams(query||'').get('id');
   nodes.push(views.has(view)?<button type="button" className="postInlineLink" key={m.index} onClick={()=>view==='documents'&&id?onOpenDocument(id):onNavigate(view as View)}>{label}</button>:m[0]);
  }else nodes.push(<a key={m.index} href={href} target="_blank" rel="noreferrer">{label}</a>);
  last=m.index!+m[0].length;
 }
 nodes.push(text.replace(/\\n/g,'\n').slice(last));
 return <div className="postRichText">{nodes}</div>;
}
