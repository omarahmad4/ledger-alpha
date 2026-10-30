/** Deterministic hosted-ledger accounting. Reuses the original unitized pool and FIFO engines. */
import { calculateAssetQuantities, calculateNetCash, calculateTotalUnits, getOwnerShares } from '../core/pool';
import { valuationMultipliers,priceMultiplier } from '../core/valuation';
import { buildFifoLots } from '../core/lots';
import { partnerIdSchema } from './validation';
import type { Entry, Ledger, Quote } from './types';
export class LedgerError extends Error {}
/** Create a genuinely empty personal ledger; names are editable and no holdings are seeded. */
export function emptyLedger(): Ledger { return { version:1, partners:[{id:'self',name:'Me'}],entries:[],receipts:[]}; }
/** Sort by date, preserving explicit same-day entry order to make replay repeatable. */
export function chronological(entries: Entry[]): Entry[] { return [...entries].sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate)||((a.type==='SPLIT'?0:1)-(b.type==='SPLIT'?0:1))); }
/** Replay every event after an edit/import, validating funds, shares and exact cash-flow valuations. */
export function replay(ledger: Ledger): Ledger {
  const multipliers=valuationMultipliers(ledger.entries);
  const terms=new Map<string,number>();for(const e of ledger.entries)if(e.optionMultiplier!=null&&e.symbol){if(terms.has(e.symbol)&&terms.get(e.symbol)!==e.optionMultiplier)throw new LedgerError('Conflicting verified multipliers for the same option contract.');terms.set(e.symbol,e.optionMultiplier);}
  const result: Entry[]=[]; const ids=new Set<string>();const splitKeys=new Set<string>();
  const reconstruction=ledger.cashPolicy==='reconstruction'&&ledger.reconciliation?.estimated===true;let seenCapital=false;
  let cash=0;let units=0;const quantities:Record<string,number>=Object.create(null);const ownerUnits:Record<string,number>=Object.create(null);
  const partners=ledger.partners.map(p=>{if(!partnerIdSchema.safeParse(p.id).success)throw new LedgerError('Invalid or unsafe partner identifier.');return p.id;});
  if(reconstruction&&!partners.includes(ledger.reconciliation!.openingOwnerId))throw new LedgerError('Reconstruction opening owner does not exist.');
  if(new Set(partners).size!==partners.length)throw new LedgerError('Duplicate partner identifiers.');
  for (const input of chronological(ledger.entries)) {
    if(ids.has(input.id)) throw new LedgerError('Duplicate transaction identifier.'); ids.add(input.id);
    const tx:Entry={...input,assetId:input.symbol,assetSymbol:input.symbol,allocations:[]};
    if (['DEPOSIT','WITHDRAWAL'].includes(tx.type)) {
      if (!tx.partnerId || !partners.includes(tx.partnerId)) throw new LedgerError('Cash flow partner does not exist.');
      if(reconstruction&&!seenCapital&&tx.partnerId!==ledger.reconciliation!.openingOwnerId)throw new LedgerError('The first recorded capital flow must match the disclosed opening-owner assumption.');
      seenCapital=true;
      let nav=cash;
      if(tx.navBeforeOverride != null) nav=tx.navBeforeOverride;
      else for(const [symbol,qty] of Object.entries(quantities)) {
        if(Math.abs(qty)<1e-8)continue;
        const price=tx.valuationPrices?.[symbol];
        if(price==null || !Number.isFinite(price) || price<=0) throw new LedgerError(`Missing historical price for ${symbol} before ${tx.tradeDate}. Supply the verified pre-flow portfolio value or refresh historical prices.`);
        const multiplier=priceMultiplier(multipliers,symbol);if(multiplier==null)throw new LedgerError(`Verify the premium multiplier and adjusted terms for ${symbol} before pricing this cash flow, or enter a verified total pre-flow NAV.`);
        nav+=qty*price*multiplier;
      }
      if(!Number.isFinite(nav))throw new LedgerError('Pre-flow valuation is not finite. Reconcile the valuation inputs.');
      if(units>1e-8 && nav<=0)throw new LedgerError('Pre-flow portfolio value must be positive to price ownership units.');
      const navpu=units>1e-8?nav/units:1;
      const quantity=tx.grossAmount/navpu;
      if(tx.type==='WITHDRAWAL' && (tx.grossAmount>cash+1e-6 || quantity>(ownerUnits[tx.partnerId]??0)+1e-6)) throw new LedgerError('Withdrawal exceeds available cash or this partner’s ownership.');
      // Withdrawals store POSITIVE units. The shared engine subtracts them exactly once.
      tx.allocations=[{ownerId:tx.partnerId,percentage:1,amount:tx.grossAmount,quantity}];
      const change=tx.type==='DEPOSIT'?quantity:-quantity;
      units+=change;ownerUnits[tx.partnerId]=(ownerUnits[tx.partnerId]??0)+change;
    } else {
      if(units<=1e-8&&!reconstruction)throw new LedgerError(`Record or reconcile opening partner capital before portfolio activity on ${tx.tradeDate} (${tx.type}).`);
      if(ledger.cashPolicy!=='margin'&&!reconstruction&&tx.type==='BUY' && tx.grossAmount+(tx.fee??0)>cash+1e-6)throw new LedgerError(`Purchase on ${tx.tradeDate} exceeds recorded cash. Reconcile missing cash activity, same-day order, or a confirmed margin balance; do not invent a deposit.`);
      if(ledger.cashPolicy!=='margin'&&!reconstruction&&tx.type==='FEE' && tx.grossAmount>cash+1e-6)throw new LedgerError(`Fee on ${tx.tradeDate} exceeds available cash. Reconcile missing cash or a confirmed margin balance.`);
      if(['SELL','EXPIRY'].includes(tx.type) && (tx.quantity??0)>(quantities[tx.symbol!]??0)+1e-8)throw new LedgerError(`Sale exceeds the recorded ${tx.symbol} position. Check missing purchases or splits.`);
      if(tx.type==='CONVERSION') {
        const prior=quantities[tx.symbol!]??0;
        if(prior<=1e-8||!tx.targetSymbol||!tx.targetQuantity||!tx.quantity||tx.quantity>prior+(tx.quantityRounding??0)+1e-9)throw new LedgerError('Conversion exceeds the recorded source position or lacks a destination.');
      }
      if(tx.type==='SPLIT') {
        const key=`${tx.symbol}:${tx.tradeDate}`;if(splitKeys.has(key))throw new LedgerError(`Multiple split records for ${tx.symbol} on ${tx.tradeDate}. Reconcile the corporate action before saving.`);splitKeys.add(key);
        const prior=quantities[tx.symbol!]??0;
        if(prior<=0)throw new LedgerError(`No ${tx.symbol} shares exist before this split.`);
        tx.quantity=tx.splitMode==='additional'?(prior+tx.quantity!)/prior:tx.quantity;
        tx.splitMode='ratio';
      }
      const shares=Object.fromEntries(partners.map(id=>[id,units>1e-8?(ownerUnits[id]??0)/units:0]));
      tx.allocations=partners.map(ownerId=>({ownerId,percentage:shares[ownerId]??0,amount:tx.grossAmount*(shares[ownerId]??0),quantity:(tx.quantity??0)*(shares[ownerId]??0)}));
    }
    switch(tx.type) {
      case 'DEPOSIT':cash+=tx.grossAmount;break;
      case 'WITHDRAWAL':cash-=tx.grossAmount;break;
      case 'BUY':cash-=tx.grossAmount+(tx.fee??0);quantities[tx.symbol!]=(quantities[tx.symbol!]??0)+tx.quantity!;break;
      case 'SELL':cash+=tx.grossAmount-(tx.fee??0);quantities[tx.symbol!]=(quantities[tx.symbol!]??0)-tx.quantity!;break;
      case 'DIVIDEND':cash+=tx.grossAmount;break;
      case 'FEE':cash-=tx.grossAmount;break;
      case 'REWARD':quantities[tx.symbol!]=(quantities[tx.symbol!]??0)+tx.quantity!;break;
      case 'EXPIRY':quantities[tx.symbol!]=(quantities[tx.symbol!]??0)-tx.quantity!;break;
      case 'CONVERSION': {
        const prior=quantities[tx.symbol!]??0;
        const consumed=Math.abs(prior-tx.quantity!)<=(tx.quantityRounding??0)+1e-9?prior:tx.quantity!;
        quantities[tx.symbol!]-=consumed;quantities[tx.targetSymbol!]=(quantities[tx.targetSymbol!]??0)+tx.targetQuantity!;break;
      }
      case 'SPLIT':quantities[tx.symbol!]*=tx.quantity!;break;
    }
    const numbers=[cash,units,...Object.values(quantities),...Object.values(ownerUnits),...tx.allocations.flatMap(a=>[a.percentage,a.amount,a.quantity??0])];
    if(numbers.some(value=>!Number.isFinite(value)))throw new LedgerError('Accounting produced a non-finite value. Reconcile the transaction inputs before saving.');
    result.push(tx);
  }
  return {...ledger,entries:result};
}
/** Calculate holdings and partner values without inventing zero prices for unavailable assets. */
export function summarize(ledger: Ledger, quotes: Record<string, Quote>) {
  const entries=ledger.entries;const multipliers=valuationMultipliers(entries); const quantities=calculateAssetQuantities(entries);
  const lots=buildFifoLots(entries); const cash=calculateNetCash(entries);
  const shares=entries.length?getOwnerShares(entries,ledger.partners.map(p=>p.id)):{};
  const holdings=Object.entries(quantities).filter(([,q])=>Math.abs(q)>1e-8).map(([symbol,quantity])=>{
    const quote=quotes[symbol]; const price=quote?.price??null;
    const assetLots=lots.filter(l=>l.assetId===symbol);const costBasis=assetLots.some(l=>l.basisUnknown&&l.remainingQuantity>1e-8)?null:assetLots.reduce((s,l)=>s+l.costBasis,0);
    const multiplier=priceMultiplier(multipliers,symbol);const value=price==null||multiplier==null?null:quantity*price*multiplier;
    return {symbol,quantity,multiplier,valuationMessage:multiplier==null?'Verify option premium multiplier / adjusted contract terms.':undefined,costBasis,value,gain:value==null||costBasis==null?null:value-costBasis,quote};
  });
  const unavailable=holdings.filter(h=>h.value==null).map(h=>h.symbol);
  const knownValue=cash+holdings.reduce((s,h)=>s+(h.value??0),0);
  const totalValue=unavailable.length?null:knownValue;
  const netDeposits=entries.reduce((s,t)=>s+(t.type==='DEPOSIT'?t.grossAmount:t.type==='WITHDRAWAL'?-t.grossAmount:0),0);
  const partners=ledger.partners.map(p=>{
    const deposited=entries.reduce((s,t)=>s+(t.partnerId===p.id?(t.type==='DEPOSIT'?t.grossAmount:t.type==='WITHDRAWAL'?-t.grossAmount:0):0),0);
    const share=shares[p.id]??0;const value=totalValue==null?null:totalValue*share;
    return {...p,share,deposited,value,gain:value==null?null:value-deposited};
  });
  return {cash,holdings,partners,totalValue,knownValue,unavailable,netDeposits,gain:totalValue==null?null:totalValue-netDeposits,units:calculateTotalUnits(entries),lots};
}
