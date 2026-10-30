/** Portable owner-authenticated JSON and spreadsheet-safe CSV exports. User data never enters source control. */
import { protect } from '../../../lib/server/http';
import { readLedger } from '../../../lib/server/store';
/** Quote a CSV field and neutralize spreadsheet formula interpretation in text fields. */
function field(value:unknown):string {const text=String(value??'');const safe=/^[=+@\t\r-]/.test(text)?`'${text}`:text;return `"${safe.replaceAll('"','""')}"`;}
/** Download a complete JSON backup or usable transaction CSV for this visitor. */
export async function GET(request:Request){return protect(request,async user=>{
  const {ledger}=await readLedger(user.userId);const date=new Date().toISOString().slice(0,10);const csv=new URL(request.url).searchParams.get('format')==='csv';
  const content=csv?[['Date','Type','Symbol','Quantity','Gross Amount','Fee','Partner','Notes','Received Symbol','Received Quantity','Quantity Rounding','Instrument Type','Option Multiplier','Option Terms','Multiplier Verification'].map(field).join(','),...ledger.entries.map(e=>[e.tradeDate,e.type,e.symbol,e.quantity,e.grossAmount,e.fee,ledger.partners.find(p=>p.id===e.partnerId)?.name,e.notes,e.targetSymbol,e.targetQuantity,e.quantityRounding,e.instrumentType,e.optionMultiplier,e.optionTerms,e.optionTermsSource].map(field).join(','))].join('\r\n'):JSON.stringify(ledger,null,2);
  return new Response(content,{headers:{'Content-Type':csv?'text/csv; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="ledger-alpha-${date}.${csv?'csv':'json'}"`}});
});}
