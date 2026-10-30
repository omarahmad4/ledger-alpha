/** Pure price normalization and prior-session lookup rules shared by server and regression tests. */
import type { HistoricalPoint } from './types';
/** Normalize standard crypto and dotted US equity symbols for Yahoo Finance. */
export function yahooSymbol(symbol:string):string {
  const upper=symbol.trim().toUpperCase();
  return ['BTC','ETH','SOL','DOGE','ADA','XRP','AVAX','LTC','BCH','LINK','DOT','USDC'].includes(upper)?`${upper}-USD`:upper.replaceAll('.','-');
}
/** Choose the most recent close on or before the requested date, with a seven-day freshness limit. */
export function priorClose(points:HistoricalPoint[],day:string,raw=true):number|null {
  const point=[...points].reverse().find(p=>p.day<=day);
  if(!point || Date.parse(day)-Date.parse(point.day)>7*86400000)return null;
  const price=raw?point.rawClose:point.close;
  return Number.isFinite(price)&&price>0?price:null;
}
/** Undo future split adjustment when reconstructing actual per-share prices on an event date. */
export function rawHistoricalClose(close:number,day:string,splits:{day:string;ratio:number}[]):number {
  return splits.filter(s=>s.day>day).reduce((p,s)=>p*s.ratio,close);
}
