/** Pure portfolio/per-decision analytics. Missing prices yield gaps and ungraded decisions, never fabricated returns. */
import {valuationMultipliers,priceMultiplier} from '../core/valuation';
import { buildFifoLots } from '../core/lots';
import { calculateAssetQuantities,calculateNetCash,calculateTotalUnits } from '../core/pool';
import { chronological } from './engine';
import { priorClose } from './market';
import type { Ledger,HistoricalPoint,Quote } from './types';
/** Match the original scorecard's excess-return grade boundaries. */
export function grade(alpha:number):string {return alpha>0.05?'A':alpha>=-0.05?'B':alpha>=-0.15?'C':alpha>=-0.25?'D':'F';}
/** Grade FIFO decisions only when all required benchmark and active-position prices are reliable. */
export function decisionRows(ledger:Ledger,quotes:Record<string,Quote>,histories:Record<string,HistoricalPoint[]>,benchmark='SPY') {
  const multipliers=valuationMultipliers(ledger.entries);
  return buildFifoLots(ledger.entries).filter(l=>l.originalCostBasis>0&&!l.corporateAction).map(lot=>{
    const entry=ledger.entries.find(e=>e.id===lot.sourceTransactionId)!;const symbol=entry.symbol!;
    const price=quotes[symbol];const benchmarkQuote=quotes[benchmark];
    const buy=priorClose(histories[benchmark]??[],lot.openedAt,false);
    const active=lot.remainingQuantity>1e-8;
    const multiplier=priceMultiplier(multipliers,symbol);
    const actual=active?(price?.price==null||multiplier==null?null:lot.realizedProceeds+lot.remainingQuantity*price.price*multiplier):lot.realizedProceeds;
    let equivalent:number|null=buy && (!active||(benchmarkQuote?.price!=null&&benchmarkQuote.status!=='stale'))?lot.costBasis/buy*(benchmarkQuote?.price??0):null;
    if(equivalent!=null)for(const sale of lot.sales){const atSale=priorClose(histories[benchmark]??[],sale.sellDate,false);if(atSale==null){equivalent=null;break;}equivalent+=sale.costBasis/buy!*atSale;}
    const reliable=actual!=null&&equivalent!=null&&(!active||price?.status!=='stale');
    const actualReturn=actual==null?null:actual/lot.originalCostBasis-1;
    const benchmarkReturn=equivalent==null?null:equivalent/lot.originalCostBasis-1;
    const alpha=reliable?actualReturn!-benchmarkReturn!:null;
    return {id:lot.id,symbol,date:lot.openedAt,invested:lot.originalCostBasis,value:actual,actualReturn,benchmarkReturn,alpha,grade:alpha==null?null:grade(alpha),active};
  });
}
/** Sample unit-price return at month ends and event dates. Unpriced points stay null for chart gaps. */
export function performanceSeries(ledger:Ledger,histories:Record<string,HistoricalPoint[]>,benchmark='SPY') {
  if(!ledger.entries.length)return [];
  const multipliers=valuationMultipliers(ledger.entries);const txs=chronological(ledger.entries);const today=new Date().toISOString().slice(0,10);
  const dates=new Set(txs.map(e=>e.tradeDate));
  const start=new Date(txs[0].tradeDate+'T00:00:00Z');
  for(let i=0;i<240;i++){const date=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+i+1,0));const day=date.toISOString().slice(0,10);if(day>today)break;dates.add(day);}
  dates.add(today);
  let base:number|null=null;let benchmarkBase:number|null=null;
  return [...dates].sort().map(day=>{
    const prefix=txs.filter(e=>e.tradeDate<=day);const quantities=calculateAssetQuantities(prefix);let nav=calculateNetCash(prefix);let complete=true;
    for(const [symbol,qty]of Object.entries(quantities)){if(Math.abs(qty)<1e-8)continue;const price=priorClose(histories[symbol]??[],day);const multiplier=priceMultiplier(multipliers,symbol);if(price==null||multiplier==null){complete=false;break;}nav+=qty*price*multiplier;}
    const units=calculateTotalUnits(prefix);const navpu=complete&&units>0?nav/units:null;const b=priorClose(histories[benchmark]??[],day,false);
    if(base==null&&navpu!=null&&b!=null){base=navpu;benchmarkBase=b;}
    return {day,portfolio:base&&navpu!=null?(navpu/base-1)*100:null,benchmark:benchmarkBase&&b!=null?(b/benchmarkBase-1)*100:null};
  });
}
