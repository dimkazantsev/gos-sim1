'use client';
import {useEffect,useState} from 'react';
import {Building2,Landmark} from 'lucide-react';
import {smallEmblemSrcSet} from './institutionEmblems';

export default function InstitutionEmblemImage({src,alt,className,width,height,fallback='institution'}:{
 src?:string|null;alt:string;className?:string;width?:number;height?:number;fallback?:'institution'|'party'
}){
 const [failed,setFailed]=useState(false),[originalOnly,setOriginalOnly]=useState(false);
 useEffect(()=>{setFailed(false);setOriginalOnly(false)},[src]);
 if(!src||failed){
  const Icon=fallback==='party'?Landmark:Building2;
  return <Icon className={className} width={width} height={height} aria-label={alt}/>;
 }
 const responsive=originalOnly?undefined:smallEmblemSrcSet(src,width,height);
 return <img className={className} src={src} {...responsive} alt={alt} width={width} height={height} decoding="async" onError={()=>{if(responsive)setOriginalOnly(true);else setFailed(true)}}/>;
}
