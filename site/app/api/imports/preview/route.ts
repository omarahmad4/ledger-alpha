/** Read-only CSV preview; rejects bad rows and checks duplicates against the visitor's own ledger. */
import { z } from 'zod';
import { protect,jsonBody } from '../../../../lib/server/http';
import { readLedger } from '../../../../lib/server/store';
import { previewCsv } from '../../../../lib/ledger/import';
import { LedgerError } from '../../../../lib/ledger/engine';
const schema=z.object({csv:z.string().min(1).max(1000000),partnerId:z.string().default(''),cashFlowPartners:z.record(z.string(),z.string()).default({}),sourceOrder:z.enum(['auto','newest-first','oldest-first']).default('auto')});
/** Normalize a bounded upload and retain visible row errors; never seed or clear ledger data. */
export async function POST(request:Request){return protect(request,async user=>{const input=schema.parse(await jsonBody(request));const {ledger,revision}=await readLedger(user.userId);if((input.partnerId&&!ledger.partners.some(p=>p.id===input.partnerId))||Object.values(input.cashFlowPartners).some(id=>id&&!ledger.partners.some(p=>p.id===id)))throw new LedgerError('Choose a valid cash-flow partner.');return Response.json({rows:await previewCsv(input.csv,input.partnerId,ledger,input.cashFlowPartners,input.sourceOrder),revision});});}
