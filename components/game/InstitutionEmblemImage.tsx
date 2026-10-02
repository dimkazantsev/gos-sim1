'use client';
import {useEffect,useState} from 'react';
import {Building2,Landmark} from 'lucide-react';

export default function InstitutionEmblemImage({src,alt,className,width,height,fallback='institution'}:{
 src?:string|null;alt:string;className?:string;width?:number;height?:number;fallback?:'institution'|'party'
}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[src]);
 if(!src||failed){
  const Icon=fallback==='party'?Landmark:Building2;
  return <Icon className={className} width={width} height={height} aria-label={alt}/>;
 }
 return <img className={className} src={src} alt={alt} width={width} height={height} onError={()=>setFailed(true)}/>;
}
