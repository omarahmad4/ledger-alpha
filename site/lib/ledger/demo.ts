/** Synthetic read-only demonstration. Never written into a personal ledger or used as a live quote. */
import { replay } from './engine';
import type { Ledger,Quote,HistoricalPoint } from './types';
export const demoLedger:Ledger=replay({version:1,partners:[{id:'a',name:'Alex'},{id:'b',name:'Sam'}],receipts:[],entries:[
  {id:'d1',type:'DEPOSIT',tradeDate:'2026-09-01',partnerId:'a',grossAmount:12000,allocations:[]},
  {id:'b1',type:'BUY',tradeDate:'2026-09-02',symbol:'SPY',quantity:10,price:600,grossAmount:6000,fee:1,allocations:[]},
  {id:'b2',type:'BUY',tradeDate:'2026-09-03',symbol:'AAPL',quantity:15,price:200,grossAmount:3000,allocations:[]},
  {id:'d2',type:'DEPOSIT',tradeDate:'2026-10-01',partnerId:'b',grossAmount:6000,valuationPrices:{SPY:612,AAPL:210},allocations:[]},
  {id:'v1',type:'DIVIDEND',tradeDate:'2026-10-10',symbol:'SPY',grossAmount:35,allocations:[]},
]});
export const demoQuotes:Record<string,Quote>=Object.fromEntries([['SPY',630],['AAPL',220],['QQQ',540]].map(([symbol,price])=>[symbol,{symbol,price,status:'cached',marketTime:'2026-10-28T20:00:00Z',fetchedAt:'2026-10-28T20:05:00Z'}])) as Record<string,Quote>;
export const demoHistory:Record<string,HistoricalPoint[]>=Object.fromEntries([['SPY',600,612,630],['AAPL',200,210,220],['QQQ',500,520,540]].map(([symbol,a,b,c])=>[symbol,[['2026-09-01',a],['2026-09-02',a],['2026-09-03',a],['2026-09-30',b],['2026-10-01',b],['2026-10-10',b],['2026-10-28',c]].map(([day,price])=>({day,close:price,rawClose:price}))])) as Record<string,HistoricalPoint[]>;
