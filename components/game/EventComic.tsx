'use client';
import SituationIcon from './SituationIcon';
import type {EventComicScene} from './types';

type Props={title:string;category:string;caseKey:string;compact?:boolean;silent?:boolean;scene?:EventComicScene|null};

/**
 * The former raster/comic renderer now routes all situation art to local SVG
 * icons. Keep the public props unchanged for case tiles, dialogs and the
 * instructor bank. Existing authored illustrations stay archived but are not
 * requested by the browser.
 */
export default function EventComic({title,category,caseKey,compact=false,silent=false}:Props){
 return <SituationIcon title={title} category={category} caseKey={caseKey} compact={compact} silent={silent}/>;
}
