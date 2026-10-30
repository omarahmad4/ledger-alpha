/** Sorting regressions protect numeric/date correctness, accessible tri-state controls and canonical import order. Synthetic rows only. */
import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {nextSort,sortRows,sortValue,type SortColumn} from '../lib/ui/table-sort';
import {SortableHeader} from '../lib/ui/sortable-table';
import {holdingColumns,transactionColumns,decisionColumns,importColumns} from '../lib/ui/workspace-columns';
import {emptyLedger,replay,summarize} from '../lib/ledger/engine';
import type {ImportRow,Entry} from '../lib/ledger/types';
describe('stable tri-state presentation sorting',()=>{
 it('cycles ascending, descending and off, and restarts another column ascending',()=>{
  const asc=nextSort(null,'value');expect(asc).toEqual({key:'value',order:'asc'});const desc=nextSort(asc,'value');expect(desc).toEqual({key:'value',order:'desc'});expect(nextSort(desc,'value')).toBeNull();expect(nextSort(desc,'date')).toEqual({key:'date',order:'asc'});
 });
 it('compares numbers as numbers, retains zero/negative values, leaves all missing values last in both directions',()=>{
  const rows=[{id:'missing',v:null},{id:'ten',v:10},{id:'zero',v:0},{id:'minus',v:-5},{id:'two',v:2},{id:'bad',v:NaN}];const cols:SortColumn<(typeof rows)[number]>[]=[{key:'v',kind:'number',value:r=>r.v}];
  expect(sortRows(rows,{key:'v',order:'asc'},cols).map(r=>r.id)).toEqual(['minus','zero','two','ten','missing','bad']);expect(sortRows(rows,{key:'v',order:'desc'},cols).map(r=>r.id)).toEqual(['ten','two','zero','minus','missing','bad']);
 });
 it('keeps equal values and multiple nulls stable, and off restores source order without mutation',()=>{
  const rows=Object.freeze([{id:'b',v:1},{id:'missing1',v:null},{id:'a',v:1},{id:'missing2',v:null}]);const cols:SortColumn<(typeof rows)[number]>[]=[{key:'v',kind:'number',value:r=>r.v}];const source=JSON.stringify(rows);
  expect(sortRows(rows,{key:'v',order:'desc'},cols).map(r=>r.id)).toEqual(['b','a','missing1','missing2']);expect(sortRows(rows,null,cols)).toEqual(rows);expect(JSON.stringify(rows)).toBe(source);
 });
 it('sorts dates chronologically, handles offsets, and places invalid calendar dates last',()=>{
  const rows=[{id:'jan',v:'2026-01-12'},{id:'dec',v:'2025-12-31'},{id:'bad',v:'2026-02-30'}];expect(sortRows(rows,{key:'date',order:'asc'},[{key:'date',kind:'date',value:r=>r.v}]).map(r=>r.id)).toEqual(['dec','jan','bad']);expect(sortValue('2026-01-01T00:00:00+02:00','date')).toBeLessThan(sortValue('2026-01-01T00:00:00Z','date') as number);expect(sortValue('2026-02-30T12:00:00Z','date')).toBeNull();expect(sortValue(new Date('invalid'),'date')).toBeNull();
 });
 it('uses case-insensitive natural text ordering without treating tickers or names as dates',()=>{
  const rows=['Fund 10','fund 2','ALPHA','alpha'];expect(sortRows(rows,{key:'label',order:'asc'},[{key:'label',kind:'text',value:r=>r}])).toEqual(['ALPHA','alpha','fund 2','Fund 10']);expect(sortValue('AAPL','auto')).toBe('AAPL');expect(sortValue('9'.repeat(400),'auto')).toBeNull();
 });
 it('exposes native keyboard-operable buttons, visible indicators and aria-sort for all three states',()=>{
  for(const order of [null,'asc','desc'] as const){const html=renderToStaticMarkup(createElement(SortableHeader,{label:'Market value',sortKey:'value',sortConfig:order?{key:'value',order}:null,requestSort:()=>{}}));expect(html).toContain('<button type="button"');expect(html).toContain(`aria-sort="${order==='asc'?'ascending':order==='desc'?'descending':'none'}"`);expect(html).toContain('Market value: sort');expect(html).toContain('aria-hidden="true"');}
 });
});
describe('all workspace table columns',()=>{
 const partnerName=(id:string|undefined)=>id==='a'?'Alpha':'Pool';
 it('provides independent accessors for every meaningful displayed field, excluding action buttons',()=>{
  expect(holdingColumns(100,false).map(c=>c.key)).toEqual(['asset','quantity','price','quoteStatus','quoteDate','value','gain','return','weight']);expect(transactionColumns(partnerName).map(c=>c.key)).toEqual(['date','type','asset','quantity','received','gross','fee','note']);expect(decisionColumns('QQQ').map(c=>c.label)).toContain('QQQ return');expect(importColumns(partnerName,{},'').map(c=>c.key)).toEqual(['row','date','type','symbol','amount','partner','status']);
 });
 it('sorts the complete filtered transaction collection before taking a visible page',()=>{
  const rows=Array.from({length:150},(_,i)=>({id:String(i),type:'DIVIDEND' as const,tradeDate:'2026-01-01',grossAmount:i,allocations:[]}));expect(sortRows(rows,{key:'gross',order:'desc'},transactionColumns(partnerName)).slice(0,100)[0].grossAmount).toBe(149);
 });
 it('does not mutate a preview, source record IDs, cash-flow mapping or subsequent replay order',()=>{
  const entry=(id:string,type:Entry['type'],grossAmount:number,extra:Partial<Entry>={}):Entry=>({id,type,grossAmount,tradeDate:'2026-01-01',allocations:[],...extra});
  const rows:ImportRow[]=[{row:3,entry:entry('d','DEPOSIT',100,{partnerId:'self'}),source:{day:'2026-01-01',code:'ACH',symbol:'',amount:'100',description:'Synthetic',cashFlow:true}},{row:2,entry:entry('b','BUY',20,{symbol:'TEST',quantity:2})}];const before=JSON.stringify(rows);const view=sortRows(rows,{key:'row',order:'asc'},importColumns(partnerName,{'3':'a'},''));expect(view.map(r=>r.row)).toEqual([2,3]);expect(JSON.stringify(rows)).toBe(before);expect(()=>replay({...emptyLedger(),entries:rows.map(r=>r.entry!)})).not.toThrow();
 });
 it('keeps unknown holding values/returns last instead of converting them into zero',()=>{
  const l=replay({...emptyLedger(),entries:[{id:'d',type:'DEPOSIT',tradeDate:'2026-01-01',grossAmount:100,partnerId:'self',allocations:[]},{id:'b',type:'BUY',tradeDate:'2026-01-01',grossAmount:10,symbol:'TEST',quantity:1,allocations:[]}]});const rows=summarize(l,{}).holdings;expect(holdingColumns(null,false).find(c=>c.key==='value')!.value(rows[0])).toBeNull();expect(holdingColumns(null,false).find(c=>c.key==='return')!.value(rows[0])).toBeNull();
 });
});
