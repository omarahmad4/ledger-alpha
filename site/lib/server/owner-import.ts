/** Operator-only migration utility, with no production route. A temporary route requires an explicit source deployment and must be removed after use. */
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../app/chatgpt-auth';
import { validateBackup } from './service';
import { readLedger,writeLedger,ConflictError } from './store';
import { LedgerError,summarize } from '../ledger/engine';
import { calculateAssetQuantities } from '../core/pool';
import { latestQuote,parallelMap } from './market';
import { ZodError,z } from 'zod';
const inputSchema=z.object({revision:z.number().int().nonnegative(),backup:z.unknown()}).strict();
/** Hash credentials and exact payloads; no private contents or credentials are logged. */
async function digest(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
/** Apply one pre-authorized payload to one existing owner row, preserving revision checks and an automatic backup. */
export async function importOwnerPayload(request:Request){
 const disabled=()=>Response.json({error:'Owner import is not authorized.'},{status:401,headers:{'Cache-Control':'no-store'}});
 const {OWNER_IMPORT_USER_ID:owner,OWNER_IMPORT_KEY_HASH:keyHash,OWNER_IMPORT_PAYLOAD_HASH:payloadHash,OWNER_IMPORT_EXPIRES_AT:expires}=env;
 if(!owner||!keyHash||!payloadHash||!expires||Date.parse(expires)<=Date.now()||Date.parse(expires)>Date.now()+3600000||!Number.isFinite(Date.parse(expires)))return disabled();
 const key=request.headers.get('x-ledger-import-key');if(!key||key.length>200||await digest(key)!==keyHash)return disabled();
 const identity=await getChatGPTUser();if(identity&&identity.userId!==owner)return disabled();
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return disabled();
 if(!request.headers.get('content-type')?.startsWith('application/json'))return disabled();
 try{
  const body=await request.text();if(body.length>1_500_000||await digest(body)!==payloadHash)return Response.json({error:'Import payload does not match the authorized source.'},{status:422});
  const input=inputSchema.parse(JSON.parse(body));const current=await readLedger(owner);const receiptKey='owner-import:'+payloadHash;
  if(current.ledger.receipts.some(r=>r.key===receiptKey))return Response.json({revision:current.revision,entries:current.ledger.entries.length,replayed:true,ledgerHash:await digest(JSON.stringify(current.ledger))},{headers:{'Cache-Control':'no-store'}});
  // This import can update an already established owner record only; it cannot create an arbitrary user's account.
  if(current.revision===0||current.revision!==input.revision)throw new ConflictError('Owner ledger revision changed. Re-read and authorize a new exact payload.');
  const ledger=await validateBackup(input.backup);ledger.receipts=[...current.ledger.receipts.slice(-99),{key:receiptKey,payloadHash,imported:ledger.entries.length,skipped:0}];
  const symbols=Object.entries(calculateAssetQuantities(ledger.entries)).filter(([,q])=>Math.abs(q)>1e-8).map(([symbol])=>symbol);
  const quotes=await parallelMap(symbols,symbol=>latestQuote(symbol));
  const quoteStatus={priced:quotes.filter(q=>q?.price!=null).length,unavailable:quotes.filter(q=>q?.price==null).map(q=>q?.symbol??'unknown')};
  const saved=await writeLedger(owner,input.revision,ledger);
  const readback=await readLedger(owner);if(JSON.stringify(readback.ledger)!==JSON.stringify(saved.ledger))throw new Error('Read-after-write verification failed.');
  const summary=summarize(readback.ledger,Object.fromEntries(quotes.map(q=>[q.symbol,q])));
  return Response.json({revision:readback.revision,entries:readback.ledger.entries.length,estimated:!!readback.ledger.reconciliation,quoteStatus,ledgerHash:await digest(JSON.stringify(readback.ledger)),summary:{cash:summary.cash,totalValue:summary.totalValue,knownValue:summary.knownValue,unavailable:summary.unavailable,partners:summary.partners,netDeposits:summary.netDeposits,gain:summary.gain,quotes:quotes.map(q=>({symbol:q.symbol,status:q.status,marketTime:q.marketTime,fetchedAt:q.fetchedAt}))}},{headers:{'Cache-Control':'no-store'}});
 }catch(error){const status=error instanceof ConflictError?409:error instanceof LedgerError||error instanceof ZodError||error instanceof SyntaxError?422:500;return Response.json({error:status<500&&error instanceof Error?error.message:'Owner import failed; no completed replacement was confirmed.'},{status,headers:{'Cache-Control':'no-store'}});}
}
