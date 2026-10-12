import type {ReactNode} from 'react';

export const BRAND_NAME='ГОС.ID';
export const BRAND_TAGLINE='Республиканская цифровая платформа';
export type BrandVariant='blue-pink'|'pink-blue';

export function BrandMark({variant='blue-pink'}:{variant?:BrandVariant}){
 return <span className={'brandMark gosIdMark gosIdMark--'+variant} aria-hidden="true">г<span>//</span>id</span>;
}
export function BrandName({variant='blue-pink'}:{variant?:BrandVariant}){
 return <b className={'gosIdWordmark gosIdWordmark--'+variant}>ГОС<span className="gosIdSeparator">.</span><span className="gosIdSuffix">ID</span></b>;
}
export function BrandIdentity({variant='blue-pink',tagline=false}:{variant?:BrandVariant;tagline?:boolean}):ReactNode{
 return <><BrandMark variant={variant}/><span className="gosIdIdentityCopy"><BrandName variant={variant}/>{tagline&&<small className="gosIdTagline">{BRAND_TAGLINE}</small>}</span></>;
}
