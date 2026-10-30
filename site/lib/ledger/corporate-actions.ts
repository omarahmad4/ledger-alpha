/** Derived split maintenance shared by manual saves, imports and restores; explicit operator records are never discarded. */
import { chronological } from './engine';
import type { Entry } from './types';
export const knownHistoricalSplits=[['NVDA','2021-07-20',4],['NVDA','2024-06-10',10],['GOOG','2022-07-18',20],['GOOGL','2022-07-18',20],['AMZN','2022-06-06',20],['TSLA','2020-08-31',5],['TSLA','2022-08-25',3],['AAPL','2020-08-31',4]] as const;
export interface DerivedSplitChanges { added:number;removed:number }
/** Recognize explicitly marked derivations and version-3 generated IDs without mistaking edited manual events for inferred ones. */
export function isInferredSplit(entry:Entry):boolean {
  return entry.type==='SPLIT'&&(entry.splitOrigin==='inferred'||(!entry.splitOrigin&&entry.id===`split:${entry.symbol}:${entry.tradeDate}`));
}
/** Re-evaluate inferred events against their pre-event position; restoration can prune without inventing missing events. */
export function reconcileDerivedSplits(entries:Entry[],inferMissing=false):Entry[] {
  if(!entries.length)return [];
  const ordered=chronological(entries);const min=ordered[0].tradeDate;const max=ordered.at(-1)!.tradeDate;
  const keys=new Set(entries.filter(e=>e.type==='SPLIT').map(e=>`${e.symbol}:${e.tradeDate}`));
  const candidates:Entry[]=inferMissing?knownHistoricalSplits.filter(([symbol,day])=>day>=min&&day<=max&&!keys.has(`${symbol}:${day}`)).map(([symbol,day,ratio])=>({id:`split:${symbol}:${day}`,externalId:`split:${symbol}:${day}`,tradeDate:day,symbol,type:'SPLIT',quantity:ratio,grossAmount:0,fee:0,splitMode:'ratio',splitOrigin:'inferred',notes:'Known historical split; ratio supplied automatically.',allocations:[]})):[];
  const quantities=new Map<string,number>();const result:Entry[]=[];
  for(const entry of chronological([...entries,...candidates])) {
    if(entry.symbol) {
      const prior=quantities.get(entry.symbol)??0;
      if(entry.type==='SPLIT') {
        if(isInferredSplit(entry)&&prior<=1e-8)continue;
        // Invalid explicit events stay present so the normal replay rejects the whole correction.
        if(prior>0)quantities.set(entry.symbol,entry.splitMode==='additional'?prior+(entry.quantity??0):prior*(entry.quantity??1));
      } else if((entry.type==='BUY'||entry.type==='REWARD'))quantities.set(entry.symbol,prior+(entry.quantity??0));
      else if(entry.type==='SELL'||entry.type==='EXPIRY')quantities.set(entry.symbol,prior-(entry.quantity??0));
    }
    if(entry.type==='CONVERSION'){
      const prior=quantities.get(entry.symbol!)??0;const consumed=Math.abs(prior-entry.quantity!)<=(entry.quantityRounding??0)+1e-9?prior:entry.quantity!;
      quantities.set(entry.symbol!,prior-consumed);quantities.set(entry.targetSymbol!,(quantities.get(entry.targetSymbol!)??0)+entry.targetQuantity!);
    }
    result.push(entry);
  }
  return result;
}
/** Report actual additions/removals for the operator; promoting an inferred record to manual does not count as deletion. */
export function derivedSplitChanges(before:Entry[],after:Entry[]):DerivedSplitChanges {
  const beforeIds=new Set(before.map(e=>e.id));const afterIds=new Set(after.map(e=>e.id));
  return {added:after.filter(e=>isInferredSplit(e)&&!beforeIds.has(e.id)).length,removed:before.filter(e=>isInferredSplit(e)&&!afterIds.has(e.id)).length};
}
