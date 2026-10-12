import type {ReactNode} from 'react';

export const BRAND_NAME='ГОС.ID';
export const BRAND_TAGLINE='Цифровая платформа России';

// The approved primary mark is a blue rounded square with white Latin ID.
// The optional second palette is pink with blue ID. No other letters or slashes
// belong inside either mark; the adjacent wordmark is always solid black.
export type BrandVariant='blue-pink'|'pink-blue';

export function BrandMark({variant='blue-pink'}:{variant?:BrandVariant}){
 return <span className={'brandMark gosIdMark gosIdMark--'+variant} aria-hidden="true">ID</span>;
}
export function BrandName({variant='blue-pink'}:{variant?:BrandVariant}){
 return <b className={'gosIdWordmark gosIdWordmark--'+variant}>ГОС.ID</b>;
}
export function BrandIdentity({variant='blue-pink',tagline=false}:{variant?:BrandVariant;tagline?:boolean}):ReactNode{
 return <><BrandMark variant={variant}/><span className="gosIdIdentityCopy"><BrandName variant={variant}/>{tagline&&<small className="gosIdTagline">{BRAND_TAGLINE}</small>}</span></>;
}
