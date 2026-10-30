/** Worker-compatible public Yahoo data with D1 caching, explicit freshness and incremental daily history. */
import YahooFinance from 'yahoo-finance2';
import { database } from './store';
import { priorClose, rawHistoricalClose, yahooSymbol } from '../ledger/market';
import type { HistoricalPoint, Quote } from '../ledger/types';
const yahoo = new YahooFinance({suppressNotices:['yahooSurvey']});
const TTL=5*60*1000;
interface CacheRow { symbol:string; day:string; close:number; raw_close:number; market_time:string; fetched_at:string }
interface SyncRow { start:string; end:string; fetched_at:string; splits:string }
/** Read cached daily series in date order. Cache holds public market data, never ledger transactions. */
export async function cachedHistory(symbol:string):Promise<HistoricalPoint[]> {
  const rows=await database().prepare("SELECT day,close,raw_close FROM market_cache WHERE symbol=? AND day<>'quote' ORDER BY day ASC").bind(symbol).all<{day:string;close:number;raw_close:number}>();
  return rows.results.map(p=>({day:p.day,close:p.close,rawClose:p.raw_close}));
}
/** Fetch current quote; disclose stale fallback rather than silently representing it as live. */
export async function latestQuote(symbol:string,force=false):Promise<Quote> {
  const db=database();const cached=await db.prepare("SELECT * FROM market_cache WHERE symbol=? AND day='quote'").bind(symbol).first<CacheRow>();
  const now=Date.now();
  if(cached && now-Date.parse(cached.fetched_at)<TTL)return {symbol,price:cached.close,status:now-Date.parse(cached.market_time)>7*86400000?'stale':'cached',marketTime:cached.market_time,fetchedAt:cached.fetched_at};
  // A failed refresh cools down for a minute too; repeated clicks must not hammer the upstream provider.
  const failure=await db.prepare('SELECT fetched_at FROM market_sync WHERE symbol=?').bind(`quote-error:${symbol}`).first<{fetched_at:string}>();
  if(!force && failure && now-Date.parse(failure.fetched_at)<60000)return stale(cached,symbol);
  try {
    const result=await yahoo.chart(yahooSymbol(symbol),{period1:new Date(now-7*86400000),interval:'1d'},{fetchOptions:{signal:AbortSignal.timeout(12000)}});
    const price=result.meta.regularMarketPrice;const time=result.meta.regularMarketTime;
    if(result.meta.currency!=='USD')throw new Error('Only USD-priced instruments are currently supported.');
    if(!Number.isFinite(price)||price<=0||!time)throw new Error('No valid price.');
    const fetchedAt=new Date().toISOString();const marketTime=new Date(time).toISOString();
    await db.prepare("INSERT INTO market_cache (symbol,day,close,raw_close,market_time,fetched_at) VALUES (?,'quote',?,?,?,?) ON CONFLICT(symbol,day) DO UPDATE SET close=excluded.close,raw_close=excluded.raw_close,market_time=excluded.market_time,fetched_at=excluded.fetched_at").bind(symbol,price,price,marketTime,fetchedAt).run();
    return {symbol,price,status:now-Date.parse(marketTime)>7*86400000?'stale':'fresh',marketTime,fetchedAt};
  } catch {
    const at=new Date().toISOString();
    await db.prepare("INSERT INTO market_sync (symbol,start,end,fetched_at,splits) VALUES (?,'','',?,'[]') ON CONFLICT(symbol) DO UPDATE SET fetched_at=excluded.fetched_at").bind(`quote-error:${symbol}`,at).run();
    return stale(cached,symbol);
  }
}
/** Build an explicit unavailable/stale result, including original fetch and market timestamps. */
function stale(cached:CacheRow|null,symbol:string):Quote {
  return {symbol,price:cached?.close??null,status:cached?'stale':'unavailable',marketTime:cached?.market_time??null,fetchedAt:cached?.fetched_at??null,message:'Yahoo quote refresh failed or this symbol/currency is unsupported. Cached prices may be out of date.'};
}
/** Incrementally extend history; retry a bounded overlap and refetch the series when split events change. */
export async function history(symbol:string,start:string):Promise<HistoricalPoint[]> {
  const db=database();const today=new Date().toISOString().slice(0,10);
  const sync=await db.prepare('SELECT start,end,fetched_at,splits FROM market_sync WHERE symbol=?').bind(symbol).first<SyncRow>();
  if(sync && sync.start<=start && Date.now()-Date.parse(sync.fetched_at)<6*3600000)return cachedHistory(symbol);
  let from=sync && sync.start<=start?new Date(Date.parse(sync.end)-7*86400000).toISOString().slice(0,10):new Date(Date.parse(start)-7*86400000).toISOString().slice(0,10);
  try {
    let result=await yahoo.chart(yahooSymbol(symbol),{period1:from,period2:new Date(Date.now()+86400000),interval:'1d',events:'split'},{fetchOptions:{signal:AbortSignal.timeout(15000)}});
    if(result.meta.currency!=='USD')return cachedHistory(symbol);
    const oldSplits: {day:string;ratio:number}[]=sync?JSON.parse(sync.splits):[];
    let newSplits=(result.events?.splits??[]).map(s=>({day:new Date(s.date).toISOString().slice(0,10),ratio:s.numerator/s.denominator}));
    if(sync && newSplits.some(s=>!oldSplits.some(o=>o.day===s.day && o.ratio===s.ratio))) {
      from=new Date(Date.parse(start<sync.start?start:sync.start)-7*86400000).toISOString().slice(0,10);
      result=await yahoo.chart(yahooSymbol(symbol),{period1:from,period2:new Date(Date.now()+86400000),interval:'1d',events:'split'},{fetchOptions:{signal:AbortSignal.timeout(15000)}});
      newSplits=(result.events?.splits??[]).map(s=>({day:new Date(s.date).toISOString().slice(0,10),ratio:s.numerator/s.denominator}));
    }
    const splits=[...oldSplits.filter(o=>!newSplits.some(n=>n.day===o.day)),...newSplits].filter(s=>Number.isFinite(s.ratio)&&s.ratio>0);
    const at=new Date().toISOString();
    const statements=result.quotes.filter(p=>p.close!=null&&p.close>0).map(p=>{
      const day=new Date(p.date).toISOString().slice(0,10);const close=p.close!;
      return db.prepare('INSERT INTO market_cache (symbol,day,close,raw_close,market_time,fetched_at) VALUES (?,?,?,?,?,?) ON CONFLICT(symbol,day) DO UPDATE SET close=excluded.close,raw_close=excluded.raw_close,market_time=excluded.market_time,fetched_at=excluded.fetched_at').bind(symbol,day,close,rawHistoricalClose(close,day,splits),new Date(p.date).toISOString(),at);
    });
    // Bound individual D1 batches. These cache writes do not mutate ledger ownership or transactions.
    for(let i=0;i<statements.length;i+=80)await db.batch(statements.slice(i,i+80));
    if(statements.length)await db.prepare('INSERT INTO market_sync (symbol,start,end,fetched_at,splits) VALUES (?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET start=excluded.start,end=excluded.end,fetched_at=excluded.fetched_at,splits=excluded.splits').bind(symbol,sync&&sync.start<start?sync.start:start,today,at,JSON.stringify(splits)).run();
  } catch { /* Missing history remains missing. Accounting never substitutes a fabricated price. */ }
  return cachedHistory(symbol);
}
/** Limit upstream concurrency while preserving stable result order. */
export async function parallelMap<T,R>(items:T[],fn:(item:T)=>Promise<R>):Promise<R[]> {
  const result:R[]=new Array(items.length);let index=0;
  await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(index<items.length){const i=index++;result[i]=await fn(items[i]);}}));
  return result;
}
/** Price an event from the last available session on or before its date, never the next session. */
export async function eventPrice(symbol:string,day:string):Promise<number|null> {return priorClose(await history(symbol,day),day);}
