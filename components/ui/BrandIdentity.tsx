import type {ReactNode} from 'react';

export const BRAND_NAME='ГОС.ID';
export const BRAND_TAGLINE='Цифровая платформа России';
export type BrandVariant='blue-pink'|'pink-blue';

// The approved pictogram contains ONLY "ID". Default blue is the primary identity;
// pale pink is the alternate palette, not a different logo.
export function BrandMark({variant='blue-pink'}:{variant?:BrandVariant}){
 return <span className={'brandMark gosIdMark gosIdMark--'+variant} aria-hidden="true">ID</span>;
}
export function BrandName({variant='blue-pink'}:{variant?:BrandVariant}){
 return <b className={'gosIdWordmark gosIdWordmark--'+variant}>{BRAND_NAME}</b>;
}
export function BrandIdentity({variant='blue-pink',tagline=false}:{variant?:BrandVariant;tagline?:boolean}):ReactNode{
 return <><BrandMark variant={variant}/><span className="gosIdIdentityCopy"><BrandName variant={variant}/>{tagline&&<small className="gosIdTagline">{BRAND_TAGLINE}</small>}</span></>;
}
