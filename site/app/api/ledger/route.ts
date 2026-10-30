/** Authenticated user-scoped ledger read/write endpoint. All calculations run before the atomic D1 save. */
import { protect, jsonBody } from '../../../lib/server/http';
import { readLedger, listBackups } from '../../../lib/server/store';
import { mutate } from '../../../lib/server/service';
export const dynamic='force-dynamic';
/** Return this signed-in visitor's ledger and recovery metadata. */
export async function GET(request:Request){return protect(request,async user=>Response.json({...await readLedger(user.userId),backups:await listBackups(user.userId)}));}
/** Apply a validated idempotent command. */
export async function POST(request:Request){return protect(request,async user=>Response.json(await mutate(user.userId,await jsonBody(request))));}
