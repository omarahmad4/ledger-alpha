/** Pure stable tri-state table sorting shared by the hosted workspace and legacy UI. No ledger mutations or UI dependencies. */
export type SortOrder='asc'|'desc';
export type SortKind='auto'|'number'|'date'|'text';
export type SortValue=string|number|boolean|Date|null|undefined;
export interface SortConfig<K extends string=string>{key:K;order:SortOrder}
export interface SortColumn<T,K extends string=string>{key:K;kind?:SortKind;value:(row:T)=>SortValue}
const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
/** Advance one column through ascending, descending and off; another column starts ascending.
 * @param current Active sort or null. @param key Requested column identifier. @returns Next sort state. */
export function nextSort<K extends string>(current:SortConfig<K>|null,key:K):SortConfig<K>|null{
 return current?.key===key?(current.order==='asc'?{key,order:'desc'}:null):{key,order:'asc'};
}
/** Normalize typed values once; empty/invalid/non-finite values stay missing rather than becoming zero.
 * @param value Raw accessor value. @param kind Declared column type. @returns Comparable scalar or null. */
export function sortValue(value:SortValue,kind:SortKind='auto'):string|number|null{
 if(value==null||(typeof value==='string'&&!value.trim())||(typeof value==='number'&&!Number.isFinite(value)))return null;
 if(kind==='date'||value instanceof Date){
  const time=value instanceof Date?value.getTime():typeof value==='number'?value:Date.parse(String(value));
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)){
   const day=value.slice(0,10),calendarTime=Date.parse(day+'T00:00:00Z');
   if(!Number.isFinite(calendarTime)||new Date(calendarTime).toISOString().slice(0,10)!==day)return null;
  }
  return Number.isFinite(time)?time:null;
 }
 if(kind==='number'){const number=typeof value==='number'?value:typeof value==='string'?Number(value):NaN;return Number.isFinite(number)?number:null;}
 if(kind==='auto'){
  if(typeof value==='number')return value;
  if(typeof value==='boolean')return Number(value);
  if(typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())){const number=Number(value);return Number.isFinite(number)?number:null;}
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value))return sortValue(value,'date');
 }
 return String(value);
}
/** Return a sorted copy with missing values last in either direction and stable input-order ties.
 * @param rows Canonical display rows, never reordered in place. @param config Active column/order or null.
 * @param columns Typed accessors; formatted currency/labels are not compared as numbers. @returns Stable copied view. */
export function sortRows<T,K extends string>(rows:readonly T[],config:SortConfig<K>|null,columns:readonly SortColumn<T,K>[]):T[]{
 const column=config&&columns.find(c=>c.key===config.key);if(!config||!column)return [...rows];
 return rows.map((row,index)=>({row,index,value:sortValue(column.value(row),column.kind)})).sort((a,b)=>{
  if(a.value==null||b.value==null)return a.value==null?(b.value==null?a.index-b.index:1):-1;
  const compared=typeof a.value==='number'&&typeof b.value==='number'?a.value-b.value:collator.compare(String(a.value),String(b.value));
  return compared===0?a.index-b.index:compared*(config.order==='asc'?1:-1);
 }).map(item=>item.row);
}
