/** Explain existing 330-bank financial outcomes without inventing a new score or amount.
 * Values are the published input to the regional effect engine, before caps.
 * The actual budget is calculated by the server; do not suggest that expense
 * in a region is an immediate change in federal tax revenue. */
export type EventFiscalEffect={
 activity?:number;enterprises?:number;expenditure?:number;cost?:number;transfer_in?:number
};
export function describeEventFiscalEffect(f?:EventFiscalEffect|null):string[]{
 if(!f)return [];
 const number=(n:number)=>`${n>0?'+':''}${n.toLocaleString('ru-RU',{maximumFractionDigits:5})}`;
 const items:{key:keyof EventFiscalEffect;label:string;unit:string}[]=[
  {key:'activity',label:'коэффициент деловой активности',unit:''},
  {key:'enterprises',label:'условные предприятия',unit:''},
  {key:'expenditure',label:'расходы региона',unit:' млн ₽'},
  {key:'cost',label:'коэффициент расходов',unit:''},
  {key:'transfer_in',label:'трансферты региону',unit:' млн ₽'}
 ];
 return items.flatMap(item=>{
  const val=f[item.key];
  return typeof val==='number'&&Number.isFinite(val)&&val!==0
   ? [item.label+' '+number(val)+item.unit] : [];
 });
}
