/** Synthetic option premium-unit regressions; no real transactions or financial source fixtures. */
import {describe,it,expect} from 'vitest';
import {emptyLedger,replay,summarize} from '../lib/ledger/engine';
import {decisionRows,performanceSeries} from '../lib/ledger/analytics';
import {calculateOwnerUnits,calculatePortfolioValue} from '../lib/core/pool';
import {computeHoldings} from '../lib/core/holdings';
import {previewCsv} from '../lib/ledger/import';
import {entryInput} from '../lib/ledger/validation';
import type {Entry,Ledger,Quote} from '../lib/ledger/types';
const symbol='TEST260109C00025000';
const terms={instrumentType:'OPTION' as const,optionMultiplier:100,optionTerms:'standard' as const,optionTermsSource:'Synthetic verified broker contract specification.'};
const event=(id:string,type:Entry['type'],grossAmount:number,extra:Partial<Entry>={}):Entry=>({id,type,grossAmount,tradeDate:'2026-01-01',allocations:[],...extra});
const ledger=(entries:Entry[]):Ledger=>({...emptyLedger(),partners:[{id:'a',name:'A'},{id:'b',name:'B'}],entries});
const deposit=event('d','DEPOSIT',100,{partnerId:'a'});
const buy=event('b','BUY',10.04,{symbol,quantity:1,tradeDate:'2026-01-02',...terms});
const quote=(price:number):Quote=>({symbol,price,status:'fresh',marketTime:null,fetchedAt:null});
describe('verified option premium conversion',()=>{
 it('values one standard contract at 100 times premium and keeps actual cash amounts unchanged',()=>{
  const saved=replay(ledger([deposit,buy]));const s=summarize(saved,{[symbol]:quote(.10)});
  expect(s.holdings[0].quantity).toBe(1);expect(s.holdings[0].value).toBe(10);expect(s.holdings[0].costBasis).toBe(10.04);expect(s.totalValue).toBeCloseTo(99.96);expect(s.cash).toBeCloseTo(89.96);
  expect(calculatePortfolioValue(saved.entries,{[symbol]:.10})).toBeCloseTo(99.96);
  expect(computeHoldings(saved.entries,{[symbol]:.10},['a','b']).find(h=>h.assetId===symbol)?.marketValue).toBe(10);
 });
 it('issues 100 new units for a 99.96 deposit at a 99.96 pre-flow NAV',()=>{
  const saved=replay(ledger([deposit,buy,event('d2','DEPOSIT',99.96,{partnerId:'b',tradeDate:'2026-01-03',valuationPrices:{[symbol]:.10}})]));
  expect(calculateOwnerUnits(saved.entries).a).toBe(100);expect(calculateOwnerUnits(saved.entries).b).toBeCloseTo(100,12);expect(summarize(saved,{[symbol]:quote(.10)}).partners[0].value).toBeCloseTo(99.96,12);
 });
 it('retains correct owner shares after the option is later closed',()=>{
  const saved=replay(ledger([deposit,buy,event('d2','DEPOSIT',99.96,{partnerId:'b',tradeDate:'2026-01-03',valuationPrices:{[symbol]:.10}}),event('s','SELL',12,{symbol,quantity:1,tradeDate:'2026-01-04',instrumentType:'OPTION'})]));expect(calculateOwnerUnits(saved.entries).a).toBe(100);expect(calculateOwnerUnits(saved.entries).b).toBeCloseTo(100,12);expect(summarize(saved,{}).partners[0].share).toBe(.5);
 });
 it('applies a verified adjusted premium multiplier once, without assuming an underlying deliverable',()=>{
  const adjusted={...buy,symbol:'TEST1260109C00025000',optionTerms:'adjusted' as const,optionMultiplier:25,optionTermsSource:'Synthetic adjusted contract premium multiplier specification.'};const saved=replay(ledger([deposit,adjusted]));expect(summarize(saved,{[adjusted.symbol]:{...quote(.2),symbol:adjusted.symbol}}).holdings[0].value).toBe(5);
 });
 it('withholds active values and blocks new NAV pricing when a multiplier is unknown',()=>{
  const unknown={...buy,optionMultiplier:undefined,optionTerms:undefined,optionTermsSource:undefined};const l=replay(ledger([deposit,unknown]));const s=summarize(l,{[symbol]:quote(.1)});expect(s.totalValue).toBeNull();expect(s.holdings[0].valuationMessage).toContain('Verify option');
  expect(()=>replay(ledger([deposit,unknown,event('d2','DEPOSIT',100,{partnerId:'b',tradeDate:'2026-01-03',valuationPrices:{[symbol]:.1}})]))).toThrow('Verify the premium multiplier');
  expect(()=>calculatePortfolioValue(l.entries,{[symbol]:.1})).toThrow('Unknown option');
 });
 it('allows an explicit verified total NAV override without guessing unknown option units',()=>{
  const l=replay(ledger([deposit,{...buy,optionMultiplier:undefined,optionTerms:undefined,optionTermsSource:undefined},event('d2','DEPOSIT',99.96,{partnerId:'b',tradeDate:'2026-01-03',navBeforeOverride:99.96})]));expect(calculateOwnerUnits(l.entries).b).toBe(100);
 });
 it('uses multipliers in active FIFO decision values and performance-series NAV',()=>{
  const saved=replay(ledger([deposit,buy]));const histories={SPY:[{day:'2026-01-01',close:100,rawClose:100},{day:'2026-01-02',close:100,rawClose:100}],[symbol]:[{day:'2026-01-02',close:.1,rawClose:.1}]};
  const decisions=decisionRows(saved,{[symbol]:quote(.1),SPY:{...quote(100),symbol:'SPY'}},histories);expect(decisions[0].value).toBe(10);expect(decisions[0].actualReturn).toBeCloseTo(10/10.04-1);
  const series=performanceSeries(saved,histories);expect(series.find(p=>p.day==='2026-01-02')?.portfolio).toBeCloseTo(-.04);
 });
 it('does not grade an active option with unknown terms, while closed realized cash stays usable',()=>{
  const unknown={...buy,optionMultiplier:undefined,optionTerms:undefined,optionTermsSource:undefined};const l=replay(ledger([deposit,unknown]));expect(decisionRows(l,{[symbol]:quote(.1)},{} )[0].value).toBeNull();
  const closed=replay({...l,entries:[...l.entries,event('s','SELL',12,{symbol,quantity:1,tradeDate:'2026-01-03',instrumentType:'OPTION'})]});expect(summarize(closed,{}).totalValue).toBeCloseTo(101.96);expect(decisionRows(closed,{},{} )[0].value).toBe(12);
 });
 it('rejects conflicting terms, incomplete evidence and unsupported standard multipliers',()=>{
  expect(()=>entryInput.parse({...buy,optionMultiplier:10})).toThrow('100');expect(()=>entryInput.parse({...buy,optionTermsSource:undefined})).toThrow('verification source');
  expect(()=>replay(ledger([deposit,buy,event('s','SELL',12,{symbol,quantity:1,tradeDate:'2026-01-03',...terms,optionTerms:'adjusted',optionMultiplier:10})]))).toThrow('Conflicting verified');
 });
});
describe('single-day broker chronology and verification',()=>{
 const header='Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount';
 it('reverses a newest-first one-day buy then deposit and shows the assumption',async()=>{
  const input=header+'\n1/2/2026,1/2/2026,,TEST,Synthetic,Buy,1,$10,($10)\n1/2/2026,1/2/2026,,,,ACH,,,$100';const rows=await previewCsv(input,'a',ledger([]));expect(rows.map(r=>r.entry?.type)).toEqual(['DEPOSIT','BUY']);expect(rows[0].warning).toContain('Single-day');expect(rows.map(r=>r.row)).toEqual([3,2]);expect(()=>replay(ledger(rows.map(r=>r.entry!)))).not.toThrow();
 });
 it('lets the operator preserve explicitly oldest-first single-day source ordering',async()=>{
  const input=header+'\n1/2/2026,1/2/2026,,,,ACH,,,$100\n1/2/2026,1/2/2026,,TEST,Synthetic,Buy,1,$10,($10)';const rows=await previewCsv(input,'a',ledger([]),{},'oldest-first');expect(rows.map(r=>r.row)).toEqual([2,3]);expect(()=>replay(ledger(rows.map(r=>r.entry!)))).not.toThrow();
 });
 it('does not infer a multiplier from a standard-looking option root or premium/cash ratio',async()=>{
  const input=header+'\n1/2/2026,1/2/2026,,TEST,TEST 1/9/2026 Call $25.00,BTO,1,$0.10,($10.04)';const [row]=await previewCsv(input,'a',ledger([]));expect(row.entry?.optionMultiplier).toBeUndefined();expect(row.warning).toContain('must be verified');
 });
 it('accepts verified adjusted contract columns with a traceable source',async()=>{
  const input=header+',Contract Multiplier,Option Terms,Multiplier Source\n1/2/2026,1/2/2026,,TEST1,TEST1 1/9/2026 Call $25.00,BTO,1,$0.10,($2.54),25,adjusted,Synthetic broker terms';const [row]=await previewCsv(input,'a',ledger([]));expect(row.error).toBeUndefined();expect(row.entry?.optionMultiplier).toBe(25);expect(row.entry?.optionTerms).toBe('adjusted');
 });
});
