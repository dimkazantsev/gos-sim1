'use client';
import EventComic from './EventComic';
import type {EventComicScene} from './types';
type TileCase={id:string;case_key:string;title:string;situation:string;category:string;comic_scene?:EventComicScene|null};
export default function EventCaseTile({item,selected=false,summary=false,meta,onClick}:{item:TileCase;selected?:boolean;summary?:boolean;meta:string;onClick:()=>void}){
 return <button type="button" className={'eventCaseTile'+(selected?' selected':'')} data-case={item.case_key} aria-label={'Открыть ситуацию «'+item.title+'»'} aria-pressed={selected} onClick={onClick}>
  <div className="eventTileArtwork"><EventComic title={item.title} category={item.category} caseKey={item.case_key} scene={item.comic_scene} compact silent/></div>
  <div className="eventTileText"><b>{item.title}</b>{summary&&<p>{item.situation}</p>}<small>{meta}</small></div>
 </button>;
}
