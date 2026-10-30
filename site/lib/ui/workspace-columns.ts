/** Typed accessors for every hosted table column. These read existing values solely for presentation sorting. */
import type {Entry,ImportRow} from '../ledger/types';
import type {summarize} from '../ledger/engine';
import type {decisionRows} from '../ledger/analytics';
import type {SortColumn} from './table-sort';
export type HoldingRow=ReturnType<typeof summarize>['holdings'][number];
export type DecisionRow=ReturnType<typeof decisionRows>[number];
export type DisplayColumn<T>=SortColumn<T>&{label:string};
/** Define position-column types without parsing display currency or losing unknown prices.
 * @param totalValue Complete portfolio value or null. @param demo Whether quote status is synthetic. @returns Position accessors. */
export function holdingColumns(totalValue:number|null,demo:boolean):DisplayColumn<HoldingRow>[]{return [
 {key:'asset',label:'Asset',kind:'text',value:h=>h.symbol},
 {key:'quantity',label:'Quantity',kind:'number',value:h=>h.quantity},
 {key:'price',label:'Price',kind:'number',value:h=>h.quote?.price},
 {key:'quoteStatus',label:'Quote status',kind:'text',value:h=>demo?'Synthetic':h.quote?.status},
 {key:'quoteDate',label:'Quote date',kind:'date',value:h=>h.quote?.marketTime?.slice(0,10)},
 {key:'value',label:'Market value',kind:'number',value:h=>h.value},
 {key:'gain',label:'Gain / loss',kind:'number',value:h=>h.gain},
 {key:'return',label:'Return',kind:'number',value:h=>h.gain==null||!h.costBasis?null:h.gain/h.costBasis},
 {key:'weight',label:'Weight',kind:'number',value:h=>h.value==null||!totalValue?null:h.value/totalValue},
];}
/** Match the visible asset/partner label, including noncash conversion destinations.
 * @param entry Existing transaction. @param partnerName ID/name resolver. @returns Displayed label. */
export function transactionLabel(entry:Entry,partnerName:(id:string|undefined)=>string):string{return (entry.symbol??partnerName(entry.partnerId))+(entry.type==='CONVERSION'?` → ${entry.targetSymbol}`:'');}
/** Define transaction types before pagination; action buttons are intentionally not sortable data.
 * @param partnerName ID/name resolver. @returns Transaction accessors. */
export function transactionColumns(partnerName:(id:string|undefined)=>string):DisplayColumn<Entry>[]{return [
 {key:'date',label:'Date',kind:'date',value:e=>e.tradeDate},{key:'type',label:'Activity',kind:'text',value:e=>e.type.replaceAll('_',' ')},
 {key:'asset',label:'Asset / partner',kind:'text',value:e=>transactionLabel(e,partnerName)},
 {key:'quantity',label:'Quantity',kind:'number',value:e=>e.quantity},{key:'received',label:'Received quantity',kind:'number',value:e=>e.type==='CONVERSION'?e.targetQuantity:null},
 {key:'gross',label:'Gross amount',kind:'number',value:e=>e.grossAmount},{key:'fee',label:'Fee',kind:'number',value:e=>e.fee??0},{key:'note',label:'Note',kind:'text',value:e=>e.notes},
];}
/** Define current decision output columns; no formula, grade or weighting is changed.
 * @param benchmark Current benchmark label. @returns Decision accessors. */
export function decisionColumns(benchmark:string):DisplayColumn<DecisionRow>[]{return [
 {key:'asset',label:'Asset',kind:'text',value:d=>d.symbol},{key:'date',label:'Buy date',kind:'date',value:d=>d.date},
 {key:'status',label:'Status',kind:'text',value:d=>d.active?'Open':'Closed'},{key:'invested',label:'Invested',kind:'number',value:d=>d.invested},
 {key:'value',label:'Value + proceeds',kind:'number',value:d=>d.value},{key:'return',label:'Return',kind:'number',value:d=>d.actualReturn},
 {key:'benchmark',label:`${benchmark} return`,kind:'number',value:d=>d.benchmarkReturn},{key:'alpha',label:'Excess return',kind:'number',value:d=>d.alpha},
 {key:'grade',label:'Grade',kind:'text',value:d=>d.grade},
];}
/** Resolve the exact primary preview status rather than sorting its rendered warning markup.
 * @param row Read-only preview record. @returns Displayed status. */
export function importStatus(row:ImportRow):string{return row.error??row.ignored??(row.duplicate?'Already imported':'Ready');}
/** Parse only an error-row's raw displayed money for sorting; this never normalizes or commits an entry.
 * @param row Read-only preview record. @returns Numeric displayed amount or null. */
export function importAmount(row:ImportRow):number|null{
 if(row.entry)return row.entry.grossAmount;
 const raw=row.source?.amount?.trim();if(!raw)return null;
 const number=raw.replace(/[$,()]/g,'');if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(number))return null;
 const value=Number(number)*(raw.startsWith('(')?-1:1);return Number.isFinite(value)?value:null;
}
/** Define preview columns while retaining original record IDs and canonical commit order.
 * @param partnerName ID/name resolver. @param mapping Current per-record ownership choices.
 * @param defaultPartner Explicit default choice, if any. @returns Preview accessors. */
export function importColumns(partnerName:(id:string|undefined)=>string,mapping:Record<string,string>,defaultPartner:string):DisplayColumn<ImportRow>[]{return [
 {key:'row',label:'Record',kind:'number',value:r=>r.row},{key:'date',label:'Date',kind:'date',value:r=>r.entry?.tradeDate??r.source?.day},
 {key:'type',label:'Type',kind:'text',value:r=>r.entry?.type??r.source?.code},{key:'symbol',label:'Symbol',kind:'text',value:r=>r.entry?.symbol??r.source?.symbol},
 {key:'amount',label:'Amount',kind:'number',value:importAmount},
 {key:'partner',label:'Cash-flow partner',kind:'text',value:r=>r.source?.cashFlow?(mapping[String(r.row)]??defaultPartner?partnerName(mapping[String(r.row)]??defaultPartner):null):'Pool / non-transaction'},
 {key:'status',label:'Status',kind:'text',value:importStatus},
];}
