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
 return key==='budget'&&(!unit||unit.startsWith('млн'))?moneyMillions(value):quantity(value,unit||'пунктов');
}
/** Legacy budget laboratories may state their own scale in the source note. */
export function scenarioUnit(note:string|null|undefined){
 const s=(note||'').toLowerCase();
 return /трлн|триллион/.test(s)?'трлн ₽':/млрд|миллиард/.test(s)?'млрд ₽':/млн|миллион/.test(s)?'млн ₽':/тыс\.?|тысяч/.test(s)?'тыс. ₽':/рубл|₽/.test(s)?'₽':'млн ₽';
}
export function scenarioMoney(value:number|null|undefined,note?:string|null){return quantity(value,scenarioUnit(note));}

/** A signed program's annual commitment is stored in roubles; scenario inputs
 * use the scale already shown by the Budget Lab, without changing saved data. */
export function scenarioAmountFromRubles(amountRubles:number,note:string|null|undefined){
 if(!Number.isFinite(amountRubles)||amountRubles<0)return null;
 const unit=scenarioUnit(note);
 const divisor=unit==='трлн ₽'?1e12:unit==='млрд ₽'?1e9:unit==='млн ₽'?1e6:unit==='тыс. ₽'?1e3:1;
 return amountRubles/divisor;
}
