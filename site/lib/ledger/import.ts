/** Strict Robinhood CSV preview and stable row fingerprints. Unsupported activity is reported, never guessed. */
import Papa from 'papaparse';
import { normalizeRobinhoodRow } from '../core/normalize';
import { entryInput } from './validation';
import { chronological,LedgerError } from './engine';
import { knownHistoricalSplits,isInferredSplit } from './corporate-actions';
import type { Entry, ImportRow, Ledger } from './types';
const knownCodes=new Set(['ACH','CDIV','MDIV','INT','SLIP','MISC','CIL','GOLD','DFEE','AFEE','MINT','BUY','SELL','SPL','SPLIT','DIVIDEND','DEPOSIT','WITHDRAWAL','FEE']);
/** Canonical import identity includes ownership and fees; distinguish different partners' same-day cash flows. */
export function signature(entry:Entry):string {
  const identity:unknown[]=[entry.tradeDate.slice(0,10),entry.type,entry.symbol??'',entry.quantity??0,entry.grossAmount,entry.fee??0,['DEPOSIT','WITHDRAWAL'].includes(entry.type)?entry.partnerId??'':''];
  if(entry.type==='CONVERSION'||entry.instrumentType)identity.push(entry.targetSymbol??'',entry.targetQuantity??0,entry.instrumentType??'');
  return JSON.stringify(identity);
}
/** Hash canonical content to stable compact identifiers without putting transaction contents in IDs. */
export async function fingerprint(entry:Entry,occurrence=0):Promise<string> {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature(entry)+':'+occurrence));return 'csv:'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
/** Parse one CSV numeric field without turning invalid financial text into zero. */
function numeric(value:string,label:string,allowDisposition=false):number|undefined {
  const text=value.trim();if(!text)return undefined;
  const cleaned=text.replace(/[$,]/g,'').replace(allowDisposition?/S$/i:/^$/,'');
  if(!/^(?:-?\d+(?:\.\d*)?|\(\d+(?:\.\d*)?\))$/.test(cleaned))throw new Error(`Invalid ${label}: use a numeric value.`);
  const result=Number(cleaned.replace(/[()]/g,''))*(cleaned.startsWith('(')?-1:1);
  if(!Number.isFinite(result))throw new Error(`Invalid ${label}.`);return result;
}
/** Broker dates are explicit calendar dates; Activity Date takes precedence over settlement/process dates. */
function brokerDay(raw:string):string {
  const match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const day=match?`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`:raw;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw new Error('Invalid date. Use YYYY-MM-DD or MM/DD/YYYY.');return day;
}
/** Use a distinct OCC contract symbol so option activity can never change the underlying stock position. */
function optionSymbol(description:string,underlying:string):string {
  const match=description.match(/(?:^|for\s+)([A-Z][A-Z0-9]{0,5})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(Call|Put)\s+\$([\d,.]+)/i);
  if(!match||match[1].toUpperCase()!==underlying)throw new Error('Unrecognized option contract. Verify underlying, expiration, call/put and strike.');
  const day=brokerDay(match[2]);const strike=numeric(match[4],'option strike')!;
  if(strike<=0||strike*1000>99999999||Math.abs(strike*1000-Math.round(strike*1000))>1e-6)throw new Error('Invalid option strike.');
  return underlying+day.slice(2).replaceAll('-','')+match[3][0].toUpperCase()+String(Math.round(strike*1000)).padStart(8,'0');
}
/** Validate the entire CSV, retaining recognized nonfinancial records and every financial-row diagnostic. */
export async function previewCsv(csv:string,partnerId:string,ledger:Ledger,cashFlowPartners:Record<string,string>={},sourceOrder:'auto'|'newest-first'|'oldest-first'='auto'):Promise<ImportRow[]> {
  const parsed=Papa.parse<string[]>(csv,{skipEmptyLines:false});
  if(parsed.data.length>2003)throw new LedgerError('Import at most 2,000 financial rows at a time.');
  if(parsed.errors.some(error=>error.row==null))throw new LedgerError('Malformed CSV. Check quoting and delimiters.');
  const header=parsed.data[0]?.map(h=>h.replace(/^\uFEFF/,'').trim())??[];
  const lower=header.map(h=>h.toLowerCase());
  if(new Set(lower).size!==lower.length||!lower.some(h=>['activity date','trade date','date','process date'].includes(h))||!lower.some(h=>['trans code','activity type','type'].includes(h)))throw new LedgerError('CSV needs unique date and activity-code headers.');
  const robinhood=lower.includes('trans code')&&lower.includes('activity date')&&lower.includes('process date');
  const get=(row:Record<string,string>,keys:string[])=>{for(const key of keys){const index=lower.indexOf(key);if(index>=0&&row[header[index]]?.trim())return row[header[index]].trim();}return '';};
  const records=parsed.data.slice(1).map((cells,index)=>({cells,row:index+2,values:Object.fromEntries(header.map((h,i)=>[h,cells[i]??'']))}));
  const existing=new Set(ledger.entries.map(e=>e.externalId).filter(Boolean));const counts=new Map<string,number>();const sourceCounts=new Map<string,number>();
  const rows:ImportRow[]=[];
  for(const record of records){
    const {cells,row:rowNumber,values:row}=record;
    if(cells.every(v=>!v.trim())){if(rowNumber<parsed.data.length)rows.push({row:rowNumber,entry:null,ignored:'Blank separator; no transaction.'});continue;}
    // Robinhood appends this exact class of footer as an extra field. Never relax widths for financial rows.
    if(robinhood&&cells.length===header.length+1&&cells.slice(0,header.length).every(v=>!v.trim())&&cells.at(-1)!.startsWith('The data provided is for informational purposes only.')&&cells.at(-1)!.includes('does not include Robinhood Crypto or Robinhood Spending activity.')){
      rows.push({row:rowNumber,entry:null,ignored:'Robinhood informational footer. Crypto and Spending activity are excluded from this export.'});continue;
    }
    const code=get(row,['trans code','activity type','type']).toUpperCase();
    const source={day:get(row,['activity date','trade date','date','process date']),code,symbol:get(row,['instrument','symbol','ticker']).toUpperCase(),amount:get(row,['amount','net amount','total','value']),description:get(row,['description']),cashFlow:['ACH','DEPOSIT','WITHDRAWAL'].includes(code)};
    const base={row:rowNumber,source};
    const parseError=parsed.errors.find(e=>e.row===rowNumber-1);
    if(parseError||cells.length!==header.length){rows.push({...base,entry:null,error:parseError?.message??`Expected ${header.length} fields, got ${cells.length}. No financial row was skipped.`});continue;}
    try {
      const day=brokerDay(source.day);source.day=day;
      const amount=numeric(source.amount,'amount');const rawQuantity=get(row,['quantity','qty','shares']);
      const quantity=numeric(rawQuantity,'quantity',['MRGS','OEXP'].includes(code));
      numeric(get(row,['price','share price','average price']),'price');numeric(get(row,['fee','fees','reg fee']),'fee');
      let entry:Entry;let warning:string|undefined;let relatedRows:number[]|undefined;
      if(code==='MRGS'){
        const group=records.filter(r=>get(r.values,['trans code']).toUpperCase()==='MRGS'&&get(r.values,['activity date','trade date','date','process date'])===get(row,['activity date','trade date','date','process date']));
        const outgoing=group.filter(r=>/S$/i.test(get(r.values,['quantity']))||get(r.values,['quantity']).startsWith('-'));
        const incoming=group.filter(r=>!outgoing.includes(r));
        if(group.length!==2||outgoing.length!==1||incoming.length!==1)throw new Error('Merger needs exactly one delivered and one received security on the same date. Reconcile complex actions manually.');
        if(group.some(r=>r.cells.length!==header.length||(numeric(get(r.values,['amount']),'merger cash')??0)!==0))throw new Error('Merger cash or malformed paired row requires separate reconciliation.');
        if(record!==outgoing[0]){rows.push({...base,entry:null,ignored:`Received security paired with conversion at CSV record ${outgoing[0].row}.`,relatedRows:[outgoing[0].row]});continue;}
        const target=incoming[0];const targetSymbol=get(target.values,['instrument','symbol','ticker']).toUpperCase();
        const decimals=rawQuantity.replace(/S$/i,'').split('.')[1]?.length??0;
        const rounding=Math.min(0.0001,0.5*10**-decimals);
        entry={id:'pending',type:'CONVERSION',tradeDate:day,symbol:source.symbol,quantity:Math.abs(quantity??0),targetSymbol,targetQuantity:Math.abs(numeric(get(target.values,['quantity']),'received quantity')??0),quantityRounding:rounding,grossAmount:0,fee:0,notes:`Broker merger: delivered ${rawQuantity} ${source.symbol}, received ${get(target.values,['quantity'])} ${targetSymbol}. Cost basis carried; source rounding tolerance ${rounding}.`,allocations:[]};
        warning='Two broker rows form one non-cash conversion. Cost basis carries to the received security; documented export precision is used to close rounding residue.';relatedRows=[target.row];
      }else if(['BTO','STC','OEXP'].includes(code)){
        const symbol=optionSymbol(source.description,source.symbol);
        if(code==='OEXP'&&(amount??0)!==0)throw new Error('Option expiration with cash requires reconciliation.');
        if(!quantity||quantity<0||!Number.isInteger(quantity))throw new Error('Option contract quantity must be a positive whole number.');
        if(code==='BTO'&&(amount==null||amount>=0))throw new Error('Option purchase needs its negative net cash amount.');
        if(code==='STC'&&(amount==null||amount<=0))throw new Error('Option sale needs its positive net cash amount.');
        entry={id:'pending',type:code==='BTO'?'BUY':code==='STC'?'SELL':'EXPIRY',tradeDate:day,symbol,quantity,grossAmount:Math.abs(amount??0),fee:0,instrumentType:'OPTION',notes:`${code}: ${source.description}. Quantity is contracts; amount is exact broker net cash including embedded fees.`,allocations:[]};
        const multiplier=numeric(get(row,['contract multiplier','option multiplier']),'option multiplier');
        if(multiplier!=null){entry.optionMultiplier=multiplier;entry.optionTerms=get(row,['option terms']).toLowerCase() as 'standard'|'adjusted';entry.optionTermsSource=get(row,['multiplier source']);}
        warning='Option quote multipliers and adjusted terms must be verified in the transaction editor (or supplied with verification source columns). Unknown terms withhold active values and block cash-flow NAV pricing. Option contracts remain separate from the underlying shares. Broker net cash includes embedded fees; no fee is added twice.';
      }else{
        if(!knownCodes.has(code)&&!['GMPC','CONV'].includes(code))throw new Error(`Unsupported activity “${code||'blank'}”. This financial record must be reconciled before the batch can be committed.`);
        const selected=cashFlowPartners[String(rowNumber)]??partnerId;
        if(source.cashFlow&&!ledger.partners.some(p=>p.id===selected))throw new Error('Assign the partner for this deposit or withdrawal.');
        if(['BUY','SELL'].includes(code)&&source.amount&&amount===0)throw new Error('Zero-cash stock trade requires separate reconciliation.');
        if(['GOLD','DFEE','AFEE','MINT','FEE'].includes(code)&&amount!=null&&amount>0)throw new Error('Positive fee reversal requires explicit income reconciliation.');
        const normalized=normalizeRobinhoodRow({...row,'Trade Date':day,'Trans Code':code==='GMPC'?'MISC':code},{accountId:'personal',assetLookup:()=>undefined,defaultAllocations:[]});
        if(!normalized)throw new Error('Missing or invalid trade date.');
        if(normalized.type==='SPLIT'&&(quantity??0)<0)throw new Error('Reverse-split share reductions require a verified manual ratio entry.');
        entry={...normalized,tradeDate:day,symbol:normalized.assetSymbol?.toUpperCase(),partnerId:source.cashFlow?selected:undefined,splitMode:normalized.type==='SPLIT'?'additional':undefined,notes:source.description||normalized.notes};
        const fee=entry.fee??0;
        if(source.amount&&entry.type==='BUY')entry.grossAmount-=fee;
        if(source.amount&&entry.type==='SELL')entry.grossAmount+=fee;
        if(!['BUY','SELL','SPLIT'].includes(entry.type)){entry.quantity=undefined;entry.price=undefined;}
      }
      Object.assign(entry,entryInput.parse(entry));
      const sig=signature(entry);const occurrence=counts.get(sig)??0;counts.set(sig,occurrence+1);
      const legacyId=await fingerprint(entry,occurrence);
      let id=legacyId;
      if(robinhood){
        // Ownership is editable attribution, not broker identity. Reassigning a row cannot import its cash twice.
        const identity=JSON.stringify([cells,...(relatedRows??[]).map(n=>records.find(r=>r.row===n)!.cells)]);
        const occurrence=sourceCounts.get(identity)??0;sourceCounts.set(identity,occurrence+1);
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('robinhood-v2:'+identity+':'+occurrence));
        id='csv:'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
      }
      entry.id=id;entry.externalId=id;
      rows.push({...base,entry,duplicate:existing.has(id)||existing.has(legacyId),warning,relatedRows});
    }catch(error){rows.push({...base,entry:null,error:error instanceof Error?error.message:'Invalid row.'});}
  }
  const splitRows=rows.filter(row=>row.entry?.type==='SPLIT'&&!row.duplicate);
  if(splitRows.length) {
    try {
      const result=reconcileImportedEntries(rows.filter(row=>row.entry&&!row.duplicate).map(row=>row.entry!),ledger.entries);
      for(const row of splitRows)if(result.duplicateIds.has(row.entry!.id))row.duplicate=true;
    } catch(error) {
      if(!(error instanceof SplitReconciliationError))throw error;
      const affected=splitRows.filter(row=>row.entry!.symbol===error.symbol&&row.entry!.tradeDate===error.day);
      if(!affected.length)throw error;
      for(const row of affected){row.error=error.message;row.entry=null;}
    }
  }
  // Equal-date records cannot reveal chronology. Broker convention is explicit/reviewable, never guessed from balances.
  if(robinhood){const dated=rows.filter(r=>r.entry);const oneDay=new Set(dated.map(r=>r.entry!.tradeDate)).size===1;
    const newest=sourceOrder==='newest-first'||(sourceOrder==='auto'&&dated.length>1&&dated[0].entry!.tradeDate>=dated.at(-1)!.entry!.tradeDate);
    if(newest)rows.reverse();
    if(oneDay&&dated.length>1)for(const row of rows)if(row.entry)row.warning=[row.warning,`Single-day source order: ${newest?'newest first (reversed for replay)':'oldest first'}. Original CSV record numbers are retained; verify the selected order before committing.`].filter(Boolean).join(' ');
  }
  return rows;
}
/** A corporate-action error identifies exactly which preview rows need reconciliation. */
export class SplitReconciliationError extends LedgerError {
  /** Preserve the symbol/date context for row-level preview feedback. */
  constructor(public symbol:string,public day:string,message:string){super(message);}
}
/** Merge imports with one economically distinct split per symbol/day, then infer only held-position events. */
export function reconcileImportedEntries(incoming:Entry[],existing:Entry[]):{entries:Entry[];duplicateIds:Set<string>;importedCount:number} {
  if(!incoming.length)return {entries:[...existing],duplicateIds:new Set(),importedCount:0};
  const combined=[...existing,...incoming];
  const min=chronological(combined)[0].tradeDate;const max=chronological(combined).at(-1)!.tradeDate;
  const eventKeys=new Set(combined.filter(entry=>entry.type==='SPLIT').map(entry=>`${entry.symbol}:${entry.tradeDate}`));
  const candidates:Entry[]=[];
  for(const [symbol,day,ratio] of knownHistoricalSplits) {
    if(day<min||day>max||eventKeys.has(`${symbol}:${day}`))continue;
    candidates.push({id:`split:${symbol}:${day}`,externalId:`split:${symbol}:${day}`,tradeDate:day,symbol,type:'SPLIT',quantity:ratio,grossAmount:0,fee:0,splitMode:'ratio',splitOrigin:'inferred',notes:'Known historical split; ratio supplied automatically.',allocations:[]});
  }
  const ordered=chronological([...combined,...candidates]);
  const groups=new Map<string,Entry[]>();
  for(const entry of ordered)if(entry.type==='SPLIT'){
    const key=`${entry.symbol}:${entry.tradeDate}`;const group=groups.get(key)??[];group.push(entry);groups.set(key,group);
  }
  const quantities=new Map<string,number>();const handled=new Set<string>();const duplicateIds=new Set<string>();
  const incomingIds=new Set(incoming.map(entry=>entry.id));const existingIds=new Set(existing.map(entry=>entry.id));
  const entries:Entry[]=[];let importedCount=0;
  for(const entry of ordered) {
    if(entry.type==='SPLIT') {
      const symbol=entry.symbol!;const key=`${symbol}:${entry.tradeDate}`;
      if(handled.has(key))continue;handled.add(key);
      const group=groups.get(key)!;const prior=quantities.get(symbol)??0;
      if(prior<=1e-8) {
        if(group.some(row=>!isInferredSplit(row)))throw new SplitReconciliationError(symbol,entry.tradeDate,`No ${symbol} shares exist before the split on ${entry.tradeDate}. Reconcile the corporate action before importing.`);
        // Generated events are derived data: a fully closed position has no split to apply.
        continue;
      }
      const normalized=group.map(row=>({...row,quantity:row.splitMode==='additional'?(prior+row.quantity!)/prior:row.quantity!,splitMode:'ratio' as const}));
      const ratio=normalized[0].quantity;
      if(!Number.isFinite(ratio)||ratio<=0||normalized.some(row=>!Number.isFinite(row.quantity)||Math.abs(row.quantity-ratio)>1e-8*Math.max(1,ratio))) {
        throw new SplitReconciliationError(symbol,entry.tradeDate,`Conflicting split records for ${symbol} on ${entry.tradeDate}. Verify the ratio and reconcile the existing event before importing.`);
      }
      // Existing economic history takes precedence; an equivalent CSV row must never multiply it again.
      const chosen=normalized.find(row=>existingIds.has(row.id))??normalized[0];
      for(const row of normalized)if(incomingIds.has(row.id)&&row.id!==chosen.id)duplicateIds.add(row.id);
      if(incomingIds.has(chosen.id))importedCount++;
      entries.push(chosen);quantities.set(symbol,prior*ratio);
    } else {
      entries.push(entry);if(incomingIds.has(entry.id))importedCount++;
      if(entry.symbol&&(entry.type==='BUY'||entry.type==='REWARD'))quantities.set(entry.symbol,(quantities.get(entry.symbol)??0)+(entry.quantity??0));
      if(entry.symbol&&(entry.type==='SELL'||entry.type==='EXPIRY'))quantities.set(entry.symbol,(quantities.get(entry.symbol)??0)-(entry.quantity??0));
      if(entry.type==='CONVERSION'){
        const prior=quantities.get(entry.symbol!)??0;const consumed=Math.abs(prior-entry.quantity!)<=(entry.quantityRounding??0)+1e-9?prior:entry.quantity!;
        quantities.set(entry.symbol!,prior-consumed);quantities.set(entry.targetSymbol!,(quantities.get(entry.targetSymbol!)??0)+entry.targetQuantity!);
      }
    }
  }
  return {entries,duplicateIds,importedCount};
}
/** Return newly imported/inferred records for callers that only need the added rows. */
export function withHistoricalSplits(entries:Entry[],existing:Entry[]):Entry[] {
  const priorIds=new Set(existing.map(entry=>entry.id));
  return reconcileImportedEntries(entries,existing).entries.filter(entry=>!priorIds.has(entry.id));
}
