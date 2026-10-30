/** Synthetic exports reproduce broker formatting only; never place real financial source rows here. */
import { describe,it,expect } from 'vitest';
import Papa from 'papaparse';
import { previewCsv,reconcileImportedEntries } from '../lib/ledger/import';
import { emptyLedger,replay,summarize } from '../lib/ledger/engine';
import { buildFifoLots } from '../lib/core/lots';
import { computePoolHoldings } from '../lib/core/holdings';
import { calculateAssetQuantities,calculateNetCash } from '../lib/core/pool';
import { entryInput } from '../lib/ledger/validation';
import type { Entry } from '../lib/ledger/types';
const header=['Activity Date','Process Date','Settle Date','Instrument','Description','Trans Code','Quantity','Price','Amount'];
const csv=(rows:string[][])=>Papa.unparse([header,...rows]);
const row=(code:string,extra:Partial<{day:string;process:string;symbol:string;description:string;quantity:string;price:string;amount:string}>={})=>[extra.day??'1/2/2026',extra.process??extra.day??'1/2/2026','',extra.symbol??'',extra.description??'',code,extra.quantity??'',extra.price??'',extra.amount??''];
const ledger=()=>({...emptyLedger(),partners:[{id:'a',name:'A'},{id:'b',name:'B'}]});
const tx=(id:string,type:Entry['type'],grossAmount:number,extra:Partial<Entry>={}):Entry=>({id,type,grossAmount,tradeDate:'2026-01-02',allocations:[],...extra});
const deposit=()=>tx('d','DEPOSIT',1000,{partnerId:'a',tradeDate:'2026-01-01'});
const footer=[...Array(9).fill(''),'The data provided is for informational purposes only. Please consult a professional tax service. Reminder: This data does not include Robinhood Crypto or Robinhood Spending activity.'];
describe('broker records and financial safety',()=>{
 it('recognizes the extra-field footer and preserves quoted multiline descriptions',async()=>{
  const rows=await previewCsv('\uFEFF'+csv([row('ACH',{amount:'$1,000.00',description:'Deposit\nreference, synthetic'}),[''],footer]),'a',ledger());
  expect(rows.filter(r=>r.entry)).toHaveLength(1);expect(rows.filter(r=>r.error)).toHaveLength(0);expect(rows.filter(r=>r.ignored)).toHaveLength(2);expect(rows[0].source?.description).toContain('\n');expect(rows.at(-1)?.ignored).toContain('Crypto');
 });
 it('never tolerates an extra field on a financial row or a footer-looking transaction',async()=>{
  const rows=await previewCsv(csv([[...row('ACH',{amount:'10'}),'extra'],[...row('ACH',{amount:'20',description:footer[9]}),'extra']]),'a',ledger());expect(rows.every(r=>r.error&&!r.entry)).toBe(true);
 });
 it('rejects missing/duplicate headers and malformed quoting',async()=>{
  await expect(previewCsv('Date,Date,Type\n2026-01-01,2026-01-01,ACH','a',ledger())).rejects.toThrow('unique');
  const rows=await previewCsv(csv([row('ACH',{amount:'100'})])+'\n"unterminated','a',ledger());expect(rows.some(r=>r.error)).toBe(true);
 });
 it('uses Activity Date and validates numeric fields without coercing invalid text to zero',async()=>{
  const rows=await previewCsv(csv([row('ACH',{day:'1/2/2026',process:'1/5/2026',amount:'100'}),row('Buy',{symbol:'TEST',quantity:'1',price:'unknown',amount:'($10)'})]),'a',ledger());expect(rows[0].entry?.tradeDate).toBe('2026-01-02');expect(rows[1].error).toContain('price');
 });
 it('requires an explicit owner for every cash flow and keeps attribution out of source identity',async()=>{
  const input=csv([row('ACH',{amount:'100'}),row('ACH',{amount:'100'})]);
  const missing=await previewCsv(input,'',ledger());expect(missing.every(r=>r.error?.includes('Assign'))).toBe(true);
  const mapped=await previewCsv(input,'',ledger(),{'2':'a','3':'b'});expect(mapped.slice().sort((a,b)=>a.row-b.row).map(r=>r.entry?.partnerId)).toEqual(['a','b']);expect(mapped[0].entry?.id).not.toBe(mapped[1].entry?.id);
  const saved={...ledger(),entries:mapped.map(r=>r.entry!)};
  const again=await previewCsv(input,'b',saved);expect(again.every(r=>r.duplicate)).toBe(true);
 });
 it('retains unsupported events and identifies broker credits as income rather than external capital',async()=>{
  const rows=await previewCsv(csv([row('GMPC',{amount:'$0.25'}),row('CONV',{amount:'$0.50'}),row('TRANSFER',{amount:'$10'})]),'a',ledger());expect(rows.filter(r=>r.entry).map(r=>r.entry?.type)).toEqual(['DIVIDEND','DIVIDEND']);expect(rows.find(r=>r.source?.code==='TRANSFER')?.error).toContain('Unsupported');
 });
 it('reverses newest-first broker records while preserving oldest-first same-day activity',async()=>{
  const rows=await previewCsv(csv([row('Sell',{day:'1/3/2026',symbol:'TEST',quantity:'1',amount:'$11'}),row('Buy',{symbol:'TEST',quantity:'1',amount:'($10)'}),row('ACH',{amount:'100'})]),'a',ledger());expect(rows.map(r=>r.entry?.type)).toEqual(['DEPOSIT','BUY','SELL']);
 });
});
describe('option contracts and paired corporate actions',()=>{
 it('records option buys/sales/expirations separately from underlying shares with exact net cash',async()=>{
  const input=csv([row('BTO',{symbol:'TEST',description:'TEST 1/9/2026 Call $25.00',quantity:'1',price:'$0.10',amount:'($10.04)'}),row('OEXP',{day:'1/9/2026',symbol:'TEST',description:'Option Expiration for TEST 1/9/2026 Call $25.00',quantity:'1S'})]);
  const rows=await previewCsv(input,'a',ledger());expect(rows.every(r=>!r.error)).toBe(true);const entries=[deposit(),...rows.map(r=>r.entry!)];const saved=replay({...ledger(),entries});
  expect(calculateNetCash(saved.entries)).toBeCloseTo(989.96);expect(calculateAssetQuantities(saved.entries).TEST).toBeUndefined();expect(Object.values(calculateAssetQuantities(saved.entries))).toEqual([0]);const lot=buildFifoLots(saved.entries)[0];expect(lot.realizedGainLoss).toBeCloseTo(-10.04);expect(lot.costBasis).toBe(0);
 });
 it('rejects malformed contracts, expiration cash and oversold option positions',async()=>{
  const invalid=await previewCsv(csv([row('BTO',{symbol:'TEST',description:'not a contract',quantity:'1',amount:'($10)'}),row('OEXP',{symbol:'TEST',description:'Option Expiration for TEST 1/9/2026 Call $25.00',quantity:'1S',amount:'5'})]),'a',ledger());expect(invalid.every(r=>r.error)).toBe(true);
  const sale=await previewCsv(csv([row('STC',{symbol:'TEST',description:'TEST 1/9/2026 Call $25.00',quantity:'1',amount:'$5'})]),'a',ledger());expect(()=>replay({...ledger(),entries:[deposit(),sale[0].entry!]})).toThrow('Sale exceeds');
 });
 it('carries merger cost basis into the received asset without cash/profit or live rounding residue',async()=>{
  const input=csv([row('MRGS',{symbol:'OLD',quantity:'4.1234S'}),row('MRGS',{symbol:'NEW',quantity:'3'})]);
  const rows=await previewCsv(input,'a',ledger());expect(rows.filter(r=>r.entry)).toHaveLength(1);expect(rows.filter(r=>r.ignored)).toHaveLength(1);
  const entries=[deposit(),tx('buy','BUY',500,{tradeDate:'2026-01-01',symbol:'OLD',quantity:4.123407}),rows[0].entry!];
  const saved=replay({...ledger(),entries});const quantities=calculateAssetQuantities(saved.entries);expect(quantities.OLD).toBe(0);expect(quantities.NEW).toBe(3);expect(calculateNetCash(saved.entries)).toBe(500);
  const lots=buildFifoLots(saved.entries);expect(lots.filter(l=>l.remainingQuantity>0)[0].costBasis).toBe(500);expect(lots.reduce((s,l)=>s+l.realizedGainLoss,0)).toBe(0);expect(computePoolHoldings(saved.entries)).toEqual([{assetId:'NEW',quantity:3,costBasis:500}]);
  expect(summarize(saved,{}).unavailable).toEqual(['NEW']);
  const repeated=await previewCsv(input,'a',saved);expect(repeated.find(r=>r.entry)?.duplicate).toBe(true);
 });
 it('preserves prior realized sale basis and FIFO continuity after a partial conversion',()=>{
  const l=replay({...ledger(),entries:[deposit(),tx('b','BUY',500,{symbol:'OLD',quantity:10}),tx('s','SELL',200,{symbol:'OLD',quantity:2}),tx('m','CONVERSION',0,{symbol:'OLD',quantity:4,targetSymbol:'NEW',targetQuantity:8}),tx('s2','SELL',300,{symbol:'NEW',quantity:4})]});
  const lots=buildFifoLots(l.entries);expect(lots[0].sales[0].costBasis).toBe(100);expect(lots[0].costBasis).toBe(200);expect(lots[1].costBasis).toBe(100);expect(lots[1].sales[0].costBasis).toBe(100);expect(calculateNetCash(l.entries)).toBe(1000);
 });
 it('rejects incomplete, cash-bearing and ambiguous merger groups without discarding any financial row',async()=>{
  for(const rows of [[row('MRGS',{symbol:'OLD',quantity:'1S'})],[row('MRGS',{symbol:'OLD',quantity:'1S'}),row('MRGS',{symbol:'NEW',quantity:'1',amount:'5'})],[row('MRGS',{symbol:'OLD',quantity:'1S'}),row('MRGS',{symbol:'NEW',quantity:'1'}),row('MRGS',{symbol:'OTHER',quantity:'1'})]]){const result=await previewCsv(csv(rows),'a',ledger());expect(result.some(r=>r.error)).toBe(true);}
 });
 it('rejects oversized conversion rounding and malformed noncash events',()=>{
  expect(()=>entryInput.parse(tx('m','CONVERSION',0,{symbol:'OLD',quantity:1,targetSymbol:'NEW',targetQuantity:1,quantityRounding:1}))).toThrow();expect(()=>entryInput.parse(tx('x','EXPIRY',0,{symbol:'TEST',quantity:1}))).toThrow();
 });
 it('reconciles later splits against quantities received in a merger',()=>{
  const result=reconcileImportedEntries([tx('b','BUY',500,{symbol:'OLD',quantity:2,tradeDate:'2020-01-01'}),tx('m','CONVERSION',0,{symbol:'OLD',quantity:2,targetSymbol:'AAPL',targetQuantity:10,tradeDate:'2020-08-01'}),tx('v','DIVIDEND',1,{tradeDate:'2020-09-01'})],[]);
  const saved=replay({...ledger(),entries:[{...deposit(),tradeDate:'2019-01-01'},...result.entries]});expect(calculateAssetQuantities(saved.entries).AAPL).toBe(40);
 });
});

