/** Authenticated on-open/manual quote refresh and explicit historical analytics refresh. No unattended job. */
import { calculateAssetQuantities } from '../../../lib/core/pool';
import { protect } from '../../../lib/server/http';
import { readLedger } from '../../../lib/server/store';
import { latestQuote,history,cachedHistory,parallelMap } from '../../../lib/server/market';
/** Refresh public market quotes for this ledger's symbols while keeping missing/stale data explicit. */
export async function GET(request:Request){return protect(request,async user=>{
  const {ledger}=await readLedger(user.userId);const url=new URL(request.url);
  const symbols=[...new Set(ledger.entries.flatMap(e=>[e.symbol,e.targetSymbol]).filter((s):s is string=>!!s))];
  if(!ledger.entries.length)return Response.json({quotes:{},history:{},refreshedAt:new Date().toISOString()});
  const active=Object.entries(calculateAssetQuantities(ledger.entries)).filter(([,q])=>Math.abs(q)>1e-8).map(([s])=>s);
  const all=[...new Set([...symbols,'SPY','QQQ'])];
  const quotes=await parallelMap([...new Set([...active,'SPY','QQQ'])],async s=>[s,await latestQuote(s)] as const);
  const start=ledger.entries[0].tradeDate;
  const histories=await parallelMap(all,async s=>[s,url.searchParams.get('history')==='1'?await history(s,start):await cachedHistory(s)] as const);
  return Response.json({quotes:Object.fromEntries(quotes),history:Object.fromEntries(histories),refreshedAt:new Date().toISOString()});
});}
