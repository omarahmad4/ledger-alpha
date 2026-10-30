/** Hosted ledger command service: validate, price, replay, deduplicate and atomically persist an entire revision. */
import { mutationSchema, entryInput, partnerIdSchema,reconciliationSchema } from '../ledger/validation';
import { LedgerError, replay } from '../ledger/engine';
import { reconcileDerivedSplits,derivedSplitChanges } from '../ledger/corporate-actions';
import { reconcileImportedEntries } from '../ledger/import';
import { eventPrice } from './market';
import { readLedger, writeLedger, ConflictError } from './store';
import type { Entry, Ledger } from '../ledger/types';
/** Fill missing event-date valuations. Existing event prices are frozen until a changed entry is resubmitted. */
export async function priceAndReplay(ledger:Ledger,inferMissingSplits=false):Promise<Ledger> {
  const prefix:Entry[]=[];const quantities:Record<string,number>=Object.create(null);
  for(const input of reconcileDerivedSplits(ledger.entries,inferMissingSplits)) {
    const tx={...input};
    if(['DEPOSIT','WITHDRAWAL'].includes(tx.type) && tx.navBeforeOverride==null) {
      const prices={...tx.valuationPrices};
      for(const [symbol,quantity] of Object.entries(quantities)) {
        if(Math.abs(quantity)<1e-8 || prices[symbol]>0)continue;
        const value=await eventPrice(symbol,tx.tradeDate);
        if(value==null)throw new LedgerError(`No reliable prior-session price for ${symbol} on ${tx.tradeDate}. Enter a verified pre-flow portfolio value for this cash flow, or retry after historical data recovers.`);
        prices[symbol]=value;
      }
      tx.valuationPrices=prices;tx.valuationDate=tx.tradeDate;
    }
    if(tx.type==='SPLIT' && tx.splitMode==='additional') {
      const prior=quantities[tx.symbol!]??0;
      if(prior<=0)throw new LedgerError(`No ${tx.symbol} shares exist before this split.`);
      tx.quantity=(prior+tx.quantity!)/prior;tx.splitMode='ratio';
    }
    if(tx.symbol){if(tx.type==='BUY'||tx.type==='REWARD')quantities[tx.symbol]=(quantities[tx.symbol]??0)+(tx.quantity??0);if(tx.type==='SELL'||tx.type==='EXPIRY')quantities[tx.symbol]=(quantities[tx.symbol]??0)-(tx.quantity??0);if(tx.type==='SPLIT')quantities[tx.symbol]=(quantities[tx.symbol]??0)*(tx.quantity??1);}
    if(tx.type==='CONVERSION') {
      const prior=quantities[tx.symbol!]??0;const consumed=Math.abs(prior-tx.quantity!)<=(tx.quantityRounding??0)+1e-9?prior:tx.quantity!;
      quantities[tx.symbol!]-=consumed;quantities[tx.targetSymbol!]=(quantities[tx.targetSymbol!]??0)+tx.targetQuantity!;
    }
    prefix.push({...tx,assetSymbol:tx.symbol,assetId:tx.symbol});
  }
  return replay({...ledger,entries:prefix});
}
/** Apply a user command with idempotent receipts and optimistic conflict detection before durable writes. */
export async function mutate(userId:string,body:unknown) {
  const input=mutationSchema.parse(body);const current=await readLedger(userId);
  const payload={...input,revision:undefined};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
  const payloadHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const receipt=current.ledger.receipts.find(r=>r.key===input.key);
  if(receipt){if(receipt.payloadHash && receipt.payloadHash!==payloadHash)throw new ConflictError('This retry contains different data from the saved command. Close and reopen the form before saving a new change.');return {...current,receipt,replayed:true};}
  if(current.revision!==input.revision)throw new ConflictError('Your ledger changed in another tab or device. Reload and retry.');
  let ledger=structuredClone(current.ledger);let imported=0;let skipped=0;
  if(input.action==='cashPolicy') {
    ledger.cashPolicy=input.cashPolicy;ledger=await priceAndReplay(ledger);
  } else if(input.action==='partner') {
    if(input.id) {
      const partner=ledger.partners.find(p=>p.id===input.id);if(!partner)throw new LedgerError('Partner not found.');partner.name=input.name;
    } else {
      if(ledger.partners.length>=20)throw new LedgerError('At most 20 partners are supported.');
      if(ledger.partners.some(p=>p.name.toLowerCase()===input.name.toLowerCase()))throw new LedgerError('A partner with this name already exists.');
      ledger.partners.push({id:crypto.randomUUID(),name:input.name});
    }
  } else if(input.action==='save') {
    const tx:Entry={...input.entry,splitOrigin:input.entry.type==='SPLIT'?'manual':undefined,allocations:[]};const index=ledger.entries.findIndex(e=>e.id===tx.id);
    if(tx.type==='SPLIT'&&ledger.entries.some(e=>e.id!==tx.id&&e.type==='SPLIT'&&e.symbol===tx.symbol&&e.tradeDate===tx.tradeDate))throw new LedgerError('A split is already recorded for this symbol and date. Edit the existing corporate action instead.');
    if(index>=0){tx.externalId=ledger.entries[index].externalId;ledger.entries[index]=tx;}else{ledger.entries.push(tx);imported=1;}
    ledger=await priceAndReplay(ledger,true);
  } else {
    const existing=new Set(ledger.entries.map(e=>e.externalId??e.id));
    const staged:Entry[]=[];
    for(const inputEntry of input.entries) {
      if(!/^csv:[a-f0-9]{64}$/.test(inputEntry.id))throw new LedgerError('Preview the CSV again before committing it.');
      if(existing.has(inputEntry.id)){skipped++;continue;}
      existing.add(inputEntry.id);staged.push({...inputEntry,externalId:inputEntry.id,splitOrigin:inputEntry.type==='SPLIT'?'csv':undefined,allocations:[]});
    }
    if(!staged.length)return {...current,receipt:{key:input.key,imported:0,skipped},replayed:false};
    const reconciled=reconcileImportedEntries(staged,ledger.entries);
    skipped+=reconciled.duplicateIds.size;imported=reconciled.importedCount;
    if(!imported)return {...current,receipt:{key:input.key,imported:0,skipped},replayed:false};
    ledger.entries=reconciled.entries;
    ledger=await priceAndReplay(ledger);
  }
  const nextReceipt={key:input.key,imported,skipped,payloadHash,derivedSplits:derivedSplitChanges(current.ledger.entries,ledger.entries)};
  ledger.receipts=[...ledger.receipts.slice(-99),nextReceipt];
  const saved=await writeLedger(userId,input.revision,ledger);
  return {...saved,receipt:nextReceipt,replayed:false};
}
/** Validate a portable backup, stripping derived allocations and rejecting inconsistent identifiers. */
export async function validateBackup(input:unknown):Promise<Ledger> {
  if(!input||typeof input!=='object')throw new LedgerError('Choose a LedgerAlpha JSON backup.');
  const value=input as {version?:number;partners?:unknown[];entries?:unknown[];cashPolicy?:unknown;reconciliation?:unknown};
  if(value.version!==1||!Array.isArray(value.partners)||!Array.isArray(value.entries)||value.partners.length<1||value.partners.length>20||value.entries.length>5000)throw new LedgerError('Unsupported or oversized ledger backup.');
  if(value.cashPolicy!=null&&!['cash-only','margin','reconstruction'].includes(String(value.cashPolicy)))throw new LedgerError('Invalid cash policy in backup.');
  const reconciliation=value.reconciliation==null?undefined:reconciliationSchema.parse(value.reconciliation);
  if(value.cashPolicy==='reconstruction'&&!reconciliation)throw new LedgerError('Estimated reconstruction requires explicit reconciliation notes and an opening owner.');
  const partners=value.partners.map(p=>{
    if(!p||typeof p!=='object')throw new LedgerError('Backup contains an invalid partner.');
    const row=p as {id?:unknown;name?:unknown};const id=partnerIdSchema.safeParse(row.id);
    if(!id.success||typeof row.name!=='string'||!row.name.trim()||row.name.length>80)throw new LedgerError('Backup contains an invalid or unsafe partner identifier.');return {id:id.data,name:row.name};
  });
  if(new Set(partners.map(p=>p.id)).size!==partners.length)throw new LedgerError('Duplicate partner IDs in backup.');
  const entries=value.entries.map(raw=>{
    const row=raw as Entry;const validated=entryInput.parse(row);
    const valuationPrices:Record<string,number>={};
    if(row.valuationPrices)for(const [symbol,p]of Object.entries(row.valuationPrices)){if(!/^[A-Z0-9][A-Z0-9.^=-]{0,31}$/.test(symbol)||typeof p!=='number'||!Number.isFinite(p)||p<=0)throw new LedgerError('Invalid historical valuation in backup.');valuationPrices[symbol]=p;}
    if(row.splitOrigin!=null&&!['inferred','csv','manual'].includes(row.splitOrigin))throw new LedgerError('Invalid split origin in backup.');
    return {...validated,splitOrigin:row.splitOrigin,externalId:typeof row.externalId==='string'&&row.externalId.length<=100?row.externalId:undefined,valuationPrices,valuationDate:validated.tradeDate,allocations:[]} as Entry;
  });
  return priceAndReplay({version:1,partners,entries,receipts:[],cashPolicy:value.cashPolicy==='margin'?'margin':value.cashPolicy==='reconstruction'?'reconstruction':'cash-only',reconciliation});
}
