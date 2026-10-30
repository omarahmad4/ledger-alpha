/** Synthetic parity regressions for restored decision semantics, future reinvestment provenance and runtime quality conditions. */
import {describe,it,expect} from 'vitest';
import {decisionRows,grade} from '../lib/ledger/analytics';
import {filterDecisions,decisionSummary,decisionTimeline,gpaLetter,type Decision} from '../lib/ledger/decision-insights';
import {dataQuality} from '../lib/ledger/data-quality';
import {emptyLedger,replay} from '../lib/ledger/engine';
import {previewCsv,fingerprint} from '../lib/ledger/import';
import {entryInput} from '../lib/ledger/validation';
import type {Entry,Ledger,Quote,HistoricalPoint} from '../lib/ledger/types';
/** Build a synthetic read-only outcome; financial calculation tests below use replayed entries. */
function outcome(id:string,extra:Partial<Decision>={}):Decision{return {id,symbol:id,date:'2026-01-01',purchaseGross:100,invested:100,value:110,actualReturn:.1,benchmarkReturn:0,alpha:.1,grade:'A',active:true,notes:undefined,reinvestment:undefined,...extra};}
/** Create a minimal synthetic ledger event. */
function event(id:string,type:Entry['type'],grossAmount:number,extra:Partial<Entry>={}):Entry{return {id,type,grossAmount,tradeDate:'2026-01-01',allocations:[],...extra};}
/** Produce a reliable synthetic quote. */
function quote(symbol:string,price:number,status:Quote['status']='fresh'):Quote{return {symbol,price,status,marketTime:'2026-01-04T20:00:00Z',fetchedAt:'2026-01-04T20:01:00Z'};}
const history:Record<string,HistoricalPoint[]>={SPY:[{day:'2026-01-01',close:100,rawClose:100},{day:'2026-01-03',close:105,rawClose:105}]};
describe('legacy decision summary parity',()=>{
 it('uses original gross weights, not current value or fee-inclusive invested cost',()=>{
  const rows=[outcome('large',{purchaseGross:1000,invested:2000,value:9000}),outcome('small',{purchaseGross:10,invested:10,value:1,alpha:-.4,grade:'F'})];const weighted=decisionSummary(rows,'weighted'),equal=decisionSummary(rows);
  expect(weighted.gpa).toBeCloseTo(4000/1010);expect(weighted.beatRate).toBeCloseTo(1000/1010);expect(weighted.alpha).toBeCloseTo(96/1010);expect(equal.gpa).toBe(2);expect(equal.beatRate).toBe(.5);expect(equal.alpha).toBeCloseTo(-.15);
 });
 it('excludes missing/ungraded inputs instead of assigning zero alpha or F and exposes coverage',()=>{
  const rows=[outcome('ok'),outcome('missing',{alpha:null,grade:null}),outcome('invalid',{alpha:NaN})];const result=decisionSummary(rows,'weighted');expect(result.displayed).toBe(3);expect(result.graded).toBe(1);expect(result.gpa).toBe(4);expect(result.alpha).toBe(.1);
 });
 it('does not count a zero-alpha outcome as beating the benchmark',()=>{expect(decisionSummary([outcome('flat',{alpha:0,grade:'B'})]).beatRate).toBe(0);});
 it('keeps exact grade and aggregate letter boundaries',()=>{
  expect([.050001,.05,-.05,-.050001,-.15,-.150001,-.25,-.250001].map(grade)).toEqual(['A','B','B','C','C','D','D','F']);expect([3.5,2.5,1.5,.5,.499].map(gpaLetter)).toEqual(['A','B','C','D','F']);expect(gpaLetter(null)).toBeNull();
 });
 it('shows unavailable aggregates for empty or zero-weight samples',()=>{expect(decisionSummary([]).gpa).toBeNull();expect(decisionSummary([outcome('zero',{purchaseGross:0})],'weighted').alpha).toBeNull();});
 it('applies original defaults and includes unmarked older rows without guessing reinvestment',()=>{
  const rows=[outcome('open'),outcome('closed',{active:false}),outcome('legacy',{notes:'Dividend Reinvestment'}),outcome('future',{notes:'Original broker description',reinvestment:{source:'broker-description'}}),outcome('unmarked',{notes:'Unclassified older purchase'})];
  expect(filterDecisions(rows).map(r=>r.id)).toEqual(['open','closed','unmarked']);expect(filterDecisions(rows,false,false).map(r=>r.id)).toEqual(['open','legacy','future','unmarked']);
 });
 it('does not let table ordering change summary results',()=>{const rows=[outcome('a'),outcome('b',{alpha:-.2,grade:'D',purchaseGross:20})];expect(decisionSummary([...rows].reverse(),'weighted')).toEqual(decisionSummary(rows,'weighted'));});
});
describe('purchase-date outcomes timeline',()=>{
 it('uses chronological current outcomes and an unweighted trailing window of up to five decisions',()=>{
  const rows=Array.from({length:6},(_,i)=>outcome(String(i),{date:`2026-01-0${i+1}`,alpha:(i+1)/100,purchaseGross:10**i}));const before=JSON.stringify(rows);const points=decisionTimeline([...rows].reverse());expect(points.map(p=>p.alpha)).toEqual([1,2,3,4,5,6]);[1,1.5,2,2.5,3,4].forEach((expected,i)=>expect(points[i].rollingAvg).toBeCloseTo(expected));expect(JSON.stringify(rows)).toBe(before);
 });
 it('retains legacy same-day alpha-descending chronology and does not include unavailable points',()=>{
  const rows=[outcome('low',{alpha:-.1,grade:'C'}),outcome('missing',{alpha:null,grade:null}),outcome('high',{alpha:.2})];expect(decisionTimeline(rows).map(p=>p.id)).toEqual(['high','low']);expect(decisionTimeline(rows)[1].rollingAvg).toBe(5);
 });
 it('includes closed-lot outcomes and uses the same filtered sample as the summaries',()=>{
  const rows=[outcome('closed',{active:false}),outcome('reinvest',{notes:'Dividend Reinvestment'})];expect(decisionTimeline(filterDecisions(rows)).map(p=>p.id)).toEqual(['closed']);expect(decisionTimeline(filterDecisions(rows,false))).toEqual([]);
 });
});
describe('existing pricing and FIFO reliability',()=>{
 const ledger=replay({...emptyLedger(),entries:[event('d','DEPOSIT',1000,{partnerId:'self'}),event('b','BUY',100,{symbol:'TEST',quantity:1,fee:2}),event('s','SELL',120,{symbol:'TEST',quantity:1,tradeDate:'2026-01-03'})]});
 it('grades closed lots from net proceeds and historical benchmark without a latest holding quote',()=>{
  const rows=decisionRows(ledger,{},history);expect(rows[0].active).toBe(false);expect(rows[0].value).toBe(120);expect(rows[0].invested).toBe(102);expect(rows[0].purchaseGross).toBe(100);expect(rows[0].alpha).not.toBeNull();expect(decisionSummary(rows).graded).toBe(1);
 });
 it('excludes missing benchmark sale history rather than fabricate a closed outcome',()=>{const rows=decisionRows(ledger,{},{});expect(rows[0].grade).toBeNull();expect(decisionSummary(rows).graded).toBe(0);expect(decisionTimeline(rows)).toEqual([]);});
 it('withholds stale/missing active prices and retains those rows in coverage',()=>{
  const open=replay({...emptyLedger(),entries:ledger.entries.slice(0,2)});for(const quotes of ([{SPY:quote('SPY',110)},{SPY:quote('SPY',110),TEST:quote('TEST',120,'stale')}] as Record<string,Quote>[])){const rows=decisionRows(open,quotes,history);expect(rows).toHaveLength(1);expect(rows[0].grade).toBeNull();expect(decisionSummary(rows).displayed).toBe(1);}
 });
});
describe('future reinvestment metadata',()=>{
 const csv='Activity Date,Process Date,Trans Code,Instrument,Quantity,Price,Amount,Description\n1/1/2026,1/1/2026,BUY,TEST,1,10,(10),TEST dividend reinvestment';
 it('preserves original broker description plus explicit recognition, without changing stable identity',async()=>{
  const rows=await previewCsv(csv,'self',emptyLedger());const entry=rows[0].entry!;expect(entry.notes).toBe('TEST dividend reinvestment');expect(entry.reinvestment).toEqual({source:'broker-description'});expect(entryInput.parse(entry).reinvestment).toEqual(entry.reinvestment);expect(await fingerprint(entry)).toBe(await fingerprint({...entry,reinvestment:undefined}));const repeated=await previewCsv(csv,'self',{...emptyLedger(),entries:[{...entry,reinvestment:undefined}]});expect(repeated[0].duplicate).toBe(true);
 });
 it('does not invent metadata for unmarked historical descriptions or unrelated activity',async()=>{
  const rows=await previewCsv(csv.replace('TEST dividend reinvestment','Ordinary purchase'),'self',emptyLedger());expect(rows[0].entry!.reinvestment).toBeUndefined();expect(()=>entryInput.parse(event('x','DIVIDEND',1,{reinvestment:{source:'broker-description'}}))).toThrow('only to purchases');
 });
});
describe('runtime quality conditions',()=>{
 it('uses stored cash condition without treating confirmed ownership prose as a new unanswered question',()=>{
  const ledger:Ledger={...emptyLedger(),reconciliation:{estimated:true,openingOwnerId:'self',cashVerified:false,asOf:'2026-01-01',notes:['Confirmed synthetic ownership assignment']}};const result=dataQuality(ledger,{},[]);expect(result.issues.map(i=>i.id)).toEqual(['cash']);expect(JSON.stringify(result.issues)).not.toContain('Confirmed synthetic');expect(result.issues[0].action).toContain('same-date');
 });
 it('derives opening and negative cash dates from records while keeping actual values out of authored conditions',()=>{
  const ledger:Ledger={...emptyLedger(),cashPolicy:'reconstruction',entries:[event('b','BUY',100,{symbol:'TEST',quantity:1}),event('d','DEPOSIT',200,{tradeDate:'2026-01-02',partnerId:'self'})]};const result=dataQuality(ledger,{TEST:quote('TEST',120)},[]);expect(result.issues.find(i=>i.id==='opening')?.title).toContain('2026-01-01');expect(result.issues.find(i=>i.id==='historical-cash')?.impact).toContain('2026-01-01');expect(result.issues.some(i=>i.id==='cash')).toBe(false);
 });
 it('keeps historical price provenance explicit without assuming stored reconstructions are verified',()=>{
  const ledger:Ledger={...emptyLedger(),reconciliation:{estimated:true,openingOwnerId:'self',cashVerified:false,asOf:'2026-01-02',notes:['Synthetic source review']},entries:[event('d','DEPOSIT',100,{partnerId:'self',valuationPrices:{TEST:10}})]};const result=dataQuality(ledger,{},[]);expect(result.issues.find(i=>i.id==='historical-valuations')?.impact).toContain('1 reconstructed cash flows');expect(dataQuality({...ledger,entries:[{...ledger.entries[0],navBeforeOverride:100}]},{},[]).issues.some(i=>i.id==='historical-valuations')).toBe(false);
 });
 it('does not warn about current option units for fully closed unknown contracts',()=>{
  const symbol='TEST260109C00025000';const ledger=replay({...emptyLedger(),entries:[event('d','DEPOSIT',100,{partnerId:'self'}),event('b','BUY',10,{symbol,quantity:1,instrumentType:'OPTION'}),event('x','EXPIRY',0,{symbol,quantity:1,instrumentType:'OPTION',tradeDate:'2026-01-02'})]});const result=dataQuality(ledger,{},[]);expect(result.hasHistoricalOptions).toBe(true);expect(result.issues.some(i=>i.id==='option-terms'||i.id==='missing-price')).toBe(false);
 });
 it('targets unavailable/stale active positions and ungraded decisions with relevant actions',()=>{
  const ledger=replay({...emptyLedger(),entries:[event('d','DEPOSIT',100,{partnerId:'self'}),event('b','BUY',10,{symbol:'TEST',quantity:1})]});expect(dataQuality(ledger,{},[]).issues.find(i=>i.id==='missing-price')?.refresh).toBe(true);const result=dataQuality(ledger,{TEST:quote('TEST',11,'stale')},[outcome('missing',{alpha:null,grade:null})]);expect(result.issues.find(i=>i.id==='stale-price')?.view).toBe('Holdings');expect(result.issues.find(i=>i.id==='ungraded')?.history).toBe(true);
 });
});