describe('explicit margin accounting',()=>{
 it('keeps borrowing as a negative cash liability and never issues capital units for it',()=>{
  const entries=[deposit(),tx('buy','BUY',1500,{symbol:'TEST',quantity:10})];
  expect(()=>replay({...ledger(),entries})).toThrow('exceeds recorded cash');
  const saved=replay({...ledger(),entries,cashPolicy:'margin'});const state=summarize(saved,{TEST:{symbol:'TEST',price:150,status:'fresh',marketTime:null,fetchedAt:null}});
  expect(state.cash).toBe(-500);expect(state.totalValue).toBe(1000);expect(state.netDeposits).toBe(1000);expect(state.units).toBe(1000);
 });
 it('does not relax stock quantity checks or allow borrowed cash withdrawals',()=>{
  expect(()=>replay({...ledger(),cashPolicy:'margin',entries:[deposit(),tx('sell','SELL',100,{symbol:'TEST',quantity:1})]})).toThrow('Sale exceeds');
  expect(()=>replay({...ledger(),cashPolicy:'margin',entries:[deposit(),tx('buy','BUY',1500,{symbol:'TEST',quantity:10}),tx('w','WITHDRAWAL',1,{partnerId:'a',navBeforeOverride:1000})]})).toThrow('Withdrawal exceeds');
 });
});
