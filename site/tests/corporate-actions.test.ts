/** Real-parser regressions for inferred/explicit split reconciliation and hostile backup identifiers, using disposable D1. */
import { beforeEach,describe,it,expect,vi } from 'vitest';
import { env } from './worker-env';
import { testDatabase } from './d1';
vi.mock('../lib/server/market',()=>({eventPrice:vi.fn(async()=>100)}));
import { mutate,validateBackup } from '../lib/server/service';
import { readLedger,writeLedger,listBackups } from '../lib/server/store';
import { previewCsv } from '../lib/ledger/import';
import { derivedSplitChanges } from '../lib/ledger/corporate-actions';
import { emptyLedger,replay,summarize } from '../lib/ledger/engine';
import { calculateAssetQuantities,calculateOwnerUnits,getOwnerShares } from '../lib/core/pool';
import type { Entry,Ledger } from '../lib/ledger/types';
const header='Date,Type,Symbol,Quantity,Price,Amount';
const initialCsv=[header,'2020-08-01,Deposit,,,,1000','2020-08-03,Buy,AAPL,10,100,-1000','2020-09-01,Dividend,AAPL,,,1'].join('\n');
/** Preview and import all normalized rows, including preview duplicates to test server-side enforcement independently. */
async function importCsv(csv:string,key:string){
  const stored=await readLedger('synthetic');const rows=await previewCsv(csv,'self',stored.ledger);
  expect(rows.every(row=>!!row.entry&&!row.error)).toBe(true);
  return mutate('synthetic',{action:'import',key,revision:stored.revision,entries:rows.map(row=>row.entry)});
}
/** Produce a tiny complete backup with a configurable economic-owner identifier. */
function backup(partnerId:string):Ledger{return {version:1,partners:[{id:partnerId,name:'Synthetic partner'}],receipts:[],entries:[{id:'d',type:'DEPOSIT',tradeDate:'2026-01-01',grossAmount:1000,partnerId,allocations:[]},{id:'b',type:'BUY',tradeDate:'2026-01-02',symbol:'TEST',quantity:5,grossAmount:500,allocations:[]}]};}
beforeEach(()=>{env.DB=testDatabase();});
describe('derived split reconciliation across manual correction and restore',()=>{
  it('accepts the exact backdated manual full sale and removes only the obsolete inferred split',async()=>{
    const first=await importCsv(initialCsv,'first');
    const saved=await mutate('synthetic',{action:'save',key:'manual-close',revision:first.revision,entry:{id:'manual-sale',type:'SELL',tradeDate:'2020-08-10',symbol:'AAPL',quantity:10,grossAmount:1000}});
    expect(saved.ledger.entries.filter(e=>e.type==='SPLIT')).toHaveLength(0);expect(calculateAssetQuantities(saved.ledger.entries).AAPL).toBe(0);expect(summarize(saved.ledger,{}).totalValue).toBe(1001);
    expect(saved.receipt.derivedSplits).toEqual({added:0,removed:1});expect(first.ledger.entries.filter(e=>e.type!=='SPLIT').every(e=>saved.ledger.entries.some(s=>s.id===e.id))).toBe(true);
    expect((await readLedger('synthetic')).revision).toBe(2);
  });
  it('retains the split for a manual partial sale, removes it on a full-sale edit, and restores the inference if that edit reopens the position',async()=>{
    const first=await importCsv(initialCsv,'first');const sale={id:'manual-sale',type:'SELL',tradeDate:'2020-08-10',symbol:'AAPL',quantity:5,grossAmount:500};
    const partial=await mutate('synthetic',{action:'save',key:'partial',revision:first.revision,entry:sale});expect(calculateAssetQuantities(partial.ledger.entries).AAPL).toBe(20);expect(partial.receipt.derivedSplits).toEqual({added:0,removed:0});expect(summarize(partial.ledger,{}).lots[0].costBasis).toBe(500);
    const closed=await mutate('synthetic',{action:'save',key:'edit-close',revision:partial.revision,entry:{...sale,quantity:10,grossAmount:1000}});expect(closed.ledger.entries.filter(e=>e.type==='SPLIT')).toHaveLength(0);expect(closed.receipt.derivedSplits).toEqual({added:0,removed:1});
    const reopened=await mutate('synthetic',{action:'save',key:'edit-reopen',revision:closed.revision,entry:sale});expect(calculateAssetQuantities(reopened.ledger.entries).AAPL).toBe(20);expect(reopened.ledger.entries.filter(e=>e.type==='SPLIT')).toHaveLength(1);expect(reopened.receipt.derivedSplits).toEqual({added:1,removed:0});
  });
  it('keeps an earlier inferred split when a later manual sale closes the position before the next split',async()=>{
    const first=await importCsv([header,'2019-01-01,Deposit,,,,1000','2019-01-02,Buy,NVDA,10,100,-1000','2025-01-01,Dividend,,,,1'].join('\n'),'first');
    const saved=await mutate('synthetic',{action:'save',key:'close',revision:first.revision,entry:{id:'manual-sale',type:'SELL',tradeDate:'2022-01-01',symbol:'NVDA',quantity:40,grossAmount:1000}});
    expect(saved.ledger.entries.filter(e=>e.type==='SPLIT').map(e=>e.tradeDate)).toEqual(['2021-07-20']);expect(calculateAssetQuantities(saved.ledger.entries).NVDA).toBe(0);expect(saved.receipt.derivedSplits).toEqual({added:0,removed:1});
  });
  it.each(['csv','manual'] as const)('never deletes an explicit %s split to make an inconsistent full-sale correction pass',async origin=>{
    const csv=origin==='csv'?[header,'2020-08-01,Deposit,,,,1000','2020-08-03,Buy,AAPL,10,100,-1000','2020-08-31,Split,AAPL,30,,0','2020-09-01,Dividend,AAPL,,,1'].join('\n'):initialCsv;
    let first=await importCsv(csv,'first');
    if(origin==='manual'){const split=first.ledger.entries.find(e=>e.type==='SPLIT')!;first=await mutate('synthetic',{action:'save',key:'confirm',revision:first.revision,entry:split});}
    const before=await readLedger('synthetic');await expect(mutate('synthetic',{action:'save',key:'close-explicit',revision:first.revision,entry:{id:'manual-sale',type:'SELL',tradeDate:'2020-08-10',symbol:'AAPL',quantity:10,grossAmount:1000}})).rejects.toThrow('No AAPL shares');expect(await readLedger('synthetic')).toEqual(before);
    const source=structuredClone(before.ledger);source.entries.push({id:'restored-sale',type:'SELL',tradeDate:'2020-08-10',symbol:'AAPL',quantity:10,grossAmount:1000,allocations:[]});await expect(validateBackup(source)).rejects.toThrow('No AAPL shares');
  });
  it.each([false,true])('prunes an obsolete inferred event from a corrected backup, including legacy IDs (%s)',async legacy=>{
    const first=await importCsv(initialCsv,'first');const source=structuredClone(first.ledger);if(legacy)for(const e of source.entries)delete e.splitOrigin;
    source.entries.push({id:'restored-sale',type:'SELL',tradeDate:'2020-08-10',symbol:'AAPL',quantity:10,grossAmount:1000,allocations:[]});const restored=await validateBackup(source);
    expect(restored.entries.filter(e=>e.type==='SPLIT')).toHaveLength(0);expect(summarize(restored,{}).totalValue).toBe(1001);expect(derivedSplitChanges(source.entries,restored.entries)).toEqual({added:0,removed:1});
  });
  it('does not invent an absent corporate action while restoring a backup',async()=>{
    const first=await importCsv(initialCsv,'first');const source=structuredClone(first.ledger);source.entries=source.entries.filter(e=>e.type!=='SPLIT');const restored=await validateBackup(source);expect(restored.entries.map(e=>e.id)).toEqual(source.entries.map(e=>e.id));expect(derivedSplitChanges(source.entries,restored.entries)).toEqual({added:0,removed:0});
  });
});
describe('one corporate action per symbol and date',()=>{
  it('does not apply a later explicit CSV split on top of its already inferred 4:1 event',async()=>{
    const first=await importCsv(initialCsv,'first');expect(calculateAssetQuantities(first.ledger.entries).AAPL).toBe(40);
    const csv=[header,'2020-08-31,Split,AAPL,30,,0'].join('\n');
    const rows=await previewCsv(csv,'self',first.ledger);expect(rows[0].duplicate).toBe(true);expect(rows[0].error).toBeUndefined();
    const repeated=await importCsv(csv,'explicit');expect(repeated.receipt.imported).toBe(0);expect(repeated.receipt.skipped).toBe(1);expect(repeated.revision).toBe(first.revision);
    expect(calculateAssetQuantities(repeated.ledger.entries).AAPL).toBe(40);expect(repeated.ledger.entries.filter(e=>e.type==='SPLIT')).toHaveLength(1);
    expect((await previewCsv(csv,'self',repeated.ledger))[0].duplicate).toBe(true);
  });
  it('rejects a conflicting later explicit split in preview and atomically at commit',async()=>{
    const first=await importCsv(initialCsv,'first');const before=await readLedger('synthetic');
    const rows=await previewCsv([header,'2020-08-31,Split,AAPL,20,,0'].join('\n'),'self',first.ledger);
    expect(rows[0].entry).toBeNull();expect(rows[0].error).toContain('Conflicting split');
    const conflict={id:'csv:'+'a'.repeat(64),type:'SPLIT',tradeDate:'2020-08-31',symbol:'AAPL',quantity:20,grossAmount:0,splitMode:'additional'};
    const deposit={id:'csv:'+'b'.repeat(64),type:'DEPOSIT',tradeDate:'2020-09-02',grossAmount:100,partnerId:'self'};
    await expect(mutate('synthetic',{action:'import',key:'conflict',revision:before.revision,entries:[conflict,deposit]})).rejects.toThrow('Conflicting split');
    expect(await readLedger('synthetic')).toEqual(before);expect(await listBackups('synthetic')).toHaveLength(1);
  });
  it('reconciles two equivalent explicit rows in the same CSV once',async()=>{
    const csv=[header,'2020-08-01,Deposit,,,,1000','2020-08-03,Buy,AAPL,10,100,-1000','2020-08-31,Split,AAPL,30,,0','2020-08-31,Split,AAPL,30,,0','2020-09-01,Dividend,AAPL,,,1'].join('\n');
    const rows=await previewCsv(csv,'self',emptyLedger());expect(rows[2].duplicate).toBeFalsy();expect(rows[3].duplicate).toBe(true);
    const saved=await importCsv(csv,'duplicates');expect(saved.receipt.imported).toBe(4);expect(saved.receipt.skipped).toBe(1);expect(calculateAssetQuantities(saved.ledger.entries).AAPL).toBe(40);
  });
  it('matches an explicit ratio with a CSV added-share record while retaining earlier splits in the position calculation',async()=>{
    const initial=[header,'2019-01-01,Deposit,,,,1000','2019-01-02,Buy,NVDA,10,100,-1000','2025-01-01,Dividend,NVDA,,,1'].join('\n');
    const first=await importCsv(initial,'nvda');expect(calculateAssetQuantities(first.ledger.entries).NVDA).toBe(400);
    const explicit=[header,'2024-06-10,Split,NVDA,360,,0'].join('\n');
    const saved=await importCsv(explicit,'nvda-explicit');expect(saved.receipt.skipped).toBe(1);expect(calculateAssetQuantities(saved.ledger.entries).NVDA).toBe(400);
  });
  it('does not infer a split after a position was completely closed',async()=>{
    const csv=[header,'2020-08-01,Deposit,,,,1000','2020-08-03,Buy,AAPL,10,100,-1000','2020-08-10,Sell,AAPL,10,100,1000','2020-09-01,Dividend,,,,1'].join('\n');
    const saved=await importCsv(csv,'closed');expect(saved.ledger.entries.filter(e=>e.type==='SPLIT')).toHaveLength(0);expect(calculateAssetQuantities(saved.ledger.entries).AAPL).toBe(0);expect(summarize(saved.ledger,{}).totalValue).toBe(1001);
  });
  it('uses prior split-adjusted quantities when deciding a later inferred split is unnecessary',async()=>{
    const csv=[header,'2019-01-01,Deposit,,,,1000','2019-01-02,Buy,NVDA,10,100,-1000','2022-01-01,Sell,NVDA,40,25,1000','2025-01-01,Dividend,,,,1'].join('\n');
    const saved=await importCsv(csv,'closed-after-split');expect(saved.ledger.entries.filter(e=>e.type==='SPLIT').map(e=>e.tradeDate)).toEqual(['2021-07-20']);expect(calculateAssetQuantities(saved.ledger.entries).NVDA).toBe(0);
  });
  it('infers a split only on the shares still open after a partial sale',async()=>{
    const csv=[header,'2020-08-01,Deposit,,,,1000','2020-08-03,Buy,AAPL,10,100,-1000','2020-08-10,Sell,AAPL,5,100,500','2020-09-01,Dividend,,,,1'].join('\n');
    const saved=await importCsv(csv,'partial');expect(calculateAssetQuantities(saved.ledger.entries).AAPL).toBe(20);expect(summarize(saved.ledger,{}).lots[0].costBasis).toBe(500);
  });
  it('considers the full existing history when a backdated purchase creates a newly held historical split',async()=>{
    await importCsv([header,'2020-08-01,Deposit,,,,1000','2020-09-01,Dividend,,,,1'].join('\n'),'existing-cash');
    const saved=await importCsv([header,'2020-08-03,Buy,AAPL,10,100,-1000'].join('\n'),'backdated-buy');expect(calculateAssetQuantities(saved.ledger.entries).AAPL).toBe(40);
  });
  it('blocks duplicate manual splits and retains an explicit edit to an inferred event',async()=>{
    const first=await importCsv(initialCsv,'first');const split=first.ledger.entries.find(e=>e.type==='SPLIT')!;
    await expect(mutate('synthetic',{action:'save',key:'manual-duplicate',revision:first.revision,entry:{id:'manual-duplicate',type:'SPLIT',tradeDate:'2020-08-31',symbol:'AAPL',quantity:4,splitMode:'ratio',grossAmount:0}})).rejects.toThrow('already recorded');
    const edited=await mutate('synthetic',{action:'save',key:'manual-edit',revision:first.revision,entry:{...split,quantity:4}});expect(edited.ledger.entries.find(e=>e.id===split.id)!.splitOrigin).toBe('manual');
    const restored=await validateBackup(JSON.parse(JSON.stringify(edited.ledger)));expect(restored.entries.find(e=>e.id===split.id)!.splitOrigin).toBe('manual');expect(calculateAssetQuantities(restored.entries).AAPL).toBe(40);
  });
  it('recognizes version 3 inferred events without an origin field',async()=>{
    const first=await importCsv(initialCsv,'first');const old=JSON.parse(JSON.stringify(first.ledger)) as Ledger;for(const e of old.entries)delete e.splitOrigin;
    const restored=await validateBackup(old);const rows=await previewCsv([header,'2020-08-31,Split,AAPL,30,,0'].join('\n'),'self',restored);expect(rows[0].duplicate).toBe(true);expect(calculateAssetQuantities(restored.entries).AAPL).toBe(40);
  });
  it('flags conflicting explicit rows within one CSV',async()=>{
    const csv=[header,'2020-08-01,Deposit,,,,1000','2020-08-03,Buy,AAPL,10,100,-1000','2020-08-31,Split,AAPL,30,,0','2020-08-31,Split,AAPL,20,,0'].join('\n');
    const rows=await previewCsv(csv,'self',emptyLedger());expect(rows[2].entry).toBeNull();expect(rows[3].entry).toBeNull();expect(rows[2].error).toContain('Conflicting split');expect((await readLedger('synthetic')).revision).toBe(0);
  });
  it('rejects duplicated corporate actions in a restored history',async()=>{
    const first=await importCsv(initialCsv,'first');const source=structuredClone(first.ledger);const split=source.entries.find(e=>e.type==='SPLIT')!;source.entries.push({...split,id:'another-split'});await expect(validateBackup(source)).rejects.toThrow('Multiple split records');
  });
  it('flags reverse-split CSV reductions for manual ratio reconciliation',async()=>{
    const rows=await previewCsv([header,'2020-08-31,Split,AAPL,-9,,0'].join('\n'),'self',emptyLedger());expect(rows[0].entry).toBeNull();expect(rows[0].error).toContain('manual ratio');
  });
});
describe('safe identifiers and finite accounting',()=>{
  it.each(['constructor','__proto__','toString','hasOwnProperty','prototype'])('rejects reserved restored partner ID %s',async id=>{
    await expect(validateBackup(backup(id))).rejects.toThrow('unsafe partner identifier');expect((await readLedger('synthetic')).revision).toBe(0);
  });
  it.each(['self','partner-1','restored_owner:2','cm123abc','b970e468-cf42-481d-8731-553923c5a393'])('restores ordinary partner ID %s with finite ownership',async id=>{
    const restored=await validateBackup(backup(id));const s=summarize(restored,{TEST:{symbol:'TEST',price:100,status:'fresh',marketTime:null,fetchedAt:null}});
    expect(s.totalValue).toBe(1000);expect(s.partners[0].share).toBe(1);expect(s.partners[0].value).toBe(1000);expect(restored.entries[0].allocations[0].quantity).toBe(1000);
  });
  it('also rejects reserved IDs at the pure replay boundary',()=>expect(()=>replay(backup('constructor'))).toThrow('unsafe partner identifier'));
  it('uses prototype-free shared ownership maps even for untrusted identifiers outside the hosted validation path',()=>{
    const rows=backup('constructor').entries;rows[0].allocations=[{ownerId:'constructor',percentage:1,amount:1000,quantity:1000}];
    const units=calculateOwnerUnits(rows);expect(Object.getPrototypeOf(units)).toBeNull();expect(units.constructor).toBe(1000);expect(getOwnerShares(rows,['constructor']).constructor).toBe(1);
  });
  it('rejects overflow in derived units before a restored ledger can be persisted',async()=>{
    const source=backup('self');source.entries.push({id:'tiny-nav',type:'DEPOSIT',tradeDate:'2026-01-03',partnerId:'self',grossAmount:1000,navBeforeOverride:Number.MIN_VALUE,allocations:[]});
    await expect(validateBackup(source)).rejects.toThrow('non-finite');expect((await readLedger('synthetic')).revision).toBe(0);
  });
  it('rejects overflow from repeated valid numeric split inputs',async()=>{
    const source=backup('self');source.entries.push(...Array.from({length:30},(_,i)=>({id:'split-'+i,type:'SPLIT',tradeDate:new Date(Date.UTC(2026,0,3+i)).toISOString().slice(0,10),symbol:'TEST',quantity:1e12,grossAmount:0,splitMode:'ratio',allocations:[]} as Entry)));
    await expect(validateBackup(source)).rejects.toThrow('non-finite');
  });
  it('never serializes NaN or Infinity into null financial values at the D1 boundary',async()=>{
    const source=backup('self');source.entries[0].grossAmount=Number.NaN;await expect(writeLedger('synthetic',0,source)).rejects.toThrow('non-finite');source.entries[0].grossAmount=Infinity;await expect(writeLedger('synthetic',0,source)).rejects.toThrow('non-finite');expect((await readLedger('synthetic')).revision).toBe(0);expect(await listBackups('synthetic')).toHaveLength(0);
  });
});
