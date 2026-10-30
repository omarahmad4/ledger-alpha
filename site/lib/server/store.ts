/** D1 persistence boundary. All queries require a server-authenticated user ID; writes use revision CAS. */
import { env } from 'cloudflare:workers';
import { emptyLedger,LedgerError } from '../ledger/engine';
import type { Ledger, StoredLedger } from '../ledger/types';
export class ConflictError extends Error {}
/** Require the provisioned D1 binding; never fall back to ephemeral process/browser storage. */
export function database(): D1Database { if(!env.DB)throw new Error('Durable database is unavailable.');return env.DB; }
/** Load only this visitor's ledger. A first visit creates nothing until an explicit write. */
export async function readLedger(userId:string): Promise<StoredLedger> {
  if(!userId)throw new Error('Authentication required.');
  const row=await database().prepare('SELECT revision,data,updated_at FROM ledgers WHERE user_id=?').bind(userId).first<{revision:number;data:string;updated_at:string}>();
  return row?{ledger:JSON.parse(row.data),revision:row.revision,updatedAt:row.updated_at}:{ledger:emptyLedger(),revision:0,updatedAt:''};
}
/** Atomically snapshot the old revision and commit a new one. A stale browser cannot overwrite newer work. */
export async function writeLedger(userId:string,expected:number,ledger:Ledger): Promise<StoredLedger> {
  if(!userId)throw new Error('Authentication required.');
  const db=database();const data=JSON.stringify(ledger,(_key,value)=>{if(typeof value==='number'&&!Number.isFinite(value))throw new LedgerError('Cannot persist non-finite financial values.');return value;});const now=new Date().toISOString();
  if(data.length>1_500_000 || ledger.entries.length>5000)throw new Error('This ledger is at its 5,000-row or 1.5 MB personal storage limit. Export a backup before archiving older history.');
  // Initial row creation is harmless under races; only one compare-and-swap can win.
  await db.prepare('INSERT OR IGNORE INTO ledgers (user_id,revision,data,updated_at) VALUES (?,0,?,?)').bind(userId,JSON.stringify(emptyLedger()),now).run();
  const results=await db.batch([
    db.prepare('INSERT OR IGNORE INTO ledger_backups (user_id,revision,data,created_at) SELECT user_id,revision,data,? FROM ledgers WHERE user_id=? AND revision=?').bind(now,userId,expected),
    db.prepare('UPDATE ledgers SET data=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?').bind(data,now,userId,expected),
    db.prepare('DELETE FROM ledger_backups WHERE user_id=? AND revision < (SELECT revision-20 FROM ledgers WHERE user_id=?)').bind(userId,userId),
  ]);
  if(results[1].meta.changes!==1)throw new ConflictError('Your ledger changed in another tab or device. Reload the latest ledger and try again.');
  return {ledger,revision:expected+1,updatedAt:now};
}
/** Return bounded recovery metadata, never another user's snapshots. */
export async function listBackups(userId:string) {
  const rows=await database().prepare('SELECT revision,created_at AS createdAt FROM ledger_backups WHERE user_id=? ORDER BY revision DESC LIMIT 20').bind(userId).all<{revision:number;createdAt:string}>();
  return rows.results;
}
/** Read an explicitly chosen recovery snapshot for the current visitor. */
export async function readBackup(userId:string,revision:number):Promise<Ledger|null> {
  const row=await database().prepare('SELECT data FROM ledger_backups WHERE user_id=? AND revision=?').bind(userId,revision).first<{data:string}>();return row?JSON.parse(row.data):null;
}
