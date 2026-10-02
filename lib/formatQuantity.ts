/** Consistent Russian quantities; monetary inputs are stored in millions of roubles. */
const numeric = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});
export function quantity(value:number|null|undefined,unit:string){
 return value==null||!Number.isFinite(value)?'Не задано':numeric.format(value)+(unit?' '+unit:'');
}
export function moneyMillions(value:number|null|undefined){
 if(value==null||!Number.isFinite(value))return 'Не задано';
 const n=Math.abs(value);
 return n>=1e6?quantity(value/1e6,'трлн ₽'):n>=1000?quantity(value/1000,'млрд ₽'):n>=1?quantity(value,'млн ₽'):n>=.001?quantity(value*1000,'тыс. ₽'):quantity(value*1e6,'₽');
}
export function metricQuantity(value:number,unit:string|null,key?:string){
 return quantity(value,key==='budget'&&unit==='млн'?'млн ₽':unit||'пунктов');
}
