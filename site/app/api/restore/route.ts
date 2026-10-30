/** Explicit, revision-checked recovery. Existing state is snapshotted before any replacement. */
import { z } from 'zod';
import { protect,jsonBody } from '../../../lib/server/http';
import { readBackup,writeLedger } from '../../../lib/server/store';
import { validateBackup } from '../../../lib/server/service';
import { derivedSplitChanges } from '../../../lib/ledger/corporate-actions';
import type { Entry } from '../../../lib/ledger/types';
import { LedgerError } from '../../../lib/ledger/engine';
const schema=z.object({revision:z.number().int().nonnegative(),confirmation:z.literal('RESTORE'),backupRevision:z.number().int().nonnegative().optional(),backup:z.unknown().optional()});
/** Restore only a visitor-selected snapshot or validated backup; reject stale browser revisions. */
export async function POST(request:Request){return protect(request,async user=>{
  const input=schema.parse(await jsonBody(request));const source=input.backupRevision!=null?await readBackup(user.userId,input.backupRevision):input.backup;
  if(!source)throw new LedgerError('Backup not found.');const ledger=await validateBackup(source);const saved=await writeLedger(user.userId,input.revision,ledger);return Response.json({...saved,derivedSplits:derivedSplitChanges((source as {entries:Entry[]}).entries,ledger.entries)});
});}
